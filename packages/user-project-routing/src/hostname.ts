import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import { UserProjectRoutingError } from "./errors.js";

export const PLATFORM_DOMAIN = "brightos.world";
const GENERATED_PREFIX = "project";
const VERIFICATION_LABEL = "_brai-domain-verification";
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SPECIAL_USE_SUFFIXES = Object.freeze([
  "localhost",
  "local",
  "internal",
  "invalid",
  "test",
  "example",
  "onion",
]);

function invalidDomain(message: string): never {
  throw new UserProjectRoutingError("domain_invalid", message);
}

export function canonicalizeCustomHostname(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes("*")) {
    return invalidDomain("Wildcard и пустые имена доменов запрещены");
  }
  if (trimmed.endsWith(".")) {
    return invalidDomain("Используйте hostname без завершающей точки");
  }
  if (isIP(trimmed) !== 0) {
    return invalidDomain("IP-адрес нельзя использовать вместо hostname");
  }

  const ascii = domainToASCII(trimmed).toLowerCase();
  if (ascii.length === 0 || ascii.length > 253 || isIP(ascii) !== 0) {
    return invalidDomain("Hostname имеет недопустимый формат");
  }

  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some((label) => !LABEL_PATTERN.test(label))) {
    return invalidDomain("Hostname должен быть полным DNS-именем");
  }

  if (ascii === PLATFORM_DOMAIN || ascii.endsWith(`.${PLATFORM_DOMAIN}`)) {
    throw new UserProjectRoutingError(
      "domain_reserved",
      "Домены brightos.world выдаются только платформой",
    );
  }

  if (
    SPECIAL_USE_SUFFIXES.some(
      (suffix) => ascii === suffix || ascii.endsWith(`.${suffix}`),
    )
  ) {
    return invalidDomain("Служебное или локальное имя домена запрещено");
  }
  if (`${VERIFICATION_LABEL}.${ascii}`.length > 253) {
    return invalidDomain("Hostname слишком длинный для verification record");
  }

  return ascii;
}

export function generatedProjectHostname(
  projectId: string,
  environmentId: string,
  port: number,
): string {
  const digest = createHash("sha256")
    .update(`${projectId}\u0000${environmentId}\u0000${String(port)}`)
    .digest("hex")
    .slice(0, 32);
  return `${GENERATED_PREFIX}-${digest}.${PLATFORM_DOMAIN}`;
}

export function customDomainVerificationRecord(hostname: string): string {
  return `${VERIFICATION_LABEL}.${hostname}`;
}
