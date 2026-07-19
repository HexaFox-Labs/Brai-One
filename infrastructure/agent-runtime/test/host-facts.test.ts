import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditCheckoutTree,
  parseMountInfo,
  trustedImageParentChain,
} from "../src/host-facts.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("mountinfo parser", () => {
  it("combines mount and XFS superblock quota options", () => {
    const mounts = parseMountInfo(
      "37 25 8:17 / /srv/brai\\040user-data rw,relatime - xfs /dev/sdb1 rw,attr2,inode64,prjquota\n",
    );
    expect(mounts).toEqual([
      {
        mountPoint: "/srv/brai user-data",
        root: "/",
        device: "8:17",
        source: "/dev/sdb1",
        fsType: "xfs",
        options: ["rw", "relatime", "attr2", "inode64", "prjquota"],
      },
    ]);
  });
});

describe("trusted image path", () => {
  it("rejects a writable ancestor above the configured image root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "brai-image-chain-"));
    temporaryDirectories.push(parent);
    const deploymentRoot = join(parent, "deployment");
    const imageRoot = join(deploymentRoot, "images");
    await mkdir(imageRoot, { mode: 0o700, recursive: true });
    await chmod(deploymentRoot, 0o770);

    await expect(
      trustedImageParentChain(join(imageRoot, "sandbox.raw"), {
        trustedRoot: imageRoot,
        ownerUid: process.getuid?.() ?? -1,
        ownerGid: process.getgid?.() ?? -1,
      }),
    ).resolves.toBe(false);
  });
});

describe("checkout audit", () => {
  it("requires an owner-only checkout root boundary", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "brai-checkout-audit-"));
    temporaryDirectories.push(checkout);
    await chmod(checkout, 0o755);

    const result = await auditCheckoutTree(
      checkout,
      process.getuid?.() ?? -1,
      process.getgid?.() ?? -1,
    );
    expect(result.violations).toContain("checkout_root_not_private:.");
  });

  it("rejects escaping and dangling symlinks", async () => {
    const parent = await mkdtemp(join(tmpdir(), "brai-checkout-audit-"));
    temporaryDirectories.push(parent);
    const checkout = join(parent, "checkout");
    await mkdir(checkout, { mode: 0o700 });
    await writeFile(join(parent, "outside"), "outside\n", { mode: 0o600 });
    await symlink("../outside", join(checkout, "outside-link"));
    await symlink("missing", join(checkout, "dangling"));

    const result = await auditCheckoutTree(
      checkout,
      process.getuid?.() ?? -1,
      process.getgid?.() ?? -1,
    );
    expect(result).toEqual({
      completed: true,
      violations: [
        "dangling_symlink:dangling",
        "effective_access:dangling",
        "symlink_escape:outside-link",
      ],
    });
  });

  it("recursively audits mutable generated/cache contents", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "brai-checkout-audit-"));
    temporaryDirectories.push(checkout);
    const cache = join(checkout, "node_modules", ".cache");
    await mkdir(cache, { mode: 0o700, recursive: true });
    const nested = join(cache, "root-created-output");
    await writeFile(nested, "output\n", { mode: 0o600 });
    await chmod(nested, 0o602);

    const result = await auditCheckoutTree(
      checkout,
      process.getuid?.() ?? -1,
      process.getgid?.() ?? -1,
    );
    expect(result.violations).toContain(
      "non_owner_writable:node_modules/.cache/root-created-output",
    );
  });

  it("rejects a source symlink into a managed read-only tree", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "brai-checkout-audit-"));
    temporaryDirectories.push(checkout);
    await mkdir(join(checkout, ".agents"), { mode: 0o700 });
    await mkdir(join(checkout, "src"), { mode: 0o700 });
    await writeFile(join(checkout, ".agents", "config.json"), "{}\n", {
      mode: 0o600,
    });
    await symlink(
      "../.agents/config.json",
      join(checkout, "src", "managed-link"),
    );

    const result = await auditCheckoutTree(
      checkout,
      process.getuid?.() ?? -1,
      process.getgid?.() ?? -1,
    );
    expect(result.violations).toContain(
      "symlink_to_managed_readonly:src/managed-link",
    );
  });
});
