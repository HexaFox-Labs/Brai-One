"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Collapsible } from "radix-ui";

import { Button } from "@/components/ui/button";
import {
  formatActivityDate,
  isLongDescription,
  type Activity,
} from "@/lib/activity";
import { cn } from "@/lib/cn";

export function ActivityCard({ activity }: { activity: Activity }) {
  const [isOpen, setIsOpen] = useState(false);
  const [canCollapse, setCanCollapse] = useState(() =>
    isLongDescription(activity.description),
  );
  const descriptionRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const description = descriptionRef.current;

    if (!description || isOpen) {
      return;
    }

    const measure = () => {
      if (description.clientHeight === 0 && description.scrollHeight === 0) {
        return;
      }

      setCanCollapse(description.scrollHeight > description.clientHeight + 1);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(description);
    return () => observer.disconnect();
  }, [activity.description, isOpen]);

  return (
    <article
      data-testid={`activity-${activity.id}`}
      className="py-5 first:pt-0 last:pb-0"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <h3 className="min-w-0 break-words text-base font-semibold leading-6 text-foreground">
          {activity.title}
        </h3>
        <time
          className="shrink-0 font-mono text-xs leading-6 text-muted"
          dateTime={activity.created_at}
        >
          {formatActivityDate(activity.created_at)}
        </time>
      </div>

      {activity.description ? (
        <Collapsible.Root
          className="mt-2.5"
          open={isOpen}
          onOpenChange={setIsOpen}
        >
          <Collapsible.Content forceMount asChild>
            <p
              ref={descriptionRef}
              className={cn(
                "break-words whitespace-pre-wrap text-sm leading-6 text-muted-strong",
                !isOpen && "line-clamp-4",
              )}
            >
              {activity.description}
            </p>
          </Collapsible.Content>
          {canCollapse ? (
            <Collapsible.Trigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                aria-label={
                  isOpen
                    ? "Свернуть описание активности"
                    : "Показать описание активности полностью"
                }
              >
                {isOpen ? "Свернуть" : "Показать полностью"}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "transition-transform duration-150 motion-reduce:transition-none",
                    isOpen && "rotate-180",
                  )}
                />
              </Button>
            </Collapsible.Trigger>
          ) : null}
        </Collapsible.Root>
      ) : null}
    </article>
  );
}
