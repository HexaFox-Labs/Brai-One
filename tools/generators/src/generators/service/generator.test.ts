import { readProjectConfiguration } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import serviceGenerator from "./generator.js";

describe("service generator", () => {
  it("creates a prefixed NATS service", async () => {
    const tree = createTreeWithEmptyWorkspace();
    await serviceGenerator(tree, { name: "email", kind: "service" });

    expect(tree.exists("services/brai-email/src/index.ts")).toBe(true);
    expect(tree.read("services/brai-email/package.json", "utf8")).toContain(
      "@brai/email",
    );
    expect(
      tree.read("services/brai-email/compose.fragment.yml", "utf8") ?? "",
    ).toContain("brai-bus");
    expect(readProjectConfiguration(tree, "service-brai-email").root).toBe(
      "services/brai-email",
    );
    expect(tree.exists("infrastructure/supabase/migrations")).toBe(false);
  });

  it("creates a worker and database migration stub", async () => {
    const tree = createTreeWithEmptyWorkspace();
    await serviceGenerator(tree, {
      name: "brai-indexer",
      kind: "worker",
      database: true,
    });

    expect(tree.exists("workers/brai-indexer/src/healthcheck.ts")).toBe(true);
    const packageJson = JSON.parse(
      tree.read("workers/brai-indexer/package.json", "utf8") ?? "{}",
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines: { node: string };
    };

    expect(packageJson.engines.node).toBe(">=22.22.3 <23");
    expect(packageJson.dependencies.pg).toBe("8.16.3");
    expect(packageJson.devDependencies["@types/pg"]).toBe("8.15.5");
    expect(
      tree.read("workers/brai-indexer/compose.fragment.yml", "utf8") ?? "",
    ).toContain("brai-supabase");
    expect(
      tree.read("workers/brai-indexer/compose.fragment.yml", "utf8") ?? "",
    ).toContain("context: .");
    expect(
      tree.read("workers/brai-indexer/compose.fragment.yml", "utf8") ?? "",
    ).not.toContain("external: true");
    expect(
      tree.read("workers/brai-indexer/src/healthcheck.ts", "utf8") ?? "",
    ).toContain("rejectUnauthorized");
    expect(
      tree.read("workers/brai-indexer/src/index.ts", "utf8") ?? "",
    ).toContain("new pg.Pool");
    const runtimeSource =
      tree.read("workers/brai-indexer/src/index.ts", "utf8") ?? "";
    expect(runtimeSource).toContain("max: environment.DATABASE_POOL_MAX");
    expect(runtimeSource).toContain("lock_timeout");
    expect(runtimeSource).toContain("idle_in_transaction_session_timeout");

    const environment =
      tree.read("workers/brai-indexer/.env.example", "utf8") ?? "";
    expect(environment).toContain("DATABASE_POOL_MAX=10");
    expect(environment).toContain("DATABASE_LOCK_TIMEOUT_MS=2000");
    expect(environment).toContain("DATABASE_IDLE_TRANSACTION_TIMEOUT_MS=5000");

    const dockerfile =
      tree.read("workers/brai-indexer/Dockerfile", "utf8") ?? "";
    expect(dockerfile).toContain("node:22.22.3-alpine3.23@sha256:");
    expect(dockerfile).not.toContain("node:22.16.0");

    const migrationChange = tree
      .listChanges()
      .find((change) =>
        change.path.startsWith("infrastructure/supabase/migrations/"),
      );
    expect(migrationChange).toBeDefined();
    const migration = migrationChange
      ? (tree.read(migrationChange.path, "utf8") ?? "")
      : "";
    expect(migration).toContain("CREATE ROLE brai_indexer_runtime");
    expect(migration).toContain("NOLOGIN");
    expect(migration).toContain("CONNECTION LIMIT 10");
    expect(migration).toContain(
      "GRANT USAGE ON SCHEMA brai_indexer TO brai_indexer_runtime",
    );
    expect(migration).toContain("SET statement_timeout TO '4s'");
    expect(migration).not.toContain(
      "GRANT ALL ON ALL TABLES IN SCHEMA brai_indexer",
    );
    expect(migration).toContain(
      "REVOKE ALL ON ALL ROUTINES IN SCHEMA brai_indexer FROM PUBLIC, brai_indexer_runtime",
    );
  });

  it("rejects database role names that PostgreSQL would truncate", async () => {
    const tree = createTreeWithEmptyWorkspace();

    await expect(
      serviceGenerator(tree, {
        name: `service-${"a".repeat(60)}`,
        kind: "service",
        database: true,
      }),
    ).rejects.toThrow(/too long for PostgreSQL identifiers/);
  });

  it("emits syntactically valid TypeScript entrypoints", async () => {
    const tree = createTreeWithEmptyWorkspace();
    await serviceGenerator(tree, {
      name: "audit",
      kind: "service",
      database: true,
    });

    for (const path of [
      "services/brai-audit/src/index.ts",
      "services/brai-audit/src/healthcheck.ts",
      "services/brai-audit/src/identity.test.ts",
    ]) {
      const source = tree.read(path, "utf8") ?? "";
      const result = ts.transpileModule(source, {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          target: ts.ScriptTarget.ES2022,
        },
      });

      expect(result.diagnostics ?? []).toEqual([]);
    }
  });

  it("produces a Compose overlay that merges with the root stack", async () => {
    const tree = createTreeWithEmptyWorkspace();
    await serviceGenerator(tree, {
      name: "audit",
      kind: "worker",
      database: true,
    });
    const directory = await mkdtemp(
      resolve(tmpdir(), "brai-generator-compose-"),
    );
    const fragmentPath = resolve(directory, "compose.fragment.yml");

    try {
      await writeFile(
        fragmentPath,
        tree.read("workers/brai-audit/compose.fragment.yml", "utf8") ?? "",
      );
      execFileSync(
        "docker",
        [
          "compose",
          "-f",
          resolve(import.meta.dirname, "../../../../../compose.yml"),
          "-f",
          fragmentPath,
          "config",
          "--quiet",
        ],
        {
          env: {
            ...process.env,
            BRAI_CONFIG_DIR: resolve(directory, "missing-config"),
          },
          stdio: "pipe",
        },
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
