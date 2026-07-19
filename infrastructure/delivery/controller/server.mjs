import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import {
  deliveryPort,
  expectedRepository,
  previewActiveLimit,
} from "./constants.mjs";
import { ControllerState } from "./controller-state.mjs";
import { DeliveryController } from "./delivery-controller.mjs";
import { DockerRuntime } from "./docker-runtime.mjs";
import { GitHubOidcVerifier } from "./github-oidc.mjs";
import {
  authorizeDelivery,
  authorizePreviewRelease,
  authorizePreviewStatus,
} from "./oidc-policy.mjs";
import {
  parseDeliveryRequest,
  parsePreviewReleaseRequest,
  parsePreviewStatusBranch,
} from "./request-policy.mjs";

const maximumBodyBytes = 64 * 1024;

/** @param {{ controller: DeliveryController; verifier: GitHubOidcVerifier; port?: number }} options */
export function createDeliveryServer(options) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://brai-delivery.local");
      if (request.method === "GET" && url.pathname === "/healthz") {
        return send(response, 200, { status: "ok" });
      }
      if (request.method === "GET" && url.pathname === "/v1/status") {
        const branch = parsePreviewStatusBranch(url.searchParams.get("branch"));
        const claims = await options.verifier.verify(
          readBearerToken(request.headers.authorization),
        );
        authorizePreviewStatus(claims, branch);
        return send(
          response,
          200,
          await options.controller.previewStatus(branch),
        );
      }
      if (
        request.method !== "POST" ||
        !["/v1/request", "/v1/release"].includes(url.pathname)
      ) {
        return send(response, 404, { error: "not-found" });
      }
      const body = await readJsonBody(request);
      const claims = await options.verifier.verify(
        readBearerToken(request.headers.authorization),
      );
      if (url.pathname === "/v1/request") {
        const parsed = parseDeliveryRequest(body);
        authorizeDelivery(claims, parsed);
        return send(response, 200, await options.controller.submit(body));
      }
      const parsed = parsePreviewReleaseRequest(body);
      authorizePreviewRelease(claims, parsed.branch);
      return send(response, 200, await options.controller.release(body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      return send(response, 400, { error: "rejected", message });
    }
  });
}

async function main() {
  const configuration = await readConfiguration(
    process.env.BRAI_DELIVERY_CONFIG ?? "/etc/brai-delivery/controller.json",
  );
  const root = process.env.BRAI_DELIVERY_ROOT ?? "/srv/opt/brai-delivery";
  const controller = new DeliveryController({
    activeLimit: configuration.active_preview_limit,
    runtime: new DockerRuntime({ root }),
    state: new ControllerState(root),
  });
  const server = createDeliveryServer({
    controller,
    verifier: new GitHubOidcVerifier({ audience: configuration.oidc_audience }),
  });
  server.listen(deliveryPort, "127.0.0.1", () => {
    console.info(`brai_delivery_controller=ready port=${deliveryPort}`);
  });
}

/** @param {string} path */
async function readConfiguration(path) {
  const source = await readFile(path, "utf8");
  const value = JSON.parse(source);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema_version !== "brai.delivery.controller.v1" ||
    value.expected_repository !== expectedRepository ||
    value.oidc_audience !== "brai-delivery" ||
    !Number.isInteger(value.active_preview_limit) ||
    value.active_preview_limit < 1 ||
    value.active_preview_limit > previewActiveLimit
  ) {
    throw new Error("Delivery controller configuration is invalid");
  }
  return value;
}

/** @param {import("node:http").IncomingMessage} request */
async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBodyBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (bytes === 0) throw new Error("Request body is empty");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body is not JSON");
  }
}

/** @param {string | undefined} value */
function readBearerToken(value) {
  const match = value?.match(/^Bearer ([A-Za-z0-9_.-]+)$/u);
  if (!match?.[1]) throw new Error("Bearer token is required");
  return match[1];
}

/** @param {import("node:http").ServerResponse} response @param {number} status @param {unknown} body */
function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
