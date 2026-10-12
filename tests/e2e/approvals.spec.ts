import { type APIRequestContext, expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

/**
 * Approvals, end to end on the real Workflow runtime with offline stages:
 * capture → sift (plan) → "Run now" hands the task to the research
 * executor → the run parks on an approval → the Decisions inbox shows the
 * card → approving it resumes the suspended run → the execution is done
 * and the task sheet shows the result.
 */

test.describe.configure({ timeout: 120_000 });

interface TaskShape {
  id: string;
  aiStatus: string;
  plan: { executor: string } | null;
}

interface ExecutionShape {
  id: string;
  status: string;
  decisionId: string | null;
  result: { summary: string; draft: { title: string | null; body: string } | null } | null;
}

async function captureReadyTask(request: APIRequestContext, text: string): Promise<TaskShape> {
  const created = await request.post("/api/tasks?offline=1", {
    data: { sourceText: `${text} ${Date.now().toString(36)}` },
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

async function execution(request: APIRequestContext, id: string): Promise<ExecutionShape> {
  const res = await request.get(`/api/executions/${id}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).execution as ExecutionShape;
}

async function waitForStatus(request: APIRequestContext, id: string, status: string) {
  await expect
    .poll(async () => (await execution(request, id)).status, {
      timeout: 60_000,
      intervals: [300, 500, 1000],
    })
    .toBe(status);
  return execution(request, id);
}

test("ask_first: the run parks on an approval; approving in the inbox finishes it", async ({
  page,
  request,
}) => {
  const task = await captureReadyTask(
    request,
    "Research the lease renewal options for the office by Friday",
  );
  expect(task.plan).not.toBeNull();

  const started = await request.post(`/api/tasks/${task.id}/execute?offline=1`, {
    data: { policy: "ask_first" },
  });
  expect(started.status()).toBe(202);
  const { execution: queued } = (await started.json()) as { execution: ExecutionShape };
  const parked = await waitForStatus(request, queued.id, "needs_approval");
  expect(parked.decisionId).not.toBeNull();

  await gotoApp(page, "/decisions");
  const card = page.locator(`[data-decision-id="${parked.decisionId}"]`);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-decision-kind", "approval");
  await expect(card).toContainText("Sifty wants to");
  await expect(card).toContainText("write up notes");
  await expect(page.getByText(/waiting for your go-ahead/)).toBeVisible();

  await card.getByTestId("approval-approve").click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText(/Approved — Sifty is working on/)).toBeVisible();

  const done = await waitForStatus(request, queued.id, "done");
  expect(done.result?.draft?.title).toMatch(/^Research notes/);
  const open = (await (await request.get("/api/decisions")).json()) as {
    decisions: Array<{ id: string }>;
  };
  expect(open.decisions.find((d) => d.id === parked.decisionId)).toBeUndefined();

  // The task sheet tells the story and shows the result.
  await gotoApp(page, `/inbox?task=${task.id}`);
  const section = page.getByTestId("execution-section");
  await expect(section.getByTestId("execution-status")).toHaveText("Done");
  await expect(section.getByTestId("execution-result")).toContainText("Research notes");
  await expect(section.getByTestId("execution-run")).toHaveText(/Run again/);
});

test("draft_then_approve from the task sheet: the draft is reviewed, edited, and approved", async ({
  page,
  request,
}) => {
  const task = await captureReadyTask(request, "Compare the two vendor contracts for the audit");

  await gotoApp(page, `/inbox?task=${task.id}`);
  const section = page.getByTestId("execution-section");
  await expect(section.getByTestId("execution-policy")).toHaveValue("draft_then_approve");
  await section.getByTestId("execution-run").click();
  await expect(page.getByText(/Sifty is on it/)).toBeVisible();
  await expect(section.getByTestId("execution-status")).toHaveText("Draft ready", {
    timeout: 60_000,
  });
  const review = section.getByTestId("execution-review-link");
  await expect(review).toHaveText(/Review the draft/);
  const href = await review.getAttribute("href");
  expect(href).toMatch(/^\/decisions\?focus=/);

  await review.click();
  const decisionId = decodeURIComponent(href!.split("focus=")[1]!);
  const card = page.locator(`[data-decision-id="${decisionId}"]`);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-decision-kind", "draft_review");
  await expect(card.getByTestId("draft-body")).toContainText("Research notes");

  await card.getByTestId("draft-edit").click();
  const body = card.getByRole("textbox", { name: "Draft body" });
  await body.fill("# Vendor notes\n\n- Compare renewal terms\n- Ask legal about the SLA");
  await expect(card.getByTestId("draft-diff")).toContainText("Ask legal about the SLA");
  await card.getByTestId("draft-approve-edits").click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText(/Approved with your edits/)).toBeVisible();

  const list = (await (await request.get(`/api/tasks/${task.id}/executions`)).json()) as {
    executions: ExecutionShape[];
  };
  const done = await waitForStatus(request, list.executions[0]!.id, "done");
  expect(done.result?.draft?.body).toContain("Ask legal about the SLA");
});

test("rejecting an approval cancels the run; Stop from the sheet cancels a parked one", async ({
  page,
  request,
}) => {
  const task = await captureReadyTask(request, "Draft the investor update for the board");
  const started = await request.post(`/api/tasks/${task.id}/execute?offline=1`, {
    data: { policy: "ask_first" },
  });
  const { execution: queued } = (await started.json()) as { execution: ExecutionShape };
  const parked = await waitForStatus(request, queued.id, "needs_approval");

  await gotoApp(page, "/decisions");
  const card = page.locator(`[data-decision-id="${parked.decisionId}"]`);
  await card.getByTestId("approval-reject").click();
  await expect(card).toHaveCount(0);
  const cancelled = await waitForStatus(request, queued.id, "cancelled");
  expect(cancelled.status).toBe("cancelled");

  // Run again, this time stop it from the sheet while it waits.
  const second = await request.post(`/api/tasks/${task.id}/execute?offline=1`, {
    data: { policy: "ask_first" },
  });
  const { execution: again } = (await second.json()) as { execution: ExecutionShape };
  await waitForStatus(request, again.id, "needs_approval");
  await gotoApp(page, `/inbox?task=${task.id}`);
  const section = page.getByTestId("execution-section");
  await expect(section.getByTestId("execution-status")).toHaveText("Waiting for your go-ahead");
  await section.getByTestId("execution-cancel").click();
  await expect(section.getByTestId("execution-status")).toHaveText("Cancelled");
  await waitForStatus(request, again.id, "cancelled");
  const open = (await (await request.get("/api/decisions")).json()) as {
    decisions: Array<{ taskId: string | null }>;
  };
  expect(open.decisions.filter((d) => d.taskId === task.id)).toEqual([]);
});
