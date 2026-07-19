const slotCount = 20;
const idleMilliseconds = 72 * 60 * 60 * 1000;

export function createRegistry() {
  return {
    schemaVersion: 1,
    sequence: 0,
    slots: Array.from({ length: slotCount }, (_, index) => ({
      number: index + 1,
      generation: 0,
      lease: null,
    })),
    queue: [],
  };
}

export function requestLease(registry, request, now, activeLimit) {
  const next = structuredClone(registry);
  expireIdleLeases(next, now);
  const existing = next.slots.find(
    (slot) => slot.lease?.branch === request.branch,
  );
  if (existing) {
    existing.lease.lastActivityAt = now;
    existing.lease.revision = request.revision;
    return {
      registry: next,
      result: {
        state: "leased",
        slot: existing.number,
        generation: existing.generation,
        created: false,
      },
    };
  }
  const queued = next.queue.find((entry) => entry.branch === request.branch);
  if (!queued)
    next.queue.push({
      ...request,
      sequence: ++next.sequence,
      requestedAt: now,
    });
  const eligible = [...next.queue].sort(compareQueue)[0];
  const active = next.slots.filter((slot) => slot.lease).length;
  const free = next.slots.find((slot) => slot.lease === null);
  if (
    !eligible ||
    !free ||
    active >= activeLimit ||
    eligible.branch !== request.branch
  ) {
    return { registry: next, result: { state: "queued" } };
  }
  free.generation += 1;
  free.lease = {
    branch: eligible.branch,
    priority: eligible.priority,
    lastActivityAt: now,
    revision: eligible.revision,
  };
  next.queue = next.queue.filter((entry) => entry.branch !== eligible.branch);
  return {
    registry: next,
    result: {
      state: "leased",
      slot: free.number,
      generation: free.generation,
      created: true,
    },
  };
}

export function releaseLease(registry, slotNumber, generation) {
  const next = structuredClone(registry);
  const slot = next.slots.find((entry) => entry.number === slotNumber);
  if (!slot || !slot.lease || slot.generation !== generation)
    return { registry: next, released: false };
  slot.lease = null;
  return { registry: next, released: true };
}

export function expireIdleLeases(registry, now) {
  for (const slot of registry.slots) {
    if (
      slot.lease &&
      Date.parse(slot.lease.lastActivityAt) + idleMilliseconds <=
        Date.parse(now)
    )
      slot.lease = null;
  }
}

function compareQueue(left, right) {
  const priority =
    (right.priority === "release") - (left.priority === "release");
  return priority || left.sequence - right.sequence;
}
