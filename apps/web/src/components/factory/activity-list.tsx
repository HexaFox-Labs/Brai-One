import { RefreshCw } from "lucide-react";

import { ActivityCard } from "@/components/factory/activity-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Activity } from "@/lib/activity";
import type { ActivityApiError } from "@/lib/api";

type ActivityListProps = {
  activities: Activity[];
  initialError: ActivityApiError | null;
  syncError: ActivityApiError | null;
  hasMore: boolean;
  isInitialLoading: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
};

function ActivityListSkeleton() {
  return (
    <div aria-label="Загрузка активностей" className="space-y-6">
      {[0, 1, 2].map((item) => (
        <div className="space-y-3" key={item}>
          <div className="flex justify-between gap-8">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function ActivityList({
  activities,
  initialError,
  syncError,
  hasMore,
  isInitialLoading,
  isLoadingMore,
  onLoadMore,
  onRetry,
}: ActivityListProps) {
  return (
    <section aria-labelledby="activities-heading" className="mt-10 sm:mt-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2
            id="activities-heading"
            className="text-xl font-semibold tracking-[-0.025em] text-foreground"
          >
            Активности
          </h2>
          {!isInitialLoading && !initialError ? (
            <p className="mt-1 text-sm text-muted-strong">
              Новые записи появляются здесь автоматически.
            </p>
          ) : null}
        </div>
        {activities.length > 0 ? (
          <span className="font-mono text-xs text-muted">
            Показано: {activities.length}
          </span>
        ) : null}
      </div>

      {syncError && activities.length > 0 ? (
        <div
          className="mb-5 flex flex-col gap-3 rounded-[10px] border border-warning/35 bg-warning-surface px-3.5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <div>
            <p className="font-medium text-warning-foreground">
              Не удалось обновить список.
            </p>
            <p className="mt-0.5 font-mono text-xs text-warning-muted">
              Номер запроса: {syncError.requestId}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Повторить
          </Button>
        </div>
      ) : null}

      <div className="rounded-[14px] border border-border bg-surface px-4 py-5 shadow-panel sm:px-6 sm:py-6">
        {isInitialLoading ? <ActivityListSkeleton /> : null}

        {!isInitialLoading && initialError ? (
          <div className="py-8 text-center" role="alert">
            <p className="font-medium text-foreground">
              Не удалось загрузить активности.
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-strong">
              {initialError.message}
            </p>
            <p className="mt-2 break-all font-mono text-xs text-muted">
              Номер запроса: {initialError.requestId}
            </p>
            <Button variant="secondary" className="mt-5" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Повторить
            </Button>
          </div>
        ) : null}

        {!isInitialLoading && !initialError && activities.length === 0 ? (
          <div className="py-10 text-center">
            <p className="font-medium text-foreground">Активностей пока нет</p>
            <p className="mt-2 text-sm leading-6 text-muted-strong">
              Первая добавленная активность появится здесь.
            </p>
          </div>
        ) : null}

        {!isInitialLoading && activities.length > 0 ? (
          <div className="divide-y divide-border">
            {activities.map((activity) => (
              <ActivityCard activity={activity} key={activity.id} />
            ))}
          </div>
        ) : null}
      </div>

      {hasMore && !initialError ? (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            disabled={isLoadingMore}
            aria-busy={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? "Загружаем..." : "Показать ещё"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
