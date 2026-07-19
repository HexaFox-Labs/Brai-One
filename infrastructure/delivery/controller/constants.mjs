export const deliveryContractVersion = "brai.delivery.request.v1";
export const expectedRepository = "HexaFox-Labs/Brai-One";
export const runtimeServices = Object.freeze([
  "@brai/api-gateway",
  "@brai/brai-access",
  "@brai/brai-factory",
  "@brai/nats",
  "@brai/web",
]);
export const imageNames = Object.freeze([
  "access",
  "access-admin",
  "api-gateway",
  "factory",
  "factory-admin",
  "nats",
  "web",
]);
export const imageByService = Object.freeze({
  "@brai/api-gateway": "api-gateway",
  "@brai/brai-access": "access",
  "@brai/brai-factory": "factory",
  "@brai/nats": "nats",
  "@brai/web": "web",
});
export const previewSlotCount = 20;
export const previewActiveLimit = 5;
export const previewWebPortStart = 3411;
export const previewGatewayPortStart = 3511;
export const devWebPort = 3400;
export const devGatewayPort = 3500;
export const deliveryPort = 3490;
export const previewDatabaseSoftBytes = 200 * 1024 * 1024;
export const previewDatabaseWarnBytes = 80 * 1024 * 1024;
export const previewSlotHardBytes = 250 * 1024 * 1024;
export const previewLogBudgetBytes = 10 * 1024 * 1024;
export const previewMiscBudgetBytes = 20 * 1024 * 1024;
export const hostFreeFloorBytes = 25 * 1024 * 1024 * 1024;

export function previewPrefix(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > previewSlotCount) {
    throw new Error("Preview slot is outside the configured range");
  }
  return `p${String(slot).padStart(2, "0")}`;
}

export function previewHostname(slot) {
  return `preview-${String(slot).padStart(2, "0")}.brai.one`;
}

export function previewWebPort(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > previewSlotCount) {
    throw new Error("Preview slot is outside the configured range");
  }
  return previewWebPortStart + slot - 1;
}

export function previewGatewayPort(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > previewSlotCount) {
    throw new Error("Preview slot is outside the configured range");
  }
  return previewGatewayPortStart + slot - 1;
}
