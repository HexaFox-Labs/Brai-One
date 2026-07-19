import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityForm } from "@/components/factory/activity-form";

const createdActivity = {
  id: "d664a7bc-2f0f-4dcf-a86e-c905d36ebfd1",
  title: "Подготовить релиз",
  description: "Проверить сборку",
  created_at: "2026-07-16T12:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ActivityForm", () => {
  beforeEach(() => {
    let uuidCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
      }),
    });
  });

  it("retains the form and reuses the idempotency key after an error", async () => {
    const onCreated = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            request_id: "00000000-0000-4000-8000-000000000099",
            code: "factory_unavailable",
            message: "Не удалось сохранить. Повторите попытку.",
          },
          503,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            schema_version: "brai.http.activity.create.response.v1",
            request_id: "cf217c9f-d65e-4f37-a6ff-5b84965dbe4f",
            activity: createdActivity,
            idempotent_replay: false,
          },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ActivityForm onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Заголовок"), {
      target: { value: "Подготовить релиз" },
    });
    fireEvent.change(screen.getByLabelText(/Описание/), {
      target: { value: "Проверить сборку" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));

    expect(
      await screen.findByText("Не удалось сохранить. Повторите попытку."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Заголовок")).toHaveValue("Подготовить релиз");

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as
      Record<string, string> | undefined;

    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(createdActivity);
    });

    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as
      Record<string, string> | undefined;
    expect(secondHeaders?.["Idempotency-Key"]).toBe(
      firstHeaders?.["Idempotency-Key"],
    );
    expect(screen.getByLabelText("Заголовок")).toHaveValue("");
    expect(screen.getByText("Активность добавлена.")).toBeInTheDocument();
  });

  it("shows client validation before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    render(<ActivityForm onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Заголовок"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));

    expect(await screen.findByText("Введите заголовок.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
