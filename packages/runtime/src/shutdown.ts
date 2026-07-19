import type { Logger } from "pino";

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface GracefulShutdownOptions {
  logger: Logger;
  shutdown: (signal: ShutdownSignal) => Promise<void>;
  timeoutMs?: number;
  signals?: readonly ShutdownSignal[];
}

function timeoutAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Graceful shutdown did not finish within ${timeoutMs} milliseconds`,
        ),
      );
    }, timeoutMs);
    timeout.unref();
  });
}

export function installGracefulShutdown(
  options: GracefulShutdownOptions,
): () => void {
  const signals = options.signals ?? ["SIGINT", "SIGTERM"];
  const timeoutMs = options.timeoutMs ?? 10_000;
  const listeners = new Map<ShutdownSignal, () => void>();
  let shuttingDown = false;

  const run = async (signal: ShutdownSignal): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    options.logger.info({ signal }, "Получен сигнал завершения");

    try {
      await Promise.race([options.shutdown(signal), timeoutAfter(timeoutMs)]);
      options.logger.info({ signal }, "Корректное завершение выполнено");
    } catch (error) {
      process.exitCode = 1;
      options.logger.error(
        { error, signal },
        "Не удалось корректно завершить процесс",
      );
    }
  };

  for (const signal of signals) {
    const listener = (): void => {
      void run(signal);
    };
    listeners.set(signal, listener);
    process.once(signal, listener);
  }

  return () => {
    for (const [signal, listener] of listeners) {
      process.off(signal, listener);
    }
  };
}
