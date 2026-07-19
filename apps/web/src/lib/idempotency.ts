import { normalizeActivityDraft, type ActivityDraft } from "@/lib/activity";

export type SubmissionAttempt = {
  fingerprint: string;
  idempotencyKey: string;
};

export function createUuid(): string {
  return globalThis.crypto.randomUUID();
}

export function createActivityFingerprint(draft: ActivityDraft): string {
  return JSON.stringify(normalizeActivityDraft(draft));
}

export function resolveSubmissionAttempt(
  draft: ActivityDraft,
  previous: SubmissionAttempt | null,
): SubmissionAttempt {
  const fingerprint = createActivityFingerprint(draft);

  if (previous?.fingerprint === fingerprint) {
    return previous;
  }

  return {
    fingerprint,
    idempotencyKey: createUuid(),
  };
}
