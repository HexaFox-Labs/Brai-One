#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <poll.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define TOKEN_LENGTH 64
#define READY_TEXT "ready\n"
#ifndef GATE_PREFIX
#define GATE_PREFIX "/run/brai-agent-runtime/gates/"
#endif

#ifndef BRAI_GATE_DROP_UID
#define BRAI_GATE_DROP_UID 0
#endif

static void fail(const char *message) {
  fprintf(stderr, "brai-exec-gate: %s\n", message);
  exit(126);
}

static bool lowercase_sha256(const char *value) {
  if (strlen(value) != TOKEN_LENGTH) return false;
  for (size_t index = 0; index < TOKEN_LENGTH; index++) {
    const char value_at_index = value[index];
    if (!((value_at_index >= '0' && value_at_index <= '9') ||
          (value_at_index >= 'a' && value_at_index <= 'f'))) {
      return false;
    }
  }
  return true;
}

static bool trusted_runtime_path(const char *path) {
  return path != NULL &&
         strncmp(path, GATE_PREFIX, strlen(GATE_PREFIX)) == 0 &&
         strstr(path, "/../") == NULL && strstr(path, "/./") == NULL &&
         strchr(path, '\n') == NULL && strlen(path) < 4096;
}

static void verify_node(
    const char *path,
    mode_t expected_type,
    mode_t expected_permissions) {
  struct stat metadata;
  if (lstat(path, &metadata) != 0) fail("runtime gate node is unavailable");
  if ((metadata.st_mode & S_IFMT) != expected_type ||
      (metadata.st_mode & 07777) != expected_permissions ||
      metadata.st_uid != 0 || metadata.st_gid != getegid()) {
    fail("runtime gate node ownership or mode is invalid");
  }
}

static void signal_ready(const char *path) {
  verify_node(path, S_IFREG, 0620);
  const int descriptor =
      open(path, O_WRONLY | O_CLOEXEC | O_NOFOLLOW | O_TRUNC);
  if (descriptor < 0) fail("cannot open readiness node");
  const char ready[] = READY_TEXT;
  if (write(descriptor, ready, sizeof(ready) - 1) !=
      (ssize_t)(sizeof(ready) - 1)) {
    close(descriptor);
    fail("cannot signal readiness");
  }
  if (fsync(descriptor) != 0 || close(descriptor) != 0) {
    fail("cannot persist readiness signal");
  }
}

static void await_release(const char *fifo_path, const char *token) {
  verify_node(fifo_path, S_IFIFO, 0440);
  const int descriptor =
      open(fifo_path, O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) fail("cannot open release fifo");

  char received[TOKEN_LENGTH + 2] = {0};
  size_t used = 0;
  for (;;) {
    struct pollfd wait_for_release = {
        .fd = descriptor,
        .events = POLLIN | POLLHUP,
        .revents = 0,
    };
    const int poll_result = poll(&wait_for_release, 1, 30000);
    if (poll_result < 0 && errno == EINTR) continue;
    if (poll_result <= 0) {
      close(descriptor);
      fail("release signal timed out");
    }

    const ssize_t count =
        read(descriptor, received + used, sizeof(received) - used);
    if (count < 0 && (errno == EAGAIN || errno == EINTR)) continue;
    if (count < 0) {
      close(descriptor);
      fail("cannot read release signal");
    }
    used += (size_t)count;
    if (used >= TOKEN_LENGTH + 1 || count == 0) break;
  }
  close(descriptor);

  const bool matches =
      used == TOKEN_LENGTH + 1 && received[TOKEN_LENGTH] == '\n' &&
      memcmp(received, token, TOKEN_LENGTH) == 0;
  memset(received, 0, sizeof(received));
  if (!matches) fail("release token mismatch");
}

int main(int argc, char **argv) {
  if (argc < 6 || strcmp(argv[4], "--") != 0 ||
      !trusted_runtime_path(argv[1]) || !trusted_runtime_path(argv[2]) ||
      !lowercase_sha256(argv[3]) || argv[5][0] != '/') {
    fail("invalid invocation");
  }

  umask(0077);
  const int fifo_descriptor =
      open(argv[1], O_RDONLY | O_NONBLOCK | O_CLOEXEC | O_NOFOLLOW);
  if (fifo_descriptor < 0) fail("cannot establish release fifo");
  close(fifo_descriptor);
  signal_ready(argv[2]);
  await_release(argv[1], argv[3]);

  memset(argv[3], 0, TOKEN_LENGTH);
#if BRAI_GATE_DROP_UID > 0
  if (setgroups(0, NULL) != 0 ||
      setgid((gid_t)BRAI_GATE_DROP_UID) != 0 ||
      setuid((uid_t)BRAI_GATE_DROP_UID) != 0 ||
      getuid() != (uid_t)BRAI_GATE_DROP_UID ||
      geteuid() != (uid_t)BRAI_GATE_DROP_UID ||
      getgid() != (gid_t)BRAI_GATE_DROP_UID ||
      getegid() != (gid_t)BRAI_GATE_DROP_UID) {
    fail("cannot drop sandbox gate privileges");
  }
#endif
  execv(argv[5], &argv[5]);
  fail("target exec failed");
}
