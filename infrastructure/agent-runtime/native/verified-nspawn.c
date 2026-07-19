#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <openssl/evp.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define IMAGE_PATH "/srv/opt/brai-agent-runtime/images/user-sandbox-v1.raw"
#define IMAGE_NAME "user-sandbox-v1.raw"
#define SIDECAR_NAME "user-sandbox-v1.raw.sha256"
#define NSPAWN_PATH "/usr/bin/systemd-nspawn"
#define MAX_IMAGE_BYTES ((off_t)8 * 1024 * 1024 * 1024)

static void fail(const char *message) {
  fprintf(stderr, "verified-nspawn: %s\n", message);
  exit(EXIT_FAILURE);
}

static void fail_errno(const char *message) {
  fprintf(stderr, "verified-nspawn: %s: %s\n", message, strerror(errno));
  exit(EXIT_FAILURE);
}

static void check_trusted_directory(int descriptor, const char *label) {
  struct stat metadata;
  if (fstat(descriptor, &metadata) < 0) {
    fail_errno("cannot inspect trusted directory");
  }
  if (!S_ISDIR(metadata.st_mode) || metadata.st_uid != 0 ||
      metadata.st_gid != 0 || (metadata.st_mode & 0022) != 0) {
    fprintf(stderr, "verified-nspawn: untrusted directory: %s\n", label);
    exit(EXIT_FAILURE);
  }
}

static int open_trusted_image_directory(void) {
  static const char *const components[] = {
      "srv", "opt", "brai-agent-runtime", "images",
  };
  int current = open("/", O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (current < 0) {
    fail_errno("cannot open root directory");
  }
  check_trusted_directory(current, "/");
  for (size_t index = 0;
       index < sizeof(components) / sizeof(components[0]); index++) {
    int next = openat(current, components[index],
                      O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0) {
      fail_errno("cannot open trusted image-directory component");
    }
    check_trusted_directory(next, components[index]);
    close(current);
    current = next;
  }
  return current;
}

static struct stat check_regular_file(int descriptor, mode_t expected_mode,
                                      const char *label) {
  struct stat metadata;
  if (fstat(descriptor, &metadata) < 0) {
    fail_errno("cannot inspect file descriptor");
  }
  if (!S_ISREG(metadata.st_mode) || metadata.st_uid != 0 ||
      metadata.st_gid != 0 || metadata.st_nlink != 1 ||
      (metadata.st_mode & 0777) != expected_mode) {
    fprintf(stderr, "verified-nspawn: untrusted %s metadata\n", label);
    exit(EXIT_FAILURE);
  }
  return metadata;
}

static void read_expected_digest(int directory, unsigned char expected[32]) {
  int sidecar =
      openat(directory, SIDECAR_NAME, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (sidecar < 0) {
    fail_errno("cannot open digest sidecar");
  }
  struct stat metadata = check_regular_file(sidecar, 0444, "sidecar");
  if (metadata.st_size != 65) {
    fail("digest sidecar must contain exactly 64 lowercase hex bytes and LF");
  }
  char content[66] = {0};
  ssize_t count = pread(sidecar, content, 65, 0);
  if (count != 65 || content[64] != '\n') {
    fail("cannot read the exact digest sidecar");
  }
  char extra;
  if (pread(sidecar, &extra, 1, 65) != 0) {
    fail("digest sidecar has trailing content");
  }
  for (size_t index = 0; index < 32; index++) {
    char pair[3] = {content[index * 2], content[index * 2 + 1], '\0'};
    if (!((pair[0] >= '0' && pair[0] <= '9') ||
          (pair[0] >= 'a' && pair[0] <= 'f')) ||
        !((pair[1] >= '0' && pair[1] <= '9') ||
          (pair[1] >= 'a' && pair[1] <= 'f'))) {
      fail("digest sidecar is not lowercase hexadecimal");
    }
    expected[index] = (unsigned char)strtoul(pair, NULL, 16);
  }
  close(sidecar);
}

static void sha256_descriptor(int descriptor, unsigned char digest[32]) {
  EVP_MD_CTX *context = EVP_MD_CTX_new();
  if (context == NULL) {
    fail("cannot allocate SHA-256 context");
  }
  if (EVP_DigestInit_ex(context, EVP_sha256(), NULL) != 1) {
    EVP_MD_CTX_free(context);
    fail("cannot initialize SHA-256");
  }
  unsigned char buffer[1024 * 1024];
  off_t offset = 0;
  for (;;) {
    ssize_t count = pread(descriptor, buffer, sizeof(buffer), offset);
    if (count < 0) {
      if (errno == EINTR) {
        continue;
      }
      EVP_MD_CTX_free(context);
      fail_errno("cannot hash image descriptor");
    }
    if (count == 0) {
      break;
    }
    if (EVP_DigestUpdate(context, buffer, (size_t)count) != 1) {
      EVP_MD_CTX_free(context);
      fail("cannot update SHA-256");
    }
    offset += count;
  }
  unsigned int digest_length = 0;
  if (EVP_DigestFinal_ex(context, digest, &digest_length) != 1 ||
      digest_length != 32) {
    EVP_MD_CTX_free(context);
    fail("cannot finalize SHA-256");
  }
  EVP_MD_CTX_free(context);
}

static bool same_file_snapshot(const struct stat *before,
                               const struct stat *after) {
  return before->st_dev == after->st_dev && before->st_ino == after->st_ino &&
         before->st_size == after->st_size &&
         before->st_mtim.tv_sec == after->st_mtim.tv_sec &&
         before->st_mtim.tv_nsec == after->st_mtim.tv_nsec &&
         before->st_ctim.tv_sec == after->st_ctim.tv_sec &&
         before->st_ctim.tv_nsec == after->st_ctim.tv_nsec;
}

static int open_and_verify_image(unsigned char digest[32]) {
  int directory = open_trusted_image_directory();
  int image = openat(directory, IMAGE_NAME, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (image < 0) {
    fail_errno("cannot open immutable image");
  }
  struct stat before = check_regular_file(image, 0444, "image");
  if (before.st_size <= 0 || before.st_size > MAX_IMAGE_BYTES) {
    fail("immutable image has an invalid size");
  }
  unsigned char expected[32];
  read_expected_digest(directory, expected);
  sha256_descriptor(image, digest);
  struct stat after = check_regular_file(image, 0444, "image");
  if (!same_file_snapshot(&before, &after)) {
    fail("immutable image changed while it was being verified");
  }
  if (memcmp(digest, expected, 32) != 0) {
    fail("immutable image digest does not match its trusted sidecar");
  }
  close(directory);
  return image;
}

static void print_digest_json(const unsigned char digest[32]) {
  fputs("{\"path\":\"" IMAGE_PATH "\",\"sha256\":\"", stdout);
  for (size_t index = 0; index < 32; index++) {
    printf("%02x", digest[index]);
  }
  fputs("\",\"descriptorVerified\":true}\n", stdout);
}

static bool has_forbidden_source_argument(const char *argument) {
  static const char *const exact[] = {
      "-i", "-D", "--directory", "--template", "--oci-bundle",
  };
  for (size_t index = 0; index < sizeof(exact) / sizeof(exact[0]); index++) {
    if (strcmp(argument, exact[index]) == 0) {
      return true;
    }
  }
  return strncmp(argument, "--image", 7) == 0 ||
         strncmp(argument, "--directory=", 12) == 0 ||
         strncmp(argument, "--template=", 11) == 0 ||
         strncmp(argument, "--oci-bundle=", 13) == 0;
}

int main(int argc, char **argv) {
  if (geteuid() != 0) {
    fail("must run as root");
  }
  if (argc < 2 || strcmp(argv[1], "--image=" IMAGE_PATH) != 0) {
    fail("only the canonical shared image is accepted");
  }

  unsigned char digest[32];
  int image = open_and_verify_image(digest);
  if (argc == 3 && strcmp(argv[2], "--verify-only") == 0) {
    print_digest_json(digest);
    close(image);
    return EXIT_SUCCESS;
  }
  if (argc < 4 || strcmp(argv[2], "--") != 0 ||
      strcmp(argv[3], NSPAWN_PATH) != 0) {
    fail("expected -- followed by the canonical systemd-nspawn executable");
  }
  for (int index = 4; index < argc; index++) {
    if (has_forbidden_source_argument(argv[index])) {
      fail("caller may not supply another image or root source");
    }
  }

  int inherited_image = fcntl(image, F_DUPFD, 100);
  if (inherited_image < 0) {
    fail_errno("cannot retain verified image descriptor");
  }
  close(image);

  char image_argument[64];
  int formatted = snprintf(image_argument, sizeof(image_argument),
                           "--image=/proc/self/fd/%d", inherited_image);
  if (formatted < 0 || (size_t)formatted >= sizeof(image_argument)) {
    fail("cannot construct descriptor image argument");
  }

  size_t child_count = (size_t)argc - 2;
  char **child = calloc(child_count + 1, sizeof(char *));
  if (child == NULL) {
    fail("cannot allocate systemd-nspawn argument vector");
  }
  child[0] = (char *)NSPAWN_PATH;
  child[1] = image_argument;
  for (int source = 4, destination = 2; source < argc;
       source++, destination++) {
    child[destination] = argv[source];
  }
  child[child_count] = NULL;

  char *const environment[] = {
      "PATH=/usr/sbin:/usr/bin:/sbin:/bin",
      "LC_ALL=C",
      NULL,
  };
  umask(0077);
  execve(NSPAWN_PATH, child, environment);
  fail_errno("cannot exec systemd-nspawn");
}
