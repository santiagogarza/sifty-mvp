export type TaskStatus = "inbox" | "today" | "done";
export type AiStatus = "processing" | "done" | "error";
export type Priority = "low" | "medium" | "high";

export interface Task {
  id: string;
  sourceText: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  aiStatus: AiStatus;
  urgency: Priority | null;
  importance: Priority | null;
  effort: "S" | "M" | "L" | null;
  nextAction: string | null;
  labels: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  sourceText: string;
}
