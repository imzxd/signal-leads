import { expect, test } from "@playwright/test";

/**
 * The sales-demo scenario, end to end in a real browser:
 * public form → lead appears → Signal qualifies → customer replies → times offered →
 * customer picks one → appointment booked → owner marks the job won.
 */
test("public lead to booked appointment to won", async ({ page }) => {
  const name = `Jordan Test ${Date.now().toString(36)}`;

  // 1. A prospect submits the hosted form.
  await page.goto("/forms/evergreen-roofing");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("textbox", { name: "Email" }).fill(`${Date.now()}@example.com`);
  await page.getByLabel("How can we help?").fill("Our roof started leaking over the garage in Guelph. We'd like it fixed this week.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();

  // 2. The owner signs in and finds the lead.
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /enter demo workspace/i }).click();
  await page.waitForURL("**/overview");
  await page.goto(`/leads?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name: new RegExp(name) }).click();

  // 3. Signal has already run intake, scored and asked the next question.
  await expect(page.getByText(/Intake Agent identified/)).toBeVisible();
  await expect(page.getByText(/· First response/)).toBeVisible();
  await expect(page.getByText("Follow-ups scheduled", { exact: false })).toBeVisible();

  // 4. Customer replies (simulated through the real inbound pipeline).
  await page.getByRole("tab", { name: "Simulate customer" }).click();
  await page.getByRole("textbox", { name: "Simulated customer reply" }).fill("It's 77 Oak St, a detached house");
  await page.getByRole("button", { name: "Send as customer" }).click();
  await expect(page.getByText(/· Booking offer/)).toBeVisible();
  await expect(page.getByText(/Cancelled 3 pending follow-ups/)).toBeVisible();

  // 5. Customer picks a time.
  await page.getByRole("textbox", { name: "Simulated customer reply" }).fill("2");
  await page.getByRole("button", { name: "Send as customer" }).click();
  await expect(page.getByText(/Appointment created/)).toBeVisible();

  // 6. Conversion.
  await page.getByRole("button", { name: "Mark won" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark won" }).click();
  await expect(page.getByText(/Marked won/)).toBeVisible();
});

test("human takeover stops Signal and returning control resumes it", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /enter demo workspace/i }).click();
  await page.waitForURL("**/overview");
  await page.goto("/leads?q=Jasmine");
  await page.getByRole("link", { name: /Jasmine Cole/ }).click();
  // Start from autopilot even if a previous run left the lead in human mode.
  await expect(page.getByRole("button", { name: /Take over|Return to Signal/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Return to Signal" }).isVisible()) {
    await page.getByRole("button", { name: "Return to Signal" }).click();
    await expect(page.getByRole("button", { name: "Take over" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Take over" }).click();
  await expect(page.getByRole("button", { name: "Return to Signal" })).toBeVisible();
  await expect(page.getByText(/took over — AI messaging stopped/).last()).toBeVisible();
  await page.getByRole("button", { name: "Return to Signal" }).click();
  await expect(page.getByRole("button", { name: "Take over" })).toBeVisible();
});
