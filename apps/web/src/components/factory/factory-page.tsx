"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActivityForm } from "@/components/factory/activity-form";
import { ActivityList } from "@/components/factory/activity-list";
import { mergeActivities, type Activity } from "@/lib/activity";
import { ActivityApiError, listActivities } from "@/lib/api";
import { createUuid } from "@/lib/idempotency";

const POLLING_INTERVAL_MS = 10_000;

function unknownListError(): ActivityApiError {
  return new ActivityApiError({
    status: 0,
    code: "unknown_error",
    requestId: createUuid(),
    message: "Произошла неизвестная ошибка. Повторите попытку.",
  });
}

export function FactoryPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [initialError, setInitialError] = useState<ActivityApiError | null>(
    null,
  );
  const [syncError, setSyncError] = useState<ActivityApiError | null>(null);
  const loadedPageCountRef = useRef(0);
  const firstPagePendingRef = useRef(false);
  const firstPageControllerRef = useRef<AbortController | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  const refreshFirstPage = useCallback(async (background = false) => {
    if (firstPagePendingRef.current) {
      return;
    }

    firstPagePendingRef.current = true;
    const controller = new AbortController();
    firstPageControllerRef.current = controller;

    try {
      const result = await listActivities({ signal: controller.signal });

      setActivities((current) => mergeActivities(current, result.activities));

      if (loadedPageCountRef.current <= 1) {
        setNextCursor(result.nextCursor);
      }

      if (loadedPageCountRef.current === 0) {
        loadedPageCountRef.current = 1;
      }

      setInitialError(null);
      setSyncError(null);
      setIsInitialLoading(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const apiError =
        error instanceof ActivityApiError ? error : unknownListError();

      if (background && loadedPageCountRef.current > 0) {
        setSyncError(apiError);
      } else {
        setInitialError(apiError);
        setIsInitialLoading(false);
      }
    } finally {
      firstPagePendingRef.current = false;
      if (firstPageControllerRef.current === controller) {
        firstPageControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void refreshFirstPage(false);
    }, 0);
    const interval = window.setInterval(() => {
      void refreshFirstPage(true);
    }, POLLING_INTERVAL_MS);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      firstPageControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
    };
  }, [refreshFirstPage]);

  async function handleLoadMore() {
    if (!nextCursor || isLoadingMore) {
      return;
    }

    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setIsLoadingMore(true);
    setSyncError(null);

    try {
      const result = await listActivities({
        cursor: nextCursor,
        signal: controller.signal,
      });

      setActivities((current) => mergeActivities(current, result.activities));
      setNextCursor(result.nextCursor);
      loadedPageCountRef.current += 1;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setSyncError(
          error instanceof ActivityApiError ? error : unknownListError(),
        );
      }
    } finally {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null;
      }
      setIsLoadingMore(false);
    }
  }

  function handleCreated(activity: Activity) {
    setActivities((current) => mergeActivities(current, [activity]));
    setInitialError(null);
    setSyncError(null);
  }

  function handleRetry() {
    setIsInitialLoading(true);
    setInitialError(null);
    void refreshFirstPage(false);
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/80">
        <div className="mx-auto flex min-h-16 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
          <Image
            src="/brand/brai-wordmark.svg"
            alt="Brai"
            width="94"
            height="40"
            preload
            className="h-8 w-auto"
          />
          <span aria-hidden="true" className="h-5 w-px bg-border-strong" />
          <span className="text-sm font-medium text-muted-strong">Factory</span>
        </div>
      </header>

      <main
        data-brai-preview-verification="p01-final-validation"
        className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12"
      >
        <div className="mb-7 sm:mb-9">
          <h1 className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
            Brai Factory
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-muted-strong">
            Общий список активностей. Добавляйте новые записи и следите за
            обновлениями в одном месте.
          </p>
        </div>

        <ActivityForm onCreated={handleCreated} />

        <ActivityList
          activities={activities}
          initialError={initialError}
          syncError={syncError}
          hasMore={nextCursor !== null}
          isInitialLoading={isInitialLoading}
          isLoadingMore={isLoadingMore}
          onLoadMore={() => void handleLoadMore()}
          onRetry={handleRetry}
        />
      </main>
    </div>
  );
}
