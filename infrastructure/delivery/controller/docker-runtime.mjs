import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { join, resolve } from "node:path";

import { previewPrefix } from "./constants.mjs";
import { renderRuntimeConfiguration } from "./runtime-config.mjs";
import { assessSnapshotSize } from "./storage-policy.mjs";

const runtimeServiceNames = Object.freeze([
  "brai-nats",
  "brai-factory",
  "brai-access",
  "brai-api-gateway",
  "brai-web",
]);
const allImageServices = Object.freeze([
  "brai-postgres",
  ...runtimeServiceNames,
  "brai-factory-admin",
  "brai-access-admin",
]);
const imageToService = Object.freeze({
  access: "brai-access",
  "api-gateway": "brai-api-gateway",
  factory: "brai-factory",
  nats: "brai-nats",
  web: "brai-web",
});

/**
 * The sole host-side Docker adapter. It never accepts a shell command, a
 * source path or a container name from CI: every argument derives from the
 * strict request parser and fixed Compose source installed by root.
 */
export class DockerRuntime {
  /**
   * @param {{ root: string; composeFile?: string; execute?: typeof execute; snapshotPath?: string }} options
   */
  constructor(options) {
    this.root = resolve(options.root);
    this.composeFile = resolve(
      options.composeFile ?? join(this.root, "compose.runtime.yml"),
    );
    this.execute = options.execute ?? execute;
    this.output = options.output ?? executeOutput;
    this.snapshotPath = resolve(
      options.snapshotPath ?? join(this.root, "state/snapshots/dev-data.dump"),
    );
  }

  /**
   * @param {{ prefix: string; slot?: number; manifest: { images: Record<string, string> }; changedImages: Record<string, string>; initial: boolean; restoreSnapshot?: boolean; secrets: Record<string, string> }} input
   */
  async deploy(input) {
    const runtimeDirectory = await this.writeConfiguration(input);
    const compose = this.composeArguments(input.prefix, runtimeDirectory);
    const changedRuntimeServices = servicesForImages(input.changedImages);
    const needsFactoryMigration =
      input.initial ||
      "factory" in input.changedImages ||
      "factory-admin" in input.changedImages;
    const needsAccessMigration =
      input.initial ||
      "access" in input.changedImages ||
      "access-admin" in input.changedImages;
    const pullServices = input.initial
      ? allImageServices
      : unique([
          ...changedRuntimeServices,
          ...(needsFactoryMigration ? ["brai-factory-admin"] : []),
          ...(needsAccessMigration ? ["brai-access-admin"] : []),
        ]);

    await this.compose(compose, ["pull", "--quiet", ...pullServices]);
    if (input.initial) {
      await this.compose(compose, [
        "up",
        "--detach",
        "--no-build",
        "--pull",
        "never",
        "--wait",
        "--wait-timeout",
        "120",
        "brai-postgres",
        "brai-nats",
      ]);
    }
    if (needsFactoryMigration) await this.runFactoryMigration(compose);
    if (needsAccessMigration) await this.runAccessMigration(compose);
    if (input.initial && input.restoreSnapshot)
      await this.restoreSnapshot(input.prefix);

    const services = input.initial
      ? runtimeServiceNames
      : "nats" in input.changedImages
        ? runtimeServiceNames
        : changedRuntimeServices;
    if (services.length > 0) {
      await this.compose(compose, [
        "up",
        "--detach",
        "--no-build",
        "--pull",
        "never",
        "--wait",
        "--wait-timeout",
        "180",
        ...(input.initial ? [] : ["--no-deps"]),
        ...services,
      ]);
    }
    return { runtimeDirectory, services };
  }

  /** @param {string} prefix */
  async cleanup(prefix) {
    assertPrefix(prefix);
    const runtimeDirectory = join(this.root, "runtime", prefix);
    const compose = this.composeArguments(prefix, runtimeDirectory);
    await this.compose(compose, ["down", "--volumes", "--remove-orphans"]);
    await rm(runtimeDirectory, { force: true, recursive: true });
  }

  /** @param {string} prefix */
  async snapshot(prefix) {
    assertPrefix(prefix);
    const directory = join(this.root, "state", "snapshots");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(
      directory,
      `.dev-data-${process.pid}-${Date.now()}.dump`,
    );
    try {
      await streamProcess(
        "docker",
        [
          "exec",
          "-e",
          `PGPASSWORD=${await readPostgresPassword(join(this.root, "runtime", prefix, "compose.env"))}`,
          `${prefix}-brai-postgres`,
          "pg_dump",
          "--format=custom",
          "--data-only",
          "--no-owner",
          "--no-privileges",
          "--schema=brai_factory",
          "--schema=brai_access",
          "--exclude-table=brai_factory.schema_migrations",
          "--exclude-table=brai_access.schema_migrations",
          "--username=postgres",
          "--dbname=brai_preview",
        ],
        { stdout: createWriteStream(temporary, { mode: 0o600 }) },
      );
      const snapshot = assessSnapshotSize((await stat(temporary)).size);
      if (!snapshot.accepted) {
        throw new Error("Dev snapshot exceeds the 200 MB preview data budget");
      }
      await chmod(temporary, 0o600);
      await rename(temporary, this.snapshotPath);
      return snapshot;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async hostFreeBytes() {
    const filesystem = await statfs(this.root);
    return Number(filesystem.bavail) * Number(filesystem.bsize);
  }

  /** @param {string} prefix */
  async slotStorageBytes(prefix) {
    assertPrefix(prefix);
    const sizes = await Promise.all(
      [`${prefix}-brai-postgres-data`, `${prefix}-brai-nats-data`].map(
        async (volume) => {
          const mountpoint = await this.output("docker", [
            "volume",
            "inspect",
            volume,
            "--format",
            "{{ .Mountpoint }}",
          ]);
          const measured = await this.output("du", ["-sb", mountpoint.trim()]);
          const bytes = Number(measured.trim().split(/\s+/u)[0]);
          if (!Number.isSafeInteger(bytes) || bytes < 0) {
            throw new Error("Docker volume size is not a safe integer");
          }
          return bytes;
        },
      ),
    );
    return sizes.reduce((total, bytes) => total + bytes, 0);
  }

  /** @param {string} prefix */
  async restoreSnapshot(prefix) {
    await stat(this.snapshotPath);
    const password = await readPostgresPassword(
      join(this.root, "runtime", prefix, "compose.env"),
    );
    await streamProcess(
      "docker",
      [
        "exec",
        "-i",
        "-e",
        `PGPASSWORD=${password}`,
        `${prefix}-brai-postgres`,
        "pg_restore",
        "--data-only",
        "--no-owner",
        "--no-privileges",
        "--username=postgres",
        "--dbname=brai_preview",
      ],
      { stdin: createReadStream(this.snapshotPath) },
    );
  }

  /** @param {object} input */
  async writeConfiguration(input) {
    const prefix = /** @type {{ prefix: string }} */ (input).prefix;
    assertPrefix(prefix);
    const directory = join(this.root, "runtime", prefix);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const rendered = renderRuntimeConfiguration({
      ...input,
      configDirectory: directory,
      images: /** @type {{ manifest: { images: Record<string, string> } }} */ (
        input
      ).manifest.images,
    });
    await Promise.all(
      Object.entries({
        "access-bootstrap.env": rendered.accessBootstrap,
        "access-migrations.env": rendered.accessMigrations,
        "access.env": rendered.access,
        "compose.env": rendered.compose,
        "factory-migrations.env": rendered.factoryMigrations,
        "factory.env": rendered.factory,
        "gateway.env": rendered.gateway,
        "nats.env": rendered.nats,
      }).map(([name, content]) =>
        writePrivateFile(join(directory, name), content),
      ),
    );
    return directory;
  }

  /** @param {string[]} compose @param {string[]} argumentsList */
  async compose(compose, argumentsList) {
    await this.execute("docker", ["compose", ...compose, ...argumentsList]);
  }

  /** @param {string} prefix @param {string} runtimeDirectory */
  composeArguments(prefix, runtimeDirectory) {
    return [
      "--project-name",
      `${prefix}-brai`,
      "--env-file",
      join(runtimeDirectory, "compose.env"),
      "--file",
      this.composeFile,
      "--profile",
      "admin",
    ];
  }

  /** @param {string[]} compose */
  async runFactoryMigration(compose) {
    for (const command of [
      ["brai-factory-admin"],
      ["brai-factory-admin", "node", "dist/provision-runtime-role.js"],
      ["brai-factory-admin", "node", "dist/audit-runtime-role.js"],
    ]) {
      await this.compose(compose, [
        "run",
        "--rm",
        "--no-deps",
        "--pull",
        "never",
        ...command,
      ]);
    }
  }

  /** @param {string[]} compose */
  async runAccessMigration(compose) {
    for (const command of [
      ["brai-access-admin", "node", "dist/bootstrap-migration-role.js"],
      ["brai-access-admin", "node", "dist/migrate.js"],
      ["brai-access-admin", "node", "dist/provision-runtime-role.js"],
      ["brai-access-admin", "node", "dist/audit-migration-role.js"],
      ["brai-access-admin", "node", "dist/audit-runtime-role.js"],
    ]) {
      await this.compose(compose, [
        "run",
        "--rm",
        "--no-deps",
        "--pull",
        "never",
        ...command,
      ]);
    }
  }
}

/** @param {Record<string, string>} changedImages */
function servicesForImages(changedImages) {
  return unique(
    Object.keys(changedImages)
      .map((image) => imageToService[image])
      .filter((service) => service !== undefined),
  );
}

/** @param {readonly string[]} values */
function unique(values) {
  return [...new Set(values)];
}

/** @param {string} prefix */
function assertPrefix(prefix) {
  if (!/^(d|p(?:0[1-9]|1[0-9]|20))$/u.test(prefix)) {
    throw new Error("Runtime prefix is not controller-owned");
  }
}

/** @param {string} path @param {string} content */
async function writePrivateFile(path, content) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

/** @param {string} environmentPath */
async function readPostgresPassword(environmentPath) {
  const source = await (
    await import("node:fs/promises")
  ).readFile(environmentPath, "utf8");
  const match = source.match(/^BRAI_POSTGRES_PASSWORD=([^\r\n]+)$/mu);
  if (!match?.[1])
    throw new Error("Runtime Compose environment has no PostgreSQL password");
  return match[1];
}

/** @param {string} command @param {string[]} argumentsList */
async function execute(command, argumentsList) {
  await streamProcess(command, argumentsList, {});
}

/** @param {string} command @param {string[]} argumentsList */
function executeOutput(command, argumentsList) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let standardOutput = "";
    let standardError = "";
    child.stdout?.on("data", (chunk) => {
      standardOutput = `${standardOutput}${chunk}`.slice(-16_384);
    });
    child.stderr?.on("data", (chunk) => {
      standardError = `${standardError}${chunk}`.slice(-4000);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(standardOutput);
      else {
        reject(
          new Error(
            `Host inspection failed (${signal ?? String(code)}): ${standardError.trim()}`,
          ),
        );
      }
    });
  });
}

/** @param {string} command @param {string[]} argumentsList @param {{ stdin?: import("node:stream").Readable; stdout?: import("node:stream").Writable }} streams */
function streamProcess(command, argumentsList, streams) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, {
      stdio: [streams.stdin ?? "ignore", streams.stdout ?? "ignore", "pipe"],
    });
    let standardError = "";
    child.stderr?.on("data", (chunk) => {
      standardError = `${standardError}${chunk}`.slice(-4000);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(
            `Host command failed (${signal ?? String(code)}): ${standardError.trim()}`,
          ),
        );
    });
  });
}

export const dockerRuntimeConstants = Object.freeze({
  allImageServices,
  imageToService,
  runtimeServiceNames,
});
