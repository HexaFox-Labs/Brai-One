export const ACTIVITY_TITLE_MAX_LENGTH = 250;
export const ACTIVITY_DESCRIPTION_MAX_LENGTH = 10_000;
export const ACTIVITY_PAGE_SIZE = 50;

export type Activity = {
  id: string;
  title: string;
  description: string;
  created_at: string;
};

export type ActivityDraft = {
  title: string;
  description: string;
};

export type ActivityValidationErrors = Partial<
  Record<keyof ActivityDraft, string>
>;

export function normalizeActivityDraft(draft: ActivityDraft): ActivityDraft {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
  };
}

export function validateActivityDraft(
  draft: ActivityDraft,
): ActivityValidationErrors {
  const normalized = normalizeActivityDraft(draft);
  const errors: ActivityValidationErrors = {};

  if (normalized.title.length === 0) {
    errors.title = "Введите заголовок.";
  } else if (normalized.title.length > ACTIVITY_TITLE_MAX_LENGTH) {
    errors.title = `Заголовок должен быть не длиннее ${ACTIVITY_TITLE_MAX_LENGTH} символов.`;
  }

  if (normalized.description.length > ACTIVITY_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Описание должно быть не длиннее ${ACTIVITY_DESCRIPTION_MAX_LENGTH.toLocaleString("ru-RU")} символов.`;
  }

  return errors;
}

export function hasValidationErrors(errors: ActivityValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function mergeActivities(
  current: readonly Activity[],
  incoming: readonly Activity[],
): Activity[] {
  const byId = new Map<string, Activity>();

  for (const activity of current) {
    byId.set(activity.id, activity);
  }

  for (const activity of incoming) {
    byId.set(activity.id, activity);
  }

  return [...byId.values()].sort((left, right) => {
    const leftTimestamp = preciseUtcTimestamp(left.created_at);
    const rightTimestamp = preciseUtcTimestamp(right.created_at);
    const createdAtDifference = rightTimestamp.localeCompare(leftTimestamp);

    return createdAtDifference === 0
      ? right.id.localeCompare(left.id)
      : createdAtDifference;
  });
}

function preciseUtcTimestamp(value: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/u.exec(value);

  if (!match?.[1]) {
    return value;
  }

  const fraction = (match[2] ?? "").padEnd(9, "0").slice(0, 9);
  return `${match[1]}.${fraction}Z`;
}

export function isLongDescription(description: string): boolean {
  return description.length > 320 || description.split("\n").length > 4;
}

const activityDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatActivityDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Время не указано";
  }

  return activityDateFormatter.format(date);
}
