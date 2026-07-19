import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityCard } from "@/components/factory/activity-card";

describe("ActivityCard", () => {
  it("expands and collapses a long plain-text description", () => {
    const description = "Подробное описание ".repeat(30);

    render(
      <ActivityCard
        activity={{
          id: "2348ae8d-56cf-413b-aeed-005393d51572",
          title: "Разобрать требования",
          description,
          created_at: "2026-07-16T12:00:00.000Z",
        }}
      />,
    );

    const text = screen.getByText(/Подробное описание Подробное описание/);
    expect(text).toHaveClass("line-clamp-4");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Показать описание активности полностью",
      }),
    );
    expect(text).not.toHaveClass("line-clamp-4");
    expect(
      screen.getByRole("button", {
        name: "Свернуть описание активности",
      }),
    ).toBeInTheDocument();
  });
});
