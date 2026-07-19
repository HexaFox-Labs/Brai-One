import { readFile } from "node:fs/promises";

import { previewActiveLimit } from "./constants.mjs";
import { ControllerState } from "./controller-state.mjs";
import { DeliveryController } from "./delivery-controller.mjs";
import { DockerRuntime } from "./docker-runtime.mjs";

const root = process.env.BRAI_DELIVERY_ROOT ?? "/srv/opt/brai-delivery";
const configurationPath =
  process.env.BRAI_DELIVERY_CONFIG ?? "/etc/brai-delivery/controller.json";
const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
if (
  !Number.isInteger(configuration.active_preview_limit) ||
  configuration.active_preview_limit < 1 ||
  configuration.active_preview_limit > previewActiveLimit
) {
  throw new Error("Delivery controller configuration is invalid");
}
const result = await new DeliveryController({
  activeLimit: configuration.active_preview_limit,
  runtime: new DockerRuntime({ root }),
  state: new ControllerState(root),
}).sweep();
console.info(JSON.stringify(result));
