import { describe, expect, it } from "vitest";

import {
  mergeActivities,
  normalizeActivityDraft,
  validateActivityDraft,
  type Activity,
} from "@/lib/activity";

describe("activity helpers", () => {
  it("normalizes outer whitespace without changing inner text", () => {
    expect(
      normalizeActivityDraft({
        title: "  Подготовить релиз  ",
        description: "  Первая строка\nВторая строка  ",
      }),
    ).toEqual({
      title: "Подготовить релиз",
      description: "Первая строка\nВторая строка",
    });
  });

  it("rejects an empty normalized title", () => {
    expect(validateActivityDraft({ title: "   ", description: "" })).toEqual({
      title: "Введите заголовок.",
    });
  });

  it("deduplicates activities and keeps newest records first", () => {
    const older: Activity = {
      id: "older",
      title: "Старая",
      description: "",
      created_at: "2026-07-16T10:00:00.000Z",
    };
    const newer: Activity = {
      id: "newer",
      title: "Новая",
      description: "",
      created_at: "2026-07-16T11:00:00.000Z",
    };

    expect(mergeActivities([older], [newer, older])).toEqual([newer, older]);
  });

  it("preserves microsecond ordering inside one millisecond", () => {
    const earlier: Activity = {
      id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
      title: "Раньше",
      description: "",
      created_at: "2026-07-16T11:00:00.000001Z",
    };
    const later: Activity = {
      id: "00000000-0000-4000-8000-000000000000",
      title: "Позже",
      description: "",
      created_at: "2026-07-16T11:00:00.000002Z",
    };

    expect(mergeActivities([earlier], [later])).toEqual([later, earlier]);
  });

  it("normalizes different fractional-second precision before sorting", () => {
    const exactMillisecond: Activity = {
      id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
      title: "Ровно миллисекунда",
      description: "",
      created_at: "2026-07-16T11:00:00.001Z",
    };
    const oneMicrosecondLater: Activity = {
      id: "00000000-0000-4000-8000-000000000000",
      title: "На микросекунду позже",
      description: "",
      created_at: "2026-07-16T11:00:00.001001Z",
    };

    expect(mergeActivities([exactMillisecond], [oneMicrosecondLater])).toEqual([
      oneMicrosecondLater,
      exactMillisecond,
    ]);
  });
});
