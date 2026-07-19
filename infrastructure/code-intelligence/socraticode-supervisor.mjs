import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = "/srv/projects/brai-new";
const dist = "/srv/opt/socraticode/node_modules/socraticode/dist";
const stateFile = "/srv/opt/graphify/state/brai-new/socraticode-status.json";
const intervalMs = 60_000;

const load = (file) => import(pathToFileURL(resolve(dist, file)).href);
const [config, docker, embeddings, indexer, artifacts, graph, watcher, qdrant, ollama] =
  await Promise.all([
    load("config.js"),
    load("services/docker.js"),
    load("services/embedding-provider.js"),
    load("services/indexer.js"),
    load("services/context-artifacts.js"),
    load("services/code-graph.js"),
    load("services/watcher.js"),
    load("services/qdrant.js"),
    load("services/ollama.js"),
  ]);

let running = false;
let currentStatus = { phase: "starting" };

function report(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
  writeStatus({ ...currentStatus, lastProgressAt: new Date().toISOString() });
}

function writeStatus(status) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify({ checkedAt: new Date().toISOString(), ...status }, null, 2)}\n`);
}

async function reconcile() {
  if (running) return true;
  running = true;
  try {
    const projectId = JSON.parse(readFileSync(resolve(root, ".socraticode.json"), "utf8")).projectId;
    if (!projectId || config.projectIdFromPath(root) !== projectId) {
      throw new Error("SocratiCode project id does not match the committed configuration.");
    }

    await docker.ensureQdrantReady(report);
    await ollama.ensureOllamaReady();
    await embeddings.getEmbeddingProvider();
    const collection = config.collectionName(projectId);
    const info = await qdrant.getCollectionInfo(collection);
    const status = await indexer.getPersistedIndexingStatus(root);
    currentStatus = { projectId, collection, phase: "indexing" };
    writeStatus({ ...currentStatus, lastProgressAt: new Date().toISOString() });
    if (!info?.pointsCount || status !== "completed") {
      report("SocratiCode: resuming persistent index");
      const result = await indexer.indexProject(root, report);
      if (result.cancelled) throw new Error("SocratiCode indexing was cancelled.");
    } else {
      await indexer.updateProjectIndex(root, report);
    }

    const indexed = await artifacts.ensureArtifactsIndexed(root);
    if (indexed.errors.length) throw new Error(indexed.errors.map((item) => item.error).join("; "));
    await graph.rebuildGraph(root);
    // SocratiCode's native watcher retriggers its own in-flight incremental
    // updates on this checkout. The serialized one-minute reconciler below is
    // the single source of refresh work and preserves its checkpoint semantics.
    await watcher.stopWatching(root);
    currentStatus = {
      ok: true,
      projectId,
      collection,
      phase: "ready",
      watcher: "interval-reconciler",
    };
    writeStatus({ ...currentStatus, lastProgressAt: new Date().toISOString() });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    currentStatus = { ok: false, phase: "degraded", error: message };
    writeStatus({ ...currentStatus, lastProgressAt: new Date().toISOString() });
    console.error(`[${new Date().toISOString()}] ${message}`);
    return false;
  } finally {
    running = false;
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}

if (!(await reconcile())) process.exit(1);
setInterval(() => {
  void reconcile().then((ok) => {
    if (!ok) process.exit(1);
  });
}, intervalMs);
