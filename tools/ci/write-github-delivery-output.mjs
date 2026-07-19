const source = await readStandardInput();
const impact = parseImpact(source);

write("delivery_class", impact.deliveryClass);
write("requires_preview", String(impact.requiresPreview));
write("runtime_services", JSON.stringify(impact.runtimeServices));
write("images", JSON.stringify(impact.images));
write("build_matrix", JSON.stringify(impact.builds));
write("requires_image_build", String(impact.images.length > 0));

function parseImpact(value) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Delivery impact input must be JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Delivery impact input must be an object");
  }
  const impact = /** @type {Record<string, unknown>} */ (parsed);
  if (
    typeof impact.deliveryClass !== "string" ||
    typeof impact.requiresPreview !== "boolean" ||
    !Array.isArray(impact.runtimeServices) ||
    !Array.isArray(impact.images) ||
    !Array.isArray(impact.builds)
  ) {
    throw new Error("Delivery impact input has an unexpected shape");
  }
  return impact;
}

function write(key, value) {
  if (!/^[a-z_]+$/u.test(key) || /[\r\n]/u.test(value)) {
    throw new Error("GitHub output contains an unsafe value");
  }
  process.stdout.write(`${key}=${value}\n`);
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
