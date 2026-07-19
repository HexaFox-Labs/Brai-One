import { expect, test } from "@playwright/test";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("creates an activity through the same-origin API", async ({ page }) => {
  const activity = {
    id: "ac015227-6e76-4c33-9168-09c8ce788008",
    title: "Проверить Factory",
    description: "Убедиться, что запись появилась в списке.",
    created_at: "2026-07-16T12:00:00.000Z",
  };
  let idempotencyKey = "";
  let requestId = "";

  await page.route("**/api/v1/activities?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "brai.http.activity.list.response.v1",
        request_id: "6dd06734-b81a-4607-8875-5bd37a51a9d7",
        activities: [],
        next_cursor: null,
      }),
    });
  });
  await page.route("**/api/v1/activities", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    idempotencyKey =
      (await route.request().headerValue("idempotency-key")) ?? "";
    requestId = (await route.request().headerValue("x-request-id")) ?? "";
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "brai.http.activity.create.response.v1",
        request_id: "7f8fac93-e25e-4ead-a8a8-bff8c4d14e69",
        activity,
        idempotent_replay: false,
      }),
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Brai Factory" }),
  ).toBeVisible();
  await expect(page.getByText("Активностей пока нет")).toBeVisible();

  await page.getByLabel("Заголовок").fill(activity.title);
  await page.getByLabel(/Описание/).fill(activity.description);
  await page.getByRole("button", { name: "Добавить" }).click();

  await expect(
    page.getByRole("heading", { name: activity.title }),
  ).toBeVisible();
  await expect(page.getByText(activity.description)).toBeVisible();
  expect(idempotencyKey).toMatch(UUID_V4);
  expect(requestId).toMatch(UUID_V4);
});

test("loads another page without rendering duplicates", async ({ page }) => {
  const first = {
    id: "605c2145-1f28-4f4c-a898-a4ecb1dddb47",
    title: "Первая активность",
    description: "",
    created_at: "2026-07-16T12:00:00.000Z",
  };
  const older = {
    id: "2d72e30f-72f0-46cb-8307-041b810a116f",
    title: "Старая активность",
    description: "",
    created_at: "2026-07-16T11:00:00.000Z",
  };

  await page.route("**/api/v1/activities?**", async (route) => {
    const url = new URL(route.request().url());
    const isNextPage = url.searchParams.has("cursor");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        isNextPage
          ? {
              schema_version: "brai.http.activity.list.response.v1",
              request_id: "2a63f25a-ad68-4b98-afd0-22469e08cb40",
              activities: [first, older],
              next_cursor: null,
            }
          : {
              schema_version: "brai.http.activity.list.response.v1",
              request_id: "56beaa1c-a9d3-41f4-b480-fb11637fc74f",
              activities: [first],
              next_cursor: "older-page",
            },
      ),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Показать ещё" }).click();

  await expect(
    page.getByRole("heading", { name: "Старая активность" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Первая активность" }),
  ).toHaveCount(1);
});

test("polls the first page after ten seconds without duplicates", async ({
  page,
}) => {
  await page.clock.install({
    time: new Date("2026-07-16T12:00:00.000Z"),
  });
  const activity = {
    id: "0fd881e7-a0e2-4973-8ec1-627de825676b",
    title: "Фоновое обновление",
    description: "",
    created_at: "2026-07-16T12:00:01.000Z",
  };
  let requestCount = 0;

  await page.route("**/api/v1/activities?**", async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "brai.http.activity.list.response.v1",
        request_id:
          requestCount === 1
            ? "d343ef5d-a7ea-489d-8bcf-377ac06a4f9f"
            : "b53734be-0980-449f-adfd-e855480f42fc",
        activities: requestCount === 1 ? [] : [activity],
        next_cursor: null,
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByText("Активностей пока нет")).toBeVisible();

  await page.clock.fastForward(10_000);

  await expect(page.getByRole("heading", { name: activity.title })).toHaveCount(
    1,
  );
  expect(requestCount).toBeGreaterThanOrEqual(2);
});

test("creates an activity using only the keyboard", async ({ page }) => {
  const activity = {
    id: "cf716d6f-a92f-4165-bd58-e21769ca9437",
    title: "Клавиатурный сценарий",
    description: "Без мыши",
    created_at: "2026-07-16T12:00:00.000Z",
  };

  await page.route("**/api/v1/activities?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "brai.http.activity.list.response.v1",
        request_id: "e9be0bca-4357-4f17-a3cf-f2dcb07c4988",
        activities: [],
        next_cursor: null,
      }),
    });
  });
  await page.route("**/api/v1/activities", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "brai.http.activity.create.response.v1",
        request_id: "5b2ab802-af2e-478e-9730-47eef0f49184",
        activity,
        idempotent_replay: false,
      }),
    });
  });

  await page.goto("/");
  await page.locator("body").press("Tab");
  await expect(page.getByLabel("Заголовок")).toBeFocused();
  await page.keyboard.type(activity.title);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel(/Описание/)).toBeFocused();
  await page.keyboard.type(activity.description);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Добавить" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: activity.title }),
  ).toBeVisible();
});
