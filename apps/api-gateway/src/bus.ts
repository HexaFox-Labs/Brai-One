import { isNatsReady, requestJson, type NatsConnection } from "@brai/nats";

export interface GatewayMessageBus {
  request<TRequest, TResponse>(
    subject: string,
    request: TRequest,
  ): Promise<TResponse>;
  isReady(): Promise<boolean>;
  drain(): Promise<void>;
}

const READINESS_TIMEOUT_MS = 1_000;

async function probeNatsReadiness(
  connection: NatsConnection,
): Promise<boolean> {
  if (!isNatsReady(connection)) {
    return false;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      connection.rtt(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("NATS readiness probe timed out")),
          READINESS_TIMEOUT_MS,
        );
      }),
    ]);

    return isNatsReady(connection);
  } catch {
    return false;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function createGatewayMessageBus(
  connection: NatsConnection,
  timeoutMs: number,
): GatewayMessageBus {
  let activeReadinessProbe: Promise<boolean> | null = null;

  return {
    request: async <TRequest, TResponse>(
      subject: string,
      request: TRequest,
    ): Promise<TResponse> =>
      requestJson<TRequest, TResponse>(connection, subject, request, {
        timeoutMs,
      }),
    isReady: () => {
      activeReadinessProbe ??= probeNatsReadiness(connection).finally(() => {
        activeReadinessProbe = null;
      });

      return activeReadinessProbe;
    },
    drain: async () => {
      if (!connection.isClosed() && !connection.isDraining()) {
        await connection.drain();
      }
    },
  };
}
