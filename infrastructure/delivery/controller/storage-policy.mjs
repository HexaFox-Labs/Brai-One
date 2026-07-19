import {
  hostFreeFloorBytes,
  previewDatabaseSoftBytes,
  previewDatabaseWarnBytes,
  previewSlotHardBytes,
} from "./constants.mjs";

/** @param {{ freeBytes: number; slotBytes?: number; active: number; activeLimit: number }} input */
export function assessPreviewAdmission(input) {
  if (
    !Number.isFinite(input.freeBytes) ||
    input.freeBytes < hostFreeFloorBytes
  ) {
    return { allowed: false, reason: "host-free-space-floor" };
  }
  if (!Number.isInteger(input.active) || input.active >= input.activeLimit) {
    return { allowed: false, reason: "active-preview-capacity" };
  }
  const slotBytes = input.slotBytes ?? 0;
  if (!Number.isFinite(slotBytes) || slotBytes > previewSlotHardBytes) {
    return { allowed: false, reason: "slot-hard-budget" };
  }
  return {
    allowed: true,
    warning:
      slotBytes >= previewDatabaseWarnBytes ||
      slotBytes >= previewDatabaseSoftBytes
        ? "slot-storage-warning"
        : undefined,
  };
}

/** @param {number} compressedBytes */
export function assessSnapshotSize(compressedBytes) {
  if (!Number.isFinite(compressedBytes) || compressedBytes < 0) {
    throw new Error("Snapshot size must be a non-negative number");
  }
  if (compressedBytes > previewDatabaseSoftBytes) {
    return { accepted: false, reason: "snapshot-hard-budget" };
  }
  return {
    accepted: true,
    warning:
      compressedBytes >= previewDatabaseWarnBytes
        ? "snapshot-storage-warning"
        : undefined,
  };
}
