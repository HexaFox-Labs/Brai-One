import {
  previewActiveLimit,
  previewPrefix,
  previewSlotHardBytes,
} from "./constants.mjs";
import { overlayManifest } from "./image-manifest.mjs";
import {
  createRegistry,
  releaseLease,
  requestLease,
} from "./lease-registry.mjs";
import {
  parseDeliveryRequest,
  parsePreviewReleaseRequest,
} from "./request-policy.mjs";
import { createRuntimeSecrets } from "./runtime-config.mjs";
import { assessPreviewAdmission } from "./storage-policy.mjs";

/**
 * Serializes the state transition from a GitHub-authenticated request to an
 * immutable manifest activation. A failed update never writes a new manifest;
 * therefore the last green preview keeps serving its preceding revision.
 */
export class DeliveryController {
  /**
   * @param {{ state: import("./controller-state.mjs").ControllerState; runtime: { deploy: Function; cleanup: Function; hostFreeBytes: Function; snapshot?: Function; slotStorageBytes?: Function }; activeLimit?: number; now?: () => string }} options
   */
  constructor(options) {
    this.state = options.state;
    this.runtime = options.runtime;
    this.activeLimit = options.activeLimit ?? previewActiveLimit;
    this.now = options.now ?? (() => new Date().toISOString());
    this.pending = Promise.resolve();
  }

  /** @param {unknown} rawRequest */
  async submit(rawRequest) {
    return this.serialize(async () => {
      const request = parseDeliveryRequest(rawRequest);
      return request.target === "dev"
        ? this.deployDev(request)
        : this.deployPreview(request);
    });
  }

  /** @param {unknown} rawRequest */
  async release(rawRequest) {
    return this.serialize(async () => {
      const request = parsePreviewReleaseRequest(rawRequest);
      const registry = await this.state.readRegistry();
      const slot = registry.slots.find(
        (entry) => entry.lease?.branch === request.branch,
      );
      if (!slot?.lease) return { state: "absent" };
      await this.runtime.cleanup(previewPrefix(slot.number));
      const released = releaseLease(registry, slot.number, slot.generation);
      await this.state.writeRegistry(released.registry);
      await this.state.removePreviewManifest(slot.number);
      await this.state.removeSecrets(previewPrefix(slot.number));
      await this.drainQueue();
      return { state: "released", slot: previewPrefix(slot.number) };
    });
  }

  /**
   * Returns only the non-secret fact needed by the owner-acceptance workflow.
   * The HTTP route remains OIDC-gated and does not disclose a manifest,
   * image reference, database state or a preview URL.
   *
   * @param {string} branch
   */
  async previewStatus(branch) {
    const registry = await this.state.readRegistry();
    const slot = registry.slots.find((entry) => entry.lease?.branch === branch);
    if (!slot?.lease) return { state: "absent" };
    const manifest = await this.state.readPreviewManifest(slot.number);
    if (!manifest)
      return { slot: previewPrefix(slot.number), state: "pending" };
    return {
      revision: manifest.revision,
      slot: previewPrefix(slot.number),
      state: "deployed",
    };
  }

  async sweep() {
    return this.serialize(async () => {
      const registry = await this.state.readRegistry();
      const expired = registry.slots
        .filter(
          (slot) =>
            slot.lease &&
            Date.parse(slot.lease.lastActivityAt) + 72 * 60 * 60 * 1000 <=
              Date.parse(this.now()),
        )
        .map((slot) => ({ generation: slot.generation, number: slot.number }));
      for (const slot of expired) {
        await this.runtime.cleanup(previewPrefix(slot.number));
        const released = releaseLease(registry, slot.number, slot.generation);
        registry.slots = released.registry.slots;
        await this.state.removePreviewManifest(slot.number);
        await this.state.removeSecrets(previewPrefix(slot.number));
      }
      await this.state.writeRegistry(registry);
      await this.drainQueue();
      return { expired: expired.map((slot) => previewPrefix(slot.number)) };
    });
  }

  /** @param {ReturnType<typeof parseDeliveryRequest>} request */
  async deployDev(request) {
    const previous = await this.state.readDevManifest();
    const manifest = overlayManifest(
      previous?.images,
      request.changedImages,
      request.revision,
    );
    const prefix = "d";
    const secrets =
      (await this.state.readSecrets(prefix)) ?? createRuntimeSecrets();
    await this.state.writeSecrets(prefix, secrets);
    await this.runtime.deploy({
      changedImages: request.changedImages,
      initial: previous === undefined,
      manifest,
      prefix,
      secrets,
    });
    await this.state.writeDevManifest(manifest);
    let snapshot = {
      accepted: false,
      reason: "runtime-does-not-support-snapshots",
    };
    if (this.runtime.snapshot) snapshot = await this.runtime.snapshot(prefix);
    if (snapshot.accepted) await this.state.writeSnapshotRecord(snapshot);
    return {
      manifest,
      revision: manifest.revision,
      snapshot,
      state: "deployed",
      target: "dev",
      url: "https://dev.brai.one",
    };
  }

  /** @param {ReturnType<typeof parseDeliveryRequest>} request */
  async deployPreview(request) {
    const before = await this.state.readRegistry();
    const existing = before.slots.find(
      (slot) => slot.lease?.branch === request.branch,
    );
    const active = before.slots.filter((slot) => slot.lease).length;
    const admission = existing
      ? { allowed: true }
      : assessPreviewAdmission({
          active,
          activeLimit: this.activeLimit,
          freeBytes: await this.runtime.hostFreeBytes(),
        });
    const leased = requestLease(
      before,
      request,
      this.now(),
      admission.allowed ? this.activeLimit : 0,
    );
    await this.state.writeRegistry(leased.registry);
    if (leased.result.state === "queued") {
      return {
        reason: admission.allowed ? "slot-queue" : admission.reason,
        state: "queued",
      };
    }
    const slot = leased.result.slot;
    const prefix = previewPrefix(slot);
    const previous = await this.state.readPreviewManifest(slot);
    const dev = previous ? undefined : await this.state.readDevManifest();
    if (!previous && !dev) {
      await this.rollbackNewLease(leased, slot, prefix);
      throw new Error(
        "A verified dev manifest is required before preview allocation",
      );
    }
    if (!previous && !(await this.state.hasSnapshot())) {
      await this.rollbackNewLease(leased, slot, prefix);
      throw new Error(
        "A verified dev data snapshot is required before preview allocation",
      );
    }
    const manifest = overlayManifest(
      (previous ?? dev).images,
      request.changedImages,
      request.revision,
    );
    const secrets =
      (await this.state.readSecrets(prefix)) ?? createRuntimeSecrets();
    await this.state.writeSecrets(prefix, secrets);
    try {
      await this.runtime.deploy({
        changedImages: request.changedImages,
        initial: previous === undefined,
        manifest,
        prefix,
        restoreSnapshot: previous === undefined,
        secrets,
        slot,
      });
      if (this.runtime.slotStorageBytes) {
        const bytes = await this.runtime.slotStorageBytes(prefix);
        if (bytes > previewSlotHardBytes) {
          throw new Error(
            "Preview slot exceeds its 250 MB hard storage budget",
          );
        }
      }
      await this.state.writePreviewManifest(slot, manifest);
      return {
        manifest,
        revision: manifest.revision,
        slot: prefix,
        state: "deployed",
        target: "preview",
        url: `https://preview-${String(slot).padStart(2, "0")}.brai.one`,
      };
    } catch (error) {
      if (!previous) await this.rollbackNewLease(leased, slot, prefix);
      throw error;
    }
  }

  async drainQueue() {
    while (true) {
      const registry = await this.state.readRegistry();
      const active = registry.slots.filter((slot) => slot.lease).length;
      if (active >= this.activeLimit || registry.queue.length === 0) return;
      const next = [...registry.queue].sort((left, right) => {
        const priority =
          Number(right.priority === "release") -
          Number(left.priority === "release");
        return priority || left.sequence - right.sequence;
      })[0];
      if (!next) return;
      const result = await this.deployPreview(next);
      if (result.state !== "deployed") return;
    }
  }

  /** @param {{ registry: ReturnType<typeof createRegistry>; result: { generation: number } }} leased @param {number} slot @param {string} prefix */
  async rollbackNewLease(leased, slot, prefix) {
    await this.runtime.cleanup(prefix).catch(() => undefined);
    const released = releaseLease(
      leased.registry,
      slot,
      leased.result.generation,
    );
    await this.state.writeRegistry(released.registry);
    await this.state.removePreviewManifest(slot);
    await this.state.removeSecrets(prefix);
  }

  /** @param {() => Promise<unknown>} operation */
  async serialize(operation) {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
