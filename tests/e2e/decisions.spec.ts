import { type APIRequestContext, expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

/**
 * Decisions inbox, end to end on the real Workflow runtime with offline
 * stages: a terse capture makes the heuristic unsure, the sift finishes
 * and opens a clarifying question, the inbox shows it, and answering it
 * resumes the suspended run, which folds the answer into the same sift.
 */

// Every e2e worker shares one bypass user and its two sift slots, so a
// sift can queue behind the other suites' captures; give it room.
test.describe.configure({ timeout: 120_000 });

interface TaskShape {
  id: string;
  aiStatus: string;
  aiAttempts: number;
  clarifyingQuestion: string | null;
  sourceContext: string | null;
  siftId: string | null;
  siftedWithAssumptions: boolean;
}

/** Fewer than three words keeps the heuristic's confidence under the asking threshold. */
async function captureUnsureTask(request: APIRequestContext, word: string): Promise<TaskShape> {
  const created = await request.post("/api/tasks?offline=1", {
    data: { sourceText: `${word} ${Date.now().toString(36)}` },
  });
  expect(created.status()).toBe(201);
  const { task } = (await created.json()) as { task: TaskShape };
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/tasks/${task.id}`);
        return res.ok() ? ((await res.json()).task as TaskShape).aiStatus : "fetch-failed";
      },
      { timeout: 90_000, intervals: [300, 500, 1000] },
    )
    .toBe("ready");
  const res = await request.get(`/api/tasks/${task.id}`);
  return (await res.json()).task as TaskShape;
}

async function openDecisionFor(request: APIRequestContext, taskId: string) {
  const res = await request.get("/api/decisions");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    decisions: Array<{ id: string; taskId: string | null; payload: { question: string } }>;
  };
  return body.decisions.find((d) => d.taskId === taskId) ?? null;
}

test("a terse capture asks a question; answering it in the inbox resumes the sift", async ({
  page,
  request,
}) => {
  const task = await captureUnsureTask(request, "Taxes");
  expect(task.clarifyingQuestion).toBe("What outcome would mark this as done?");
  const decision = await openDecisionFor(request, task.id);
  expect(decision?.payload.question).toBe("What outcome would mark this as done?");

  await gotoApp(page, "/decisions");
  const card = page.locator(`[data-decision-id="${decision!.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText("What outcome would mark this as done?");
  await expect(card).toContainText("Taxes");
  // The sidebar badge counts it.
  const badge = page.getByTestId("nav-decisions").getByTestId("decisions-count");
  await expect(badge).toBeVisible();
  expect(Number(await badge.textContent())).toBeGreaterThanOrEqual(1);

  await card.getByRole("button", { name: /^Something sent/ }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText(/Answered — Sifty is re-sifting/)).toBeVisible();

  // The suspended run woke up: same sift, second pass, answer folded in.
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/tasks/${task.id}`);
        if (!res.ok()) return -1;
        const t = (await res.json()).task as TaskShape;
        return t.aiStatus === "ready" ? t.aiAttempts : 0;
      },
      { timeout: 90_000 },
    )
    .toBe(2);
  const after = (await (await request.get(`/api/tasks/${task.id}`)).json()).task as TaskShape;
  expect(after.siftId).toBe(task.siftId);
  expect(after.sourceContext).toContain("Answer: Something sent");
  expect(after.clarifyingQuestion).toBeNull();
  expect(await openDecisionFor(request, task.id)).toBeNull();
});

test("letting Sifty decide marks the task as sifted with assumptions", async ({
  page,
  request,
}) => {
  const task = await captureUnsureTask(request, "Budget");
  const decision = await openDecisionFor(request, task.id);
  expect(decision).not.toBeNull();

  await gotoApp(page, "/decisions");
  const card = page.locator(`[data-decision-id="${decision!.id}"]`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Let Sifty decide" }).click();
  await expect(card).toHaveCount(0);

  const after = (await (await request.get(`/api/tasks/${task.id}`)).json()).task as TaskShape;
  expect(after.siftedWithAssumptions).toBe(true);
  expect(after.clarifyingQuestion).toBeNull();
  expect(after.aiAttempts).toBe(1);

  // The task sheet says so, honestly, with a way back.
  await gotoApp(page, `/inbox?task=${task.id}`);
  await expect(page.getByTestId("sifted-with-assumptions")).toContainText(
    "Sifted on Sifty's own assumptions",
  );
});

test("the inbox is keyboard-driven: j moves, a digit answers", async ({ page, request }) => {
  const first = await captureUnsureTask(request, "Invoices");
  const second = await captureUnsureTask(request, "Passport");
  const firstDecision = await openDecisionFor(request, first.id);
  const secondDecision = await openDecisionFor(request, second.id);
  expect(firstDecision && secondDecision).toBeTruthy();

  await gotoApp(page, "/decisions");
  const list = page.getByRole("listbox", { name: "Decisions" });
  await expect(list).toBeVisible();
  // Newest first: the second capture is the top card.
  const cards = page.getByTestId("decision-card");
  const topId = await cards.first().getAttribute("data-decision-id");
  const nextId = await cards.nth(1).getAttribute("data-decision-id");
  expect([topId, nextId]).toContain(secondDecision!.id);

  await list.focus();
  await page.keyboard.press("j");
  await expect(cards.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("1");
  await expect(page.locator(`[data-decision-id="${nextId}"]`)).toHaveCount(0);

  const answeredTaskId =
    nextId === secondDecision!.id ? second.id : nextId === firstDecision!.id ? first.id : null;
  expect(answeredTaskId).not.toBeNull();
  await expect
    .poll(async () => {
      const res = await request.get(`/api/tasks/${answeredTaskId}`);
      return res.ok() ? ((await res.json()).task as TaskShape).sourceContext : null;
    })
    .toContain("Answer: A decision");
});
