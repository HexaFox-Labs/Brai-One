import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const deploymentPath = "/home/mark/DEPLOYMENT.md";
const stateRoot = resolve(
  process.env.DOCFLOW_STATE_DIR ??
    `${tmpdir()}/brai-new-docflow-${hashText(root).slice(0, 12)}`,
);
const blockedPathParts = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".server-secrets",
  ".env",
];

const fullPatterns = [
  /architecture|architectural|security|auth|permission|access boundary/iu,
  /contract|public api|nats|schema|migration|data ownership|service boundary/iu,
  /infrastructure|deployment|deploy|compose|dockerfile|systemd|caddy/iu,
  /dependency|runtime|package\.json|pnpm-lock|openspec|adr|decision/iu,
];
const quickPatterns = [
  /typo|spelling|formatting|format-only|read-only|test-only|tests only/iu,
  /internal refactor|rename without behavior|no behavior change/iu,
];
const behaviorPatterns = [
  /behavior|behaviour|feature|functionality|contract|api|workflow|user path/iu,
  /add|change|remove|deprecate|support|route|permission|policy/iu,
];

const commands = {
  docs: ["pnpm", ["run", "docs:check"]],
  adr: ["pnpm", ["run", "adr:check"]],
  specs: ["openspec", ["validate", "--specs"]],
  specsFull: ["openspec", ["validate", "--all", "--strict"]],
  ci: ["pnpm", ["run", "ci"]],
};

export function normalizeContext(input = {}) {
  const context = input && typeof input === "object" ? input : {};
  const files = unique(
    [...(context.files ?? []), ...(context.paths ?? [])]
      .map((file) => (typeof file === "string" ? file : file?.path))
      .filter(Boolean),
  );
  const surfaces = unique([
    ...(Array.isArray(context.surfaces) ? context.surfaces : []),
    ...(Array.isArray(context.impact) ? context.impact : []),
  ]).map((surface) => String(surface).toLowerCase());
  return {
    source: context.source ?? inferSource(context),
    taskId: context.taskId ?? null,
    parentTaskId: context.parentTaskId ?? null,
    changeId: context.changeId ?? null,
    intent: String(context.intent ?? context.description ?? ""),
    files,
    surfaces,
    routeHint: context.route ?? context.routeHint ?? null,
    status: context.status ?? null,
    behaviorChanged: context.behaviorChanged,
    uncertain: Boolean(context.uncertain),
    noChangeReason: context.noChangeReason ?? null,
    evidence: context.evidence ?? null,
    docs: context.docs ?? context.documentation ?? null,
    spec: context.spec ?? context.openspec ?? null,
    adr: context.adr ?? null,
    memory: context.memory ?? null,
    runCi: Boolean(context.runCi ?? context.ci),
    raw: context,
  };
}

export function deriveSurfaces(files = [], explicit = []) {
  const surfaces = new Set(explicit.map((surface) => String(surface)));
  for (const file of files) {
    const normalized = file.replaceAll("\\", "/").toLowerCase();
    if (normalized.includes("openspec/")) surfaces.add("spec");
    if (normalized.includes("docs/")) surfaces.add("docs");
    if (normalized.includes("docs/decisions/")) surfaces.add("adr");
    if (normalized.includes("memory-bank/")) surfaces.add("memory");
    if (normalized.includes("deployment.md")) surfaces.add("deployment");
    if (
      normalized === "agents.md" ||
      normalized.endsWith("package.json") ||
      normalized.includes("compose") ||
      normalized.endsWith(".yml") ||
      normalized.endsWith(".yaml")
    ) {
      surfaces.add("config");
    }
    if (
      /(^|\/)(apps|libs|packages|services|src|tools)\//u.test(normalized) ||
      /\.(ts|tsx|js|mjs|cjs|sql|graphql)$/u.test(normalized)
    ) {
      surfaces.add("code");
    }
  }
  return [...surfaces].sort();
}

export function classify(input = {}) {
  const context = normalizeContext(input);
  const files = context.files;
  const surfaces = deriveSurfaces(files, context.surfaces);
  const signalText = [context.intent, ...files, ...surfaces].join(" ");
  const quickHint =
    context.routeHint === "quick" ||
    quickPatterns.some((pattern) => pattern.test(signalText));
  const trivial = quickPatterns.some((pattern) => pattern.test(context.intent));
  const hardFullSignal = fullPatterns.some((pattern) =>
    pattern.test(signalText),
  );
  const hardFull = context.routeHint === "full" || (hardFullSignal && !trivial);
  const behavior =
    context.behaviorChanged === true ||
    (!trivial &&
      context.behaviorChanged !== false &&
      (behaviorPatterns.some((pattern) => pattern.test(context.intent)) ||
        surfaces.includes("code")));
  const hasEvidence = Boolean(
    context.intent || files.length || surfaces.length || context.routeHint,
  );
  const uncertain = context.uncertain || !hasEvidence;

  let route = "normal";
  if (hardFull) route = "full";
  else if (quickHint && !behavior) route = "quick";

  if (uncertain && route === "quick") route = "normal";

  const reasons = [];
  if (hardFull) reasons.push("high-impact signal");
  if (quickHint && route === "quick") reasons.push("trivial-change signal");
  if (behavior) reasons.push("behavior or source surface");
  if (uncertain) reasons.push("insufficient routing evidence");
  if (reasons.length === 0) reasons.push("ordinary project change");

  return {
    route,
    confidence: uncertain ? "low" : hardFull || quickHint ? "high" : "medium",
    uncertain,
    reason: reasons.join(", "),
    signals: {
      hardFull,
      quickHint,
      behavior,
      files: files.length,
      surfaces,
    },
    source: context.source,
    taskId: context.taskId,
    parentTaskId: context.parentTaskId,
    changeId: context.changeId,
  };
}

export function requiredReviews(input = {}, classification = classify(input)) {
  const context = normalizeContext(input);
  const surfaces = classification.signals.surfaces;
  const intent = context.intent;
  const trivial = quickPatterns.some((pattern) => pattern.test(intent));
  const behavior =
    context.behaviorChanged === true ||
    (!trivial &&
      (classification.signals.behavior ||
        /behavior|contract|feature|workflow|architecture/iu.test(intent)));
  return {
    docs:
      surfaces.includes("docs") ||
      (surfaces.includes("code") && !trivial) ||
      behavior ||
      classification.route === "full",
    spec:
      surfaces.includes("spec") || behavior || classification.route === "full",
    adr:
      surfaces.includes("adr") ||
      classification.route === "full" ||
      /architecture|security|infrastructure|dependency|contract|boundary|decision/iu.test(
        intent,
      ),
    memory: surfaces.includes("memory") || classification.route === "full",
    deployment:
      surfaces.includes("deployment") ||
      /deployment|install|host service|systemd|caddy/iu.test(context.intent),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help" || options.command === "--help") {
    printHelp();
    return { ok: true, command: "help" };
  }

  const context = normalizeContext(await loadContext(options.context));
  const classification = classify(context.raw);
  const reviews = requiredReviews(context.raw, classification);

  if (options.command === "classify" || options.command === "audit") {
    const result = {
      schemaVersion: 1,
      command: options.command,
      ok: true,
      classification,
      requiredReviews: reviews,
      files: context.files,
      next: options.command === "audit" ? "agent-review" : "preflight",
    };
    emit(result, options.json);
    return result;
  }

  if (!new Set(["preflight", "finalize"]).has(options.command)) {
    throw new Error(`Unknown docflow command: ${options.command}`);
  }

  const files = await resolveInputFiles(context.files);
  if (options.command === "preflight") {
    const runId = options.runId ?? makeRunId();
    const baseline = await snapshot(files);
    const state = {
      schemaVersion: 1,
      runId,
      createdAt: new Date().toISOString(),
      projectRoot: root,
      context,
      classification,
      requiredReviews: reviews,
      files,
      baseline,
    };
    const statePath = await writeRunState(runId, state);
    const result = {
      schemaVersion: 1,
      command: "preflight",
      ok: true,
      runId,
      statePath,
      classification,
      requiredReviews: reviews,
      files: files.map(displayPath),
      baseline: {
        captured: Object.keys(baseline).length,
        missingManifest: files.length === 0,
      },
      next: "implement then run docflow finalize with the same runId",
    };
    emit(result, options.json);
    return result;
  }

  const runId = options.runId ?? context.raw.runId;
  if (!runId) {
    const result = failureResult("finalize", [
      "missing runId: run preflight first or provide an existing state context",
    ]);
    emit(result, options.json);
    return result;
  }
  const state = await readRunState(runId);
  const currentFiles = files.length > 0 ? files : (state.files ?? []);
  const after = await snapshot(currentFiles);
  const changed = compareSnapshots(state.baseline ?? {}, after);
  const checks = await runChecks(
    classification,
    reviews,
    currentFiles,
    after,
    options,
    context,
  );
  const errors = validateFinalization(context, classification, reviews, {
    state,
    changed,
    checks,
    files: currentFiles,
  });
  const result = {
    schemaVersion: 1,
    command: "finalize",
    ok: errors.length === 0,
    runId,
    statePath: state.path ?? null,
    classification,
    requiredReviews: reviews,
    files: currentFiles.map(displayPath),
    changes: changed,
    checks,
    decisions: {
      docs: decisionValue(context.docs),
      spec: decisionValue(context.spec),
      adr: decisionValue(context.adr),
    },
    blockers: errors,
    status: errors.length === 0 ? "complete" : "pending-governance",
  };
  await writeFinalState(runId, result);
  emit(result, options.json);
  return result;
}

function parseArgs(args) {
  if (args[0] === "--") args = args.slice(1);
  const options = {
    command: args[0] ?? "help",
    context: null,
    runId: null,
    json: false,
    ci: false,
    noCache: false,
  };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--ci") options.ci = true;
    else if (arg === "--no-cache") options.noCache = true;
    else if (arg === "--context") options.context = args[++index];
    else if (arg === "--run-id") options.runId = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function loadContext(contextPath) {
  if (!contextPath && !process.env.DOCFLOW_CONTEXT) return {};
  const raw = contextPath
    ? contextPath === "-"
      ? await readFile(0, "utf8")
      : await readFile(resolve(root, contextPath), "utf8")
    : process.env.DOCFLOW_CONTEXT;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid docflow context JSON: ${error.message}`);
  }
}

function inferSource(context) {
  if (context.changeId) return "openspec";
  if (context.taskId || context.parentTaskId) return "task-db";
  return "direct";
}

async function resolveInputFiles(inputFiles) {
  let candidates = inputFiles;
  if (candidates.length === 0) candidates = gitChangedFiles();
  const resolvedFiles = [];
  for (const candidate of candidates) {
    const absolute = safeResolve(candidate);
    if (!existsSync(absolute)) {
      resolvedFiles.push(absolute);
      continue;
    }
    const stat = await lstat(absolute);
    if (stat.isDirectory()) {
      resolvedFiles.push(...(await walkFiles(absolute)));
    } else {
      resolvedFiles.push(absolute);
    }
  }
  return unique(resolvedFiles);
}

async function walkFiles(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (blockedPathParts.some((part) => absolute.includes(`/${part}/`)))
      continue;
    if (entry.isDirectory()) result.push(...(await walkFiles(absolute)));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

function gitChangedFiles() {
  try {
    const tracked = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const untracked = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return unique(`${tracked}\n${untracked}`.split(/\r?\n/u).filter(Boolean));
  } catch {
    return [];
  }
}

function safeResolve(candidate) {
  const value = String(candidate);
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const relativePath = relative(root, absolute);
  const insideRoot = relativePath === "" || !relativePath.startsWith("..");
  const allowedExternal = absolute === deploymentPath;
  if (!insideRoot && !allowedExternal) {
    throw new Error(`Unsafe docflow path outside project: ${value}`);
  }
  const normalized = absolute.replaceAll("\\", "/");
  if (blockedPathParts.some((part) => normalized.includes(`/${part}/`))) {
    throw new Error(`Unsafe docflow path: ${value}`);
  }
  if (normalized.endsWith("/.env") || normalized.includes("/.env.")) {
    throw new Error(`Secret-like docflow path is not allowed: ${value}`);
  }
  return absolute;
}

async function snapshot(files) {
  const result = {};
  for (const file of files) {
    const key = displayPath(file);
    if (!existsSync(file)) {
      result[key] = { exists: false };
      continue;
    }
    const stat = await lstat(file);
    if (!stat.isFile()) {
      result[key] = {
        exists: true,
        kind: stat.isDirectory() ? "directory" : "other",
      };
      continue;
    }
    const content = await readFile(file);
    result[key] = {
      exists: true,
      kind: "file",
      bytes: content.byteLength,
      sha256: hashBuffer(content),
    };
  }
  return result;
}

function compareSnapshots(before, after) {
  const keys = unique([...Object.keys(before), ...Object.keys(after)]);
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({
      file: key,
      before: before[key] ?? null,
      after: after[key] ?? null,
    }));
}

async function runChecks(
  classification,
  reviews,
  files,
  manifest,
  options,
  context,
) {
  const checks = [];
  const markdownFiles = files.filter(
    (file) => extname(file).toLowerCase() === ".md",
  );
  const local = await checkMarkdown(markdownFiles);
  checks.push(local);
  if (classification.route === "quick") return checks;

  const shouldRunDocs = reviews.docs || classification.route === "full";
  const shouldRunAdr = reviews.adr || classification.route === "full";
  const shouldRunSpecs = reviews.spec || classification.route === "full";
  const cacheInput = hashText(
    JSON.stringify({ classification, reviews, manifest }),
  );

  if (shouldRunDocs)
    checks.push(
      await cachedCommand("docs", commands.docs, cacheInput, options),
    );
  if (shouldRunAdr)
    checks.push(await cachedCommand("adr", commands.adr, cacheInput, options));
  if (shouldRunSpecs) {
    const command =
      classification.route === "full" ? commands.specsFull : commands.specs;
    checks.push(await cachedCommand("specs", command, cacheInput, options));
  }
  if (options.ci || context.runCi) {
    checks.push(
      await cachedCommand("ci", commands.ci, cacheInput, {
        ...options,
        noCache: true,
      }),
    );
  } else if (classification.route === "full") {
    checks.push({
      name: "ci",
      status: "recommended-not-run",
      command: formatCommand(commands.ci),
    });
  }
  return checks;
}

async function checkMarkdown(files) {
  const failures = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const source = await readFile(file, "utf8");
    const prose = source.replace(/```[\s\S]*?```/gu, "");
    if (prose.includes("<<<<<<<") || prose.includes(">>>>>>>")) {
      failures.push(`${displayPath(file)}: merge marker found`);
    }
    for (const target of markdownTargets(source)) {
      if (/^(?:https?:|mailto:|#|skill:)/iu.test(target)) continue;
      const withoutAnchor = target.split("#", 1)[0];
      if (!withoutAnchor) continue;
      const decoded = decodeURIComponent(withoutAnchor);
      const candidate = decoded.startsWith("/")
        ? decoded
        : resolve(file, "..", decoded);
      if (!existsSync(candidate)) {
        failures.push(`${displayPath(file)}: missing link target ${target}`);
      }
    }
  }
  return {
    name: "targeted-markdown",
    status: failures.length === 0 ? "passed" : "failed",
    files: files.map(displayPath),
    failures,
  };
}

async function cachedCommand(name, command, inputHash, options) {
  const cachePath = resolve(stateRoot, "check-cache.json");
  const cache = await readJsonIfExists(cachePath, {});
  const key = `${name}:${inputHash}`;
  if (!options.noCache && cache[key]?.status === "passed") {
    return { ...cache[key], status: "cached" };
  }
  const started = Date.now();
  const result = await runCommand(command[0], command[1]);
  const record = {
    name,
    status: result.status === 0 ? "passed" : "failed",
    command: formatCommand(command),
    durationMs: Date.now() - started,
    output: result.output,
  };
  if (record.status === "passed") {
    cache[key] = record;
    await mkdir(stateRoot, { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  }
  return record;
}

function formatCommand([command, args]) {
  return [command, ...args].join(" ");
}

function runCommand(command, args) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, NX_DAEMON: "false", NX_CLOUD: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > 6000) output = output.slice(-6000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolveResult({ status: 127, output: error.message });
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveResult({
        status: timedOut || signal ? 124 : (code ?? 1),
        output: output.trim(),
      });
    });
  });
}

export function validateFinalization(context, classification, reviews, data) {
  const errors = [];
  if (data.files.length === 0) errors.push("missing file manifest/baseline");
  if (data.changed.length === 0 && !context.noChangeReason) {
    errors.push("no observed file changes and noChangeReason");
  }
  if (
    [
      "blocked",
      "pending-governance",
      "spec-drift",
      "conflict",
      "failed",
    ].includes(context.status)
  ) {
    errors.push(`task status blocks finalization: ${context.status}`);
  }
  if (!new Set(["complete", "completed", "done"]).has(String(context.status))) {
    errors.push("context.status must be complete, completed, or done");
  }
  validateDecision(errors, "docs", context.docs, reviews.docs);
  validateDecision(errors, "spec", context.spec, reviews.spec);
  validateDecision(errors, "adr", context.adr, true);
  if (classification.route !== "quick" && !hasEvidence(context.evidence)) {
    errors.push("missing explicit evidence for normal/full route");
  }
  for (const check of data.checks) {
    if (["failed", "error"].includes(check.status)) {
      errors.push(`${check.name} check failed`);
    }
  }
  return errors;
}

function validateDecision(errors, name, value, required) {
  if (!required && !value) return;
  const decision = decisionValue(value);
  const allowed = {
    docs: new Set(["updated", "unchanged", "not-required"]),
    spec: new Set(["updated", "unchanged", "not-required"]),
    adr: new Set(["created", "updated", "superseded", "not-required"]),
  }[name];
  if (!decision.status || !allowed.has(decision.status)) {
    errors.push(`missing or invalid ${name} decision`);
    return;
  }
  if (
    ["unchanged", "not-required"].includes(decision.status) &&
    !decision.reason
  ) {
    errors.push(`${name} decision ${decision.status} requires a reason`);
  }
}

function decisionValue(value) {
  if (!value) return { status: null, reason: null, links: [] };
  if (typeof value === "string")
    return { status: value, reason: null, links: [] };
  return {
    status: value.status ?? value.decision ?? null,
    reason: value.reason ?? null,
    links: value.links ?? [],
  };
}

function hasEvidence(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function failureResult(command, blockers) {
  return {
    schemaVersion: 1,
    command,
    ok: false,
    status: "pending-governance",
    blockers,
  };
}

async function writeRunState(runId, state) {
  await mkdir(resolve(stateRoot, "runs"), { recursive: true });
  const path = resolve(stateRoot, "runs", `${safeId(runId)}.json`);
  await writeFile(path, `${JSON.stringify({ ...state, path }, null, 2)}\n`);
  return path;
}

async function writeFinalState(runId, result) {
  await mkdir(resolve(stateRoot, "runs"), { recursive: true });
  const path = resolve(stateRoot, "runs", `${safeId(runId)}.final.json`);
  await writeFile(path, `${JSON.stringify({ ...result, path }, null, 2)}\n`);
}

async function readRunState(runId) {
  const path = resolve(stateRoot, "runs", `${safeId(runId)}.json`);
  const state = await readJsonIfExists(path, null);
  if (!state)
    throw new Error(`No docflow preflight state found for runId ${runId}`);
  return state;
}

async function readJsonIfExists(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function displayPath(file) {
  if (file === deploymentPath) return file;
  const value = relative(root, file);
  return value || ".";
}

function markdownTargets(source) {
  return [...source.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)].map(
    (match) => match[1],
  );
}

function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function hashBuffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeRunId() {
  return `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomBytes(4).toString("hex")}`;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/gu, "-");
}

function unique(values) {
  return [...new Set(values)];
}

function emit(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `docflow ${result.command ?? "result"}: ${result.ok ? "ok" : "blocked"}`,
  );
  if (result.classification) {
    console.log(
      `route=${result.classification.route} confidence=${result.classification.confidence}`,
    );
  }
  if (result.runId) console.log(`runId=${result.runId}`);
  if (result.blockers?.length) {
    for (const blocker of result.blockers) console.log(`- ${blocker}`);
  }
}

function printHelp() {
  console.log(`docflow — project documentation governance

Usage:
  pnpm run docflow -- classify --context <file> [--json]
  pnpm run docflow -- audit --context <file> [--json]
  pnpm run docflow -- preflight --context <file> [--json]
  pnpm run docflow -- finalize --context <file> --run-id <id> [--json] [--ci]

The context is optional JSON and may include source, taskId, changeId, intent,
files, surfaces, status, evidence, docs, spec, adr, and runCi. The runner does
not create or call a task database.`);
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  main()
    .then((result) => {
      if (result && result.ok === false) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(`docflow failed: ${error.message}`);
      process.exitCode = 2;
    });
}
