import { createPrivateKey, KeyObject } from "node:crypto";

import {
  issueInternalAgentLaunchContract,
  type LaunchContractPrivateKey,
} from "@brai/agent-access";
import {
  MAX_AGENT_LAUNCH_CONTRACT_LIFETIME_MS,
  type InternalAgentLaunchContract,
} from "@brai/contracts";

import type { PendingLaunch } from "./types.js";
import {
  WEB_AGENT_COMMAND_SHA256,
  webAgentJobReference,
} from "./web-agent-job-policy.js";

export type IssueWebAgentLaunchInput = Readonly<{
  launch: PendingLaunch;
  /**
   * Kept as stdin data. Its SHA-256 is already bound into launch.job.reference.
   */
  prompt: string;
}>;

export interface LaunchContractIssuer {
  issue(input: IssueWebAgentLaunchInput): Promise<InternalAgentLaunchContract>;
}

export type Ed25519LaunchContractIssuerOptions = Readonly<{
  keyId: string;
  privateKey: LaunchContractPrivateKey;
  lifetimeMs?: number;
  now?: () => Date;
}>;

/**
 * The signing key comes from server configuration outside the repository.
 * Constructing this issuer at process startup makes signing configuration fail
 * before the NATS worker accepts requests.
 */
export class Ed25519LaunchContractIssuer implements LaunchContractIssuer {
  private readonly lifetimeMs: number;
  private readonly now: () => Date;
  private readonly privateKey: KeyObject;

  public constructor(
    private readonly options: Ed25519LaunchContractIssuerOptions,
  ) {
    this.lifetimeMs = options.lifetimeMs ?? 2 * 60 * 1_000;
    if (
      !Number.isSafeInteger(this.lifetimeMs) ||
      this.lifetimeMs <= 0 ||
      this.lifetimeMs > MAX_AGENT_LAUNCH_CONTRACT_LIFETIME_MS
    ) {
      throw new Error("Invalid launch contract lifetime");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(options.keyId)) {
      throw new Error("Invalid launch contract key ID");
    }
    this.privateKey =
      options.privateKey instanceof KeyObject
        ? options.privateKey
        : createPrivateKey(options.privateKey);
    if (
      this.privateKey.type !== "private" ||
      this.privateKey.asymmetricKeyType !== "ed25519"
    ) {
      throw new Error("Launch contract key must be private Ed25519");
    }
    this.now = options.now ?? (() => new Date());
  }

  public async issue(
    input: IssueWebAgentLaunchInput,
  ): Promise<InternalAgentLaunchContract> {
    if (
      input.launch.job.reference !== webAgentJobReference(input.prompt) ||
      input.launch.job.command_sha256 !== WEB_AGENT_COMMAND_SHA256
    ) {
      throw new Error(
        "Pending launch is not bound to the approved web-agent job",
      );
    }
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + this.lifetimeMs);
    return issueInternalAgentLaunchContract({
      runId: input.launch.run_id,
      projectId: input.launch.project_id,
      environmentId: input.launch.environment_id,
      job: input.launch.job,
      access: input.launch.access,
      issuedAt,
      expiresAt,
      keyId: this.options.keyId,
      privateKey: this.privateKey,
    });
  }
}
