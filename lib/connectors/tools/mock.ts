import { z } from "zod";
import { type ProviderToolManifest, defineTool } from "../manifest";

/**
 * Tools for the mock provider. The "service" is an in-process notes list
 * per user, seeded with two entries, so an agent loop in CI or offline mode
 * has something to read and somewhere to write. The token must be the one
 * the mock broker minted for the user — a stand-in for the provider
 * rejecting a token issued to someone else.
 */

export const MOCK_TOKEN_PREFIX = "mock-token-";

interface Note {
  id: string;
  text: string;
  createdAt: string;
}

const store = new Map<string, Note[]>();

function notesFor(userId: string): Note[] {
  let notes = store.get(userId);
  if (!notes) {
    notes = [
      {
        id: "note_1",
        text: "Ask Ana about the invoice before Friday.",
        createdAt: "2026-10-10T09:00:00.000Z",
      },
      {
        id: "note_2",
        text: "The flaky test is in checkout.spec.ts.",
        createdAt: "2026-10-11T15:30:00.000Z",
      },
    ];
    store.set(userId, notes);
  }
  return notes;
}

function assertToken(token: string): void {
  if (!token.startsWith(MOCK_TOKEN_PREFIX))
    throw new Error("mock: token was not issued by the mock broker");
}

const listNotes = defineTool({
  name: "mock_list_notes",
  description: "List the user's mock notes, oldest first.",
  kind: "read",
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  async execute(input, ctx) {
    assertToken(ctx.token);
    return { notes: notesFor(ctx.userId).slice(0, input.limit) };
  },
});

const addNote = defineTool({
  name: "mock_add_note",
  description: "Add a mock note for the user.",
  kind: "write",
  inputSchema: z.object({ text: z.string().min(1).max(2_000) }),
  async execute(input, ctx) {
    assertToken(ctx.token);
    const notes = notesFor(ctx.userId);
    const note: Note = {
      id: `note_${notes.length + 1}`,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    return note;
  },
});

export const mockManifest: ProviderToolManifest = {
  provider: "mock",
  tools: [listNotes, addNote],
  mcp: null,
};

export function __resetMockNotes(): void {
  store.clear();
}
