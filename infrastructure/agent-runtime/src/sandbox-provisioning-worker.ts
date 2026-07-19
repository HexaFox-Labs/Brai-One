import { RUNTIME_USER_ENVIRONMENT_PROVISION_SUBJECT } from "@brai/contracts";
import { decodeJson, respondJson, type NatsConnection } from "@brai/nats";

import {
  type SandboxProvisioningHostService,
  type SandboxProvisioningLogger,
} from "./sandbox-provisioning-service.js";

export const SANDBOX_PROVISIONING_QUEUE_GROUP =
  "brai-runtime-host-provision-v1";

export async function runSandboxProvisioningWorker(
  connection: NatsConnection,
  service: SandboxProvisioningHostService,
  logger: SandboxProvisioningLogger,
): Promise<void> {
  const subscription = connection.subscribe(
    RUNTIME_USER_ENVIRONMENT_PROVISION_SUBJECT,
    { queue: SANDBOX_PROVISIONING_QUEUE_GROUP },
  );
  logger.info(
    {
      subject: RUNTIME_USER_ENVIRONMENT_PROVISION_SUBJECT,
      queue_group: SANDBOX_PROVISIONING_QUEUE_GROUP,
    },
    "Trusted runtime host слушает environment provisioning",
  );
  for await (const message of subscription) {
    let input: unknown;
    try {
      input = decodeJson<unknown>(message.data);
    } catch {
      input = undefined;
    }
    const response = await service.handleProvision(input);
    if (!respondJson(message, response)) {
      logger.warn(
        { request_id: response.request_id },
        "Environment provision request не содержит reply subject",
      );
    }
  }
}
