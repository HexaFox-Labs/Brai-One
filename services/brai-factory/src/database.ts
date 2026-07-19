import { Pool } from "pg";

import type { Logger } from "@brai/runtime";

import type { FactoryConfig } from "./config.js";

export function createDatabase(
  config: FactoryConfig["database"],
  logger: Logger,
): Pool {
  const pool = new Pool(config);

  pool.on("error", (error) => {
    logger.error({ err: error }, "Ошибка простаивающего соединения PostgreSQL");
  });

  return pool;
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1 FROM brai_factory.activities LIMIT 1");

  const isolation = await pool.query<{ isolated: boolean }>(`
    SELECT (
      has_schema_privilege(
        current_user,
        'brai_factory',
        'USAGE'
      )
      AND NOT has_database_privilege(
        current_user,
        current_database(),
        'TEMPORARY'
      )
      AND NOT has_schema_privilege(
        current_user,
        'public',
        'USAGE'
      )
      AND NOT COALESCE(
        has_schema_privilege(
          current_user,
          to_regnamespace('net'),
          'USAGE'
        ),
        false
      )
    ) AS isolated
  `);

  if (isolation.rows[0]?.isolated !== true) {
    throw new Error("brai-factory database role isolation is invalid");
  }
}
