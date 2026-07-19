"use client";

import { Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTIVITY_DESCRIPTION_MAX_LENGTH,
  ACTIVITY_TITLE_MAX_LENGTH,
  hasValidationErrors,
  normalizeActivityDraft,
  validateActivityDraft,
  type Activity,
  type ActivityDraft,
  type ActivityValidationErrors,
} from "@/lib/activity";
import { ActivityApiError, createActivity } from "@/lib/api";
import {
  createUuid,
  resolveSubmissionAttempt,
  type SubmissionAttempt,
} from "@/lib/idempotency";

type ActivityFormProps = {
  onCreated: (activity: Activity) => void;
};

type SubmissionError = {
  message: string;
  requestId: string;
};

const EMPTY_DRAFT: ActivityDraft = {
  title: "",
  description: "",
};

export function ActivityForm({ onCreated }: ActivityFormProps) {
  const [draft, setDraft] = useState<ActivityDraft>(EMPTY_DRAFT);
  const [validationErrors, setValidationErrors] =
    useState<ActivityValidationErrors>({});
  const [submissionError, setSubmissionError] =
    useState<SubmissionError | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const attemptRef = useRef<SubmissionAttempt | null>(null);

  function updateDraft(field: keyof ActivityDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setValidationErrors((current) => ({ ...current, [field]: undefined }));
    setSubmissionError(null);
    setSuccessMessage("");
    attemptRef.current = null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const errors = validateActivityDraft(draft);
    setValidationErrors(errors);
    setSubmissionError(null);
    setSuccessMessage("");

    if (hasValidationErrors(errors)) {
      return;
    }

    const normalizedDraft = normalizeActivityDraft(draft);
    const attempt = resolveSubmissionAttempt(
      normalizedDraft,
      attemptRef.current,
    );
    attemptRef.current = attempt;
    setIsSubmitting(true);

    try {
      const result = await createActivity({
        draft: normalizedDraft,
        idempotencyKey: attempt.idempotencyKey,
      });

      onCreated(result.activity);
      setDraft(EMPTY_DRAFT);
      setValidationErrors({});
      setSuccessMessage("Активность добавлена.");
      attemptRef.current = null;
    } catch (error) {
      setSubmissionError(
        error instanceof ActivityApiError
          ? {
              message: error.message,
              requestId: error.requestId,
            }
          : {
              message: "Не удалось сохранить активность. Повторите попытку.",
              requestId: createUuid(),
            },
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="new-activity-heading"
      className="rounded-[14px] border border-border bg-surface p-4 shadow-panel sm:p-6"
    >
      <div className="mb-5">
        <h2
          id="new-activity-heading"
          className="text-lg font-semibold tracking-[-0.02em] text-foreground"
        >
          Новая активность
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-strong">
          Добавьте заголовок и, если нужно, подробное описание.
        </p>
      </div>

      <form className="space-y-5" noValidate onSubmit={handleSubmit}>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <Label htmlFor="activity-title">Заголовок</Label>
            <span className="font-mono text-xs text-muted">
              {draft.title.length}/{ACTIVITY_TITLE_MAX_LENGTH}
            </span>
          </div>
          <Input
            id="activity-title"
            name="title"
            autoComplete="off"
            placeholder="Что нужно сделать?"
            required
            maxLength={ACTIVITY_TITLE_MAX_LENGTH}
            value={draft.title}
            aria-invalid={Boolean(validationErrors.title)}
            aria-describedby={
              validationErrors.title ? "activity-title-error" : undefined
            }
            onChange={(event) => updateDraft("title", event.target.value)}
          />
          {validationErrors.title ? (
            <p
              id="activity-title-error"
              className="text-sm text-danger"
              role="alert"
            >
              {validationErrors.title}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <Label htmlFor="activity-description">
              Описание{" "}
              <span className="font-normal text-muted-strong">
                (необязательно)
              </span>
            </Label>
            <span className="font-mono text-xs text-muted">
              {draft.description.length}/
              {ACTIVITY_DESCRIPTION_MAX_LENGTH.toLocaleString("ru-RU")}
            </span>
          </div>
          <Textarea
            id="activity-description"
            name="description"
            placeholder="Контекст, детали или ожидаемый результат"
            maxLength={ACTIVITY_DESCRIPTION_MAX_LENGTH}
            value={draft.description}
            aria-invalid={Boolean(validationErrors.description)}
            aria-describedby={
              validationErrors.description
                ? "activity-description-error"
                : undefined
            }
            onChange={(event) => updateDraft("description", event.target.value)}
          />
          {validationErrors.description ? (
            <p
              id="activity-description-error"
              className="text-sm text-danger"
              role="alert"
            >
              {validationErrors.description}
            </p>
          ) : null}
        </div>

        {submissionError ? (
          <div
            className="rounded-[10px] border border-danger/35 bg-danger-surface px-3.5 py-3 text-sm"
            role="alert"
          >
            <p className="font-medium text-danger-foreground">
              {submissionError.message}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-danger-muted">
              Номер запроса: {submissionError.requestId}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            className="min-h-5 text-sm text-success"
            role="status"
            aria-live="polite"
          >
            {successMessage}
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="w-full sm:w-auto"
          >
            {!isSubmitting ? <Plus aria-hidden="true" /> : null}
            {isSubmitting ? "Сохраняем..." : "Добавить"}
          </Button>
        </div>
      </form>
    </section>
  );
}
