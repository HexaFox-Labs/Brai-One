import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createRegistry } from "./lease-registry.mjs";

export class ControllerState {
  /** @param {string} root */
  constructor(root) {
    this.root = resolve(root);
  }

  async readRegistry() {
    return this.readJson(
      join(this.root, "state/leases.json"),
      createRegistry(),
    );
  }

  /** @param {object} registry */
  async writeRegistry(registry) {
    await this.writeJson(join(this.root, "state/leases.json"), registry);
  }

  async readDevManifest() {
    return this.readJson(
      join(this.root, "state/manifests/dev.json"),
      undefined,
    );
  }

  /** @param {object} manifest */
  async writeDevManifest(manifest) {
    await this.writeJson(join(this.root, "state/manifests/dev.json"), manifest);
  }

  /** @param {number} slot */
  async readPreviewManifest(slot) {
    return this.readJson(this.previewManifestPath(slot), undefined);
  }

  /** @param {number} slot @param {object} manifest */
  async writePreviewManifest(slot, manifest) {
    await this.writeJson(this.previewManifestPath(slot), manifest);
  }

  /** @param {number} slot */
  async removePreviewManifest(slot) {
    await rm(this.previewManifestPath(slot), { force: true });
  }

  /** @param {string} prefix */
  async readSecrets(prefix) {
    return this.readJson(
      join(this.root, "state/secrets", `${prefix}.json`),
      undefined,
    );
  }

  /** @param {string} prefix @param {object} secrets */
  async writeSecrets(prefix, secrets) {
    await this.writeJson(
      join(this.root, "state/secrets", `${prefix}.json`),
      secrets,
    );
  }

  /** @param {string} prefix */
  async removeSecrets(prefix) {
    await rm(join(this.root, "state/secrets", `${prefix}.json`), {
      force: true,
    });
  }

  async hasSnapshot() {
    try {
      await readFile(join(this.root, "state/snapshots/dev-data.dump"));
      return true;
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT")
        throw error;
    }
    return this.readJson(
      join(this.root, "state/snapshots/dev-data.json"),
      undefined,
    ).then((record) => record?.accepted === true);
  }

  /** @param {object} snapshot */
  async writeSnapshotRecord(snapshot) {
    await this.writeJson(
      join(this.root, "state/snapshots/dev-data.json"),
      snapshot,
    );
  }

  /** @param {string} path @param {unknown} fallback */
  async readJson(path, fallback) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return fallback;
      }
      throw error;
    }
  }

  /** @param {string} path @param {unknown} value */
  async writeJson(path, value) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = join(dirname(path), `.${process.pid}.${Date.now()}.json`);
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    await chmod(path, 0o600);
  }

  /** @param {number} slot */
  previewManifestPath(slot) {
    return join(
      this.root,
      "state/manifests",
      `p${String(slot).padStart(2, "0")}.json`,
    );
  }
}
