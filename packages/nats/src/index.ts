import {
  NoRespondersError,
  RequestError,
  TimeoutError,
  type Msg,
  type NatsConnection,
  type Subscription,
} from "@nats-io/nats-core";
import { connect, type NodeConnectionOptions } from "@nats-io/transport-node";

export interface ConnectNatsOptions {
  servers: string | string[];
  user?: string;
  pass?: string;
  name?: string;
  inboxPrefix?: string;
  connectTimeoutMs?: number;
  reconnectTimeWaitMs?: number;
  maxReconnectAttempts?: number;
}

export interface RequestJsonOptions {
  timeoutMs?: number;
}

export type NatsRequestFailure =
  "timeout" | "no_responders" | "protocol_error" | "transport_error";

export class NatsRequestError extends Error {
  public readonly kind: NatsRequestFailure;
  public readonly subject: string;

  public constructor(
    kind: NatsRequestFailure,
    subject: string,
    options?: ErrorOptions,
  ) {
    super(`NATS request failed for ${subject}: ${kind}`, options);
    this.name = "NatsRequestError";
    this.kind = kind;
    this.subject = subject;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

export function decodeJson<T>(data: Uint8Array): T {
  try {
    return JSON.parse(decoder.decode(data)) as T;
  } catch (error) {
    throw new NatsRequestError("protocol_error", "unknown", {
      cause: error,
    });
  }
}

export async function connectNats(
  options: ConnectNatsOptions,
): Promise<NatsConnection> {
  const connectionOptions: NodeConnectionOptions = {
    servers: options.servers,
    timeout: options.connectTimeoutMs ?? 5_000,
    reconnectTimeWait: options.reconnectTimeWaitMs ?? 2_000,
    maxReconnectAttempts: options.maxReconnectAttempts ?? -1,
  };

  if (options.user !== undefined) {
    connectionOptions.user = options.user;
  }
  if (options.pass !== undefined) {
    connectionOptions.pass = options.pass;
  }
  if (options.name !== undefined) {
    connectionOptions.name = options.name;
  }
  if (options.inboxPrefix !== undefined) {
    connectionOptions.inboxPrefix = options.inboxPrefix;
  }

  return connect(connectionOptions);
}

function classifyRequestError(error: unknown): NatsRequestFailure {
  if (error instanceof TimeoutError) {
    return "timeout";
  }

  if (
    error instanceof NoRespondersError ||
    (error instanceof RequestError && error.isNoResponders())
  ) {
    return "no_responders";
  }

  return "transport_error";
}

export async function requestJson<TRequest, TResponse>(
  connection: NatsConnection,
  subject: string,
  request: TRequest,
  options: RequestJsonOptions = {},
): Promise<TResponse> {
  let response: Msg;

  try {
    response = await connection.request(subject, encodeJson(request), {
      timeout: options.timeoutMs ?? 5_000,
    });
  } catch (error) {
    throw new NatsRequestError(classifyRequestError(error), subject, {
      cause: error,
    });
  }

  try {
    return decodeJson<TResponse>(response.data);
  } catch (error) {
    throw new NatsRequestError("protocol_error", subject, {
      cause: error,
    });
  }
}

export function respondJson(message: Msg, response: unknown): boolean {
  return message.respond(encodeJson(response));
}

export function isNatsReady(connection: NatsConnection): boolean {
  return !connection.isClosed() && !connection.isDraining();
}

export async function drainNats(connection: NatsConnection): Promise<void> {
  if (connection.isClosed() || connection.isDraining()) {
    return;
  }

  await connection.drain();
}

export const drain = drainNats;

export type { Msg, NatsConnection, Subscription };
