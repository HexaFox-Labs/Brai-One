import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityRepository } from "../src/repository.js";

const testDatabaseUrl = process.env.BRAI_FACTORY_TEST_DATABASE_URL;
const describeIntegration = testDatabaseUrl ? describe : describe.skip;
const REQUEST_ID = "3f88bde1-2b49-46cb-914d-7500afdf82d6";
const IDEMPOTENCY_KEY = "6a8b067a-83df-4247-bd33-397db9f4b0e0";

describeIntegration("ActivityRepository PostgreSQL integration", () => {
  const pool = new Pool({
    application_name: "brai-factory-integration-test",
    connectionString: testDatabaseUrl,
    max: 2,
  });
  const repository = new ActivityRepository(pool);

  beforeAll(async () => {
    const migrationPath = fileURLToPath(
      new URL(
        "../../../infrastructure/supabase/migrations/0001_brai_factory.sql",
        import.meta.url,
      ),
    );
    const migration = await readFile(migrationPath, "utf8");

    await pool.query(migration);
    await pool.query("TRUNCATE TABLE brai_factory.activities");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates, replays and lists a persisted Activity", async () => {
    const payload = {
      idempotency_key: IDEMPOTENCY_KEY,
      title: "Интеграционная активность",
      description: "Записана в PostgreSQL",
    };

    const created = await repository.createActivity(payload, REQUEST_ID);
    const replayed = await repository.createActivity(payload, REQUEST_ID);
    const listed = await repository.listActivities({
      cursor: null,
      limit: 50,
    });

    expect(created.idempotentReplay).toBe(false);
    expect(replayed).toEqual({
      activity: created.activity,
      idempotentReplay: true,
    });
    expect(listed.activities).toContainEqual(created.activity);
  });
});
