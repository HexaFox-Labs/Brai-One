import {
  BRAI_SANDBOX_ID_POOL_MAX_SLOT,
  BRAI_SANDBOX_ID_POOL_START,
  BRAI_SANDBOX_ID_RANGE_SIZE,
} from "@brai/contracts";
import { AccessPersistenceError } from "./errors.js";

export const MAX_ALLOCATION_SLOT = BRAI_SANDBOX_ID_POOL_MAX_SLOT;
export const ALLOCATION_STORAGE_ROOT = "/srv/brai-user-data";
export const OUTER_ID_RANGE_BASE = BRAI_SANDBOX_ID_POOL_START;
export const OUTER_ID_RANGE_COUNT = BRAI_SANDBOX_ID_RANGE_SIZE;
export const IMAGE_BRAI_ID_OFFSET = 1_000;
export const INNER_SUBID_OFFSET = 65_536;
export const INNER_SUBID_COUNT = 65_536;
export const XFS_PROJECT_ID_BASE = 10_000;

export type AllocationReservation = Readonly<{
  allocationSlot: number;
  environmentName: string;
  outerIdRangeStart: number;
  outerIdRangeCount: number;
  unixUid: number;
  unixGid: number;
  subuidStart: number;
  subgidStart: number;
  subidCount: number;
  quotaProjectId: number;
  storagePath: string;
  storageMountPoint: string;
}>;

export function allocationReservationForSlot(
  allocationSlot: number,
): AllocationReservation {
  if (
    !Number.isSafeInteger(allocationSlot) ||
    allocationSlot < 0 ||
    allocationSlot > MAX_ALLOCATION_SLOT
  ) {
    throw new AccessPersistenceError(
      "Allocation slot is outside the canonical policy",
    );
  }

  const environmentName = `brai-u-${allocationSlot.toString(36)}`;
  const outerIdRangeStart =
    OUTER_ID_RANGE_BASE + allocationSlot * OUTER_ID_RANGE_COUNT;

  return Object.freeze({
    allocationSlot,
    environmentName,
    outerIdRangeStart,
    outerIdRangeCount: OUTER_ID_RANGE_COUNT,
    unixUid: outerIdRangeStart + IMAGE_BRAI_ID_OFFSET,
    unixGid: outerIdRangeStart + IMAGE_BRAI_ID_OFFSET,
    subuidStart: outerIdRangeStart + INNER_SUBID_OFFSET,
    subgidStart: outerIdRangeStart + INNER_SUBID_OFFSET,
    subidCount: INNER_SUBID_COUNT,
    quotaProjectId: XFS_PROJECT_ID_BASE + allocationSlot,
    storagePath: `${ALLOCATION_STORAGE_ROOT}/${environmentName}`,
    storageMountPoint: ALLOCATION_STORAGE_ROOT,
  });
}
