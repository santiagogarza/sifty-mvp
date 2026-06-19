import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CreateTaskInput, Task } from "./types";

const DATA_DIR = join(process.cwd(), ".data");
const DATA_FILE = join(DATA_DIR, "tasks.json");

function readAll(): Task[] {
  if (!existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf8")) as Task[];
  } catch {
    return [];
  }
}

function writeAll(tasks: Task[]): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), "utf8");
}

export function listTasks(): Task[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTask(id: string): Task | undefined {
  return readAll().find((t) => t.id === id);
}

// Core invariant from the plan: task creation only requires source_text.
export function createTask(input: CreateTaskInput): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    sourceText: input.sourceText,
    title: input.sourceText.trim().slice(0, 80) || "Untitled task",
    description: null,
    status: "inbox",
    aiStatus: "processing",
    urgency: null,
    importance: null,
    effort: null,
    nextAction: null,
    labels: [],
    confidence: null,
    createdAt: now,
    updatedAt: now,
  };
  const tasks = readAll();
  tasks.push(task);
  writeAll(tasks);
  return task;
}

export function updateTask(id: string, patch: Partial<Task>): Task | undefined {
  const tasks = readAll();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  const updated: Task = {
    ...tasks[idx],
    ...patch,
    id: tasks[idx].id,
    updatedAt: new Date().toISOString(),
  };
  tasks[idx] = updated;
  writeAll(tasks);
  return updated;
}

export function deleteTask(id: string): boolean {
  const tasks = readAll();
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) return false;
  writeAll(next);
  return true;
}
