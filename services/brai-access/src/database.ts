import { Pool } from "pg";

import type { Logger } from "@brai/runtime";

import type { AccessConfig } from "./config.js";

export function createAccessDatabase(
  config: AccessConfig["database"],
  logger: Logger,
): Pool {
  const pool = new Pool(config);

  pool.on("error", (error) => {
    logger.error(
      { err: error },
      "Ошибка простаивающего соединения brai-access",
    );
  });

  return pool;
}

export async function checkAccessDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1 FROM brai_access.user_access_states LIMIT 1");

  const isolation = await pool.query<{ isolated: boolean }>(`
    SELECT (
      has_schema_privilege(current_user, 'brai_access', 'USAGE')
      AND NOT has_database_privilege(
        current_user,
        current_database(),
        'TEMPORARY'
      )
      AND NOT has_schema_privilege(current_user, 'public', 'USAGE')
      AND NOT COALESCE(
        has_schema_privilege(current_user, to_regnamespace('net'), 'USAGE'),
        false
      )
    ) AS isolated
  `);

  if (isolation.rows[0]?.isolated !== true) {
    throw new Error("brai-access database role isolation is invalid");
  }
}
