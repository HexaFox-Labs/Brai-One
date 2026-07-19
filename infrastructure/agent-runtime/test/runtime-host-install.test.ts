import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return await readFile(new URL(path, ROOT), "utf8");
}

describe("runtime host installation boundary", () => {
  it("loads all secrets as systemd credentials and grants no DB credential", async () => {
    const unit = await source(
      "systemd/brai-agent-runtime-host.service.example",
    );
    expect(unit).toContain(
      "LoadCredential=nats-password:/etc/brai-agent-runtime/credentials/nats-password",
    );
    expect(unit).toContain("LoadCredential=runtime-receipt-private-key.pem:");
    expect(unit).toContain("LoadCredential=launch-contract-public-key.pem:");
    expect(unit).not.toMatch(/DATABASE|postgres|supabase/iu);
    expect(unit).toContain("User=root");
    expect(unit).toContain("ExecStart=/srv/opt/node-v22.22.3/bin/node");
    expect(unit).toContain("ReadWritePaths=/run/brai-agent-runtime");
  });

  it("derives only public launch material without sourcing the access env", async () => {
    const script = await source("install/provision-runtime-host-keys.sh");
    expect(script).toContain("BRAI_ACCESS_LAUNCH_SIGNING_PRIVATE_KEY_BASE64");
    expect(script).toContain("BRAI_ACCESS_LAUNCH_SIGNING_KEY_ID");
    expect(script).toContain("launch-contract-public-key.pem");
    expect(script).toContain("-text_pub");
    expect(script).toContain("ED25519 Public-Key:");
    expect(script).toContain('/usr/bin/base64 -w0 "$temporary_launch_private"');
    expect(script).toContain("BRAI_RUNTIME_RECEIPT_SIGNING_PUBLIC_KEY_BASE64");
    expect(script).not.toMatch(
      /(?:^|\n)\s*(?:source|\.)\s+["']?\$ACCESS_ENV/mu,
    );
    expect(script).not.toMatch(/BRAI_RUNTIME_RECEIPT_SIGNING_PRIVATE_KEY/iu);
  });

  it("uses a narrow host reply inbox prefix", async () => {
    const main = await source("src/runtime-host-main.ts");
    expect(main).toContain('inboxPrefix: "_INBOX.brai.runtime"');
  });

  it("runs both the host and developer preflight on canonical Node 22", async () => {
    const [unit, gate] = await Promise.all([
      source("systemd/brai-agent-runtime-host.service.example"),
      source("src/developer-runtime-gate.ts"),
    ]);
    expect(unit).toContain("/srv/opt/node-v22.22.3/bin/node");
    expect(gate).toContain('"/srv/opt/node-v22.22.3/bin/node"');
    expect(gate).not.toContain('"/usr/bin/node"');
  });

  it("uses bounded concurrent runtime intake and drains in-flight work", async () => {
    const worker = await source("src/runtime-host-worker.ts");
    expect(worker).toContain("RUNTIME_HOST_MAX_CONCURRENT_LAUNCHES = 32");
    expect(worker).toContain("RUNTIME_HOST_MAX_CONCURRENT_TERMINATIONS = 32");
    expect(worker).toContain("await Promise.race(inFlight)");
    expect(worker).toContain("await Promise.all(inFlight)");
  });

  it("activates provisioning on the same trusted connection and key set", async () => {
    const main = await source("src/runtime-host-main.ts");
    expect(main).toContain("createHostProvisioningDependencies()");
    expect(main).toContain("new SandboxProvisioningHostService");
    expect(main).toContain("runSandboxProvisioningWorker(");
    expect(main).toContain("launchPublicKey: credentials.launchPublicKey");
    expect(main).toContain("receiptPrivateKey: credentials.receiptPrivateKey");
    expect(main).toContain("...runtimeWorkers");
    expect(main).toContain("new RuntimeHostRouterService");
    expect(main).toContain("new UserSandboxRuntimeHostService");
  });

  it("grants the root host only the capabilities and write paths used by fixed helpers", async () => {
    const unit = await source(
      "systemd/brai-agent-runtime-host.service.example",
    );
    expect(unit).toContain("CAP_SYS_ADMIN");
    expect(unit).toContain("CAP_NET_ADMIN");
    expect(unit).toContain("CAP_SYS_PTRACE");
    expect(unit).toContain("RestrictNamespaces=no");
    expect(unit).toContain("/srv/brai-user-data");
    expect(unit).toContain("/etc/brai-agent-runtime/environments");
    expect(unit).not.toMatch(/ReadWritePaths=.*\/srv\/projects/u);
  });

  it("loads FUSE once on the host and fails the rootless engine without its device", async () => {
    const [installer, sandbox, enginePrepare, modules] = await Promise.all([
      source("install/install-runtime-host.sh"),
      source("systemd/brai-user-sandbox@.service.example"),
      source("install/prepare-user-engine.sh"),
      source("config/brai-agent-runtime.modules-load.conf"),
    ]);
    expect(modules.trim()).toBe("fuse");
    expect(installer).toContain("/etc/modules-load.d/brai-agent-runtime.conf");
    expect(installer).toContain("/usr/sbin/modprobe fuse");
    expect(installer).toContain("[ -c /dev/fuse ]");
    expect(enginePrepare).toContain("[ -c /dev/fuse ]");
    expect(sandbox).not.toContain("--bind=/dev/fuse");
    expect(sandbox).toContain("brai-user-engine@%i.service");
    expect(sandbox).not.toContain("--bind=/var/run/docker.sock");
  });

  it("does not release a sandbox until its slot-bound engine is healthy", async () => {
    const [unit, check] = await Promise.all([
      source("systemd/brai-user-engine@.service.example"),
      source("install/check-user-engine.sh"),
    ]);
    expect(unit).toContain(
      "ExecStartPost=/srv/opt/brai-agent-runtime/bin/check-user-engine %i",
    );
    expect(check).toContain("http://localhost/_ping");
    expect(check).toContain('"DockerRootDir":"/data/docker"');
    expect(check).toContain('"name=rootless"');
    expect(check).toContain("Docker socket owner or mode differs");
  });

  it("denies host and private networks to the complete rootless engine cgroup", async () => {
    const unit = await source("systemd/brai-user-engine@.service.example");
    expect(unit).toContain("IPAddressDeny=10.0.0.0/8");
    expect(unit).toContain("IPAddressAllow=10.0.2.3/32");
    expect(unit).toContain("IPAddressDeny=172.16.0.0/12");
    expect(unit).toContain("IPAddressDeny=192.168.0.0/16");
    expect(unit).toContain("IPAddressDeny=157.254.223.221/32");
    expect(unit).toContain("IPAddressDeny=::/0");
  });
});
