import { expect, test } from "@playwright/test";

test("HUAU foundation shell renders and API is reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "HUAU Sports" })).toBeVisible();
  await expect(page.getByText("Foundation / Phase 0")).toBeVisible();
  await expect(page.getByTestId("api-health")).toContainText(/online|checking/i);
});
