import { expect, test } from "@playwright/test";

test("HUAU Phase 1 public shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("HUAU", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Todo tu deporte|Your sport/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Crear cuenta|Create account/i })).toBeVisible();
});

test("health endpoint is reachable", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { ok: boolean; version: string };
  expect(body.ok).toBe(true);
  expect(body.version).toContain("phase1");
});
