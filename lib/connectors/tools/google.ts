import { z } from "zod";
import { type ProviderToolManifest, defineTool, providerFetch } from "../manifest";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MAX_BODY_CHARS = 20_000;

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}

function header(msg: GmailMessage, name: string): string | null {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function plainText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const text = plainText(child);
    if (text) return text;
  }
  return "";
}

function summarize(msg: GmailMessage) {
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: header(msg, "From"),
    to: header(msg, "To"),
    subject: header(msg, "Subject"),
    date: header(msg, "Date"),
    snippet: msg.snippet ?? "",
  };
}

const searchMessages = defineTool({
  name: "google_gmail_search_messages",
  description:
    "Search the user's Gmail with a Gmail query (e.g. 'from:ana subject:invoice newer_than:30d') and return recent matching messages with sender, subject, date, and snippet.",
  kind: "read",
  inputSchema: z.object({
    query: z.string().min(1).max(500),
    maxResults: z.number().int().min(1).max(20).default(10),
  }),
  async execute(input, ctx) {
    const params = new URLSearchParams({ q: input.query, maxResults: String(input.maxResults) });
    const list = (await (await providerFetch(ctx, `${GMAIL}/messages?${params}`)).json()) as {
      messages?: Array<{ id: string }>;
    };
    const ids = (list.messages ?? []).map((m) => m.id);
    const meta = new URLSearchParams({ format: "metadata" });
    for (const h of ["From", "To", "Subject", "Date"]) meta.append("metadataHeaders", h);
    const messages = await Promise.all(
      ids.map(async (id) => {
        const res = await providerFetch(ctx, `${GMAIL}/messages/${id}?${meta}`);
        return summarize((await res.json()) as GmailMessage);
      }),
    );
    return { messages };
  },
});

const getMessage = defineTool({
  name: "google_gmail_get_message",
  description: "Read one Gmail message in full (headers and plain-text body) by its id.",
  kind: "read",
  inputSchema: z.object({ id: z.string().min(1) }),
  async execute(input, ctx) {
    const res = await providerFetch(
      ctx,
      `${GMAIL}/messages/${encodeURIComponent(input.id)}?format=full`,
    );
    const msg = (await res.json()) as GmailMessage;
    const body = plainText(msg.payload);
    return {
      ...summarize(msg),
      body: body.slice(0, MAX_BODY_CHARS),
      truncated: body.length > MAX_BODY_CHARS,
    };
  },
});

const createDraft = defineTool({
  name: "google_gmail_create_draft",
  description:
    "Create a Gmail draft (never sends). Pass threadId to draft a reply inside an existing thread.",
  kind: "write",
  inputSchema: z.object({
    to: z.string().min(3),
    subject: z.string().max(300),
    body: z.string().max(50_000),
    threadId: z.string().optional(),
    inReplyTo: z.string().optional(),
  }),
  async execute(input, ctx) {
    const lines = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      ...(input.inReplyTo
        ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`]
        : []),
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
    ];
    const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
    const res = await providerFetch(ctx, `${GMAIL}/drafts`, {
      method: "POST",
      body: JSON.stringify({
        message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
      }),
    });
    const draft = (await res.json()) as { id: string; message?: { id: string; threadId: string } };
    return {
      draftId: draft.id,
      messageId: draft.message?.id ?? null,
      threadId: draft.message?.threadId ?? null,
    };
  },
});

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; responseStatus?: string }>;
}

function eventView(e: CalendarEvent) {
  return {
    id: e.id,
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    location: e.location ?? null,
    attendees: (e.attendees ?? []).map((a) => a.email),
    link: e.htmlLink ?? null,
  };
}

const listEvents = defineTool({
  name: "google_calendar_list_events",
  description:
    "List events on the user's primary calendar between two ISO timestamps (default: the next 7 days), soonest first.",
  kind: "read",
  inputSchema: z.object({
    timeMin: z.string().datetime({ offset: true }).optional(),
    timeMax: z.string().datetime({ offset: true }).optional(),
    maxResults: z.number().int().min(1).max(50).default(20),
  }),
  async execute(input, ctx) {
    const now = new Date();
    const timeMin = input.timeMin ?? now.toISOString();
    const timeMax = input.timeMax ?? new Date(now.getTime() + 7 * 86_400_000).toISOString();
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(input.maxResults),
    });
    const res = await providerFetch(ctx, `${CALENDAR}?${params}`);
    const data = (await res.json()) as { items?: CalendarEvent[] };
    return { events: (data.items ?? []).map(eventView) };
  },
});

const createEvent = defineTool({
  name: "google_calendar_create_event",
  description:
    "Create an event on the user's primary calendar. Times are ISO 8601 with offset; attendees are email addresses.",
  kind: "write",
  inputSchema: z.object({
    summary: z.string().min(1).max(300),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    description: z.string().max(5_000).optional(),
    location: z.string().max(300).optional(),
    attendees: z.array(z.string().email()).max(50).default([]),
  }),
  async execute(input, ctx) {
    const res = await providerFetch(ctx, CALENDAR, {
      method: "POST",
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        location: input.location,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        attendees: input.attendees.map((email) => ({ email })),
      }),
    });
    return eventView((await res.json()) as CalendarEvent);
  },
});

export const googleManifest: ProviderToolManifest = {
  provider: "google",
  tools: [searchMessages, getMessage, listEvents, createDraft, createEvent],
  mcp: null,
};
