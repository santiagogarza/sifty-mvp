import { z } from "zod";
import {
  ConnectorApiError,
  type ConnectorToolContext,
  type ProviderToolManifest,
  defineTool,
  providerFetch,
} from "../manifest";

const API = "https://slack.com/api";

/** Slack answers 200 with `ok: false` on application errors. */
async function slackCall<T extends { ok: boolean; error?: string }>(
  ctx: ConnectorToolContext,
  method: string,
  init: { query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<T> {
  const url = init.query
    ? `${API}/${method}?${new URLSearchParams(init.query)}`
    : `${API}/${method}`;
  const res = await providerFetch(ctx, url, {
    method: init.body ? "POST" : "GET",
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json()) as T;
  if (!data.ok) throw new ConnectorApiError("slack", 200, data.error ?? "unknown_error");
  return data;
}

const listChannels = defineTool({
  name: "slack_list_channels",
  description: "List channels the user is a member of (public and private) with ids and names.",
  kind: "read",
  inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
  async execute(input, ctx) {
    const data = await slackCall<{
      ok: boolean;
      channels?: Array<{ id: string; name: string; is_private?: boolean; num_members?: number }>;
    }>(ctx, "users.conversations", {
      query: {
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: String(input.limit),
      },
    });
    return {
      channels: (data.channels ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        isPrivate: !!c.is_private,
        members: c.num_members ?? null,
      })),
    };
  },
});

const searchMessages = defineTool({
  name: "slack_search_messages",
  description:
    "Search messages the user can see (Slack search syntax, e.g. 'invoice from:@ana in:#finance') and return text, channel, author, and a permalink.",
  kind: "read",
  inputSchema: z.object({
    query: z.string().min(1).max(500),
    count: z.number().int().min(1).max(50).default(20),
  }),
  async execute(input, ctx) {
    const data = await slackCall<{
      ok: boolean;
      messages?: {
        matches?: Array<{
          text: string;
          ts: string;
          permalink?: string;
          username?: string;
          channel?: { id: string; name: string };
        }>;
      };
    }>(ctx, "search.messages", {
      query: { query: input.query, count: String(input.count), sort: "timestamp" },
    });
    return {
      messages: (data.messages?.matches ?? []).map((m) => ({
        text: m.text,
        ts: m.ts,
        author: m.username ?? null,
        channel: m.channel?.name ?? m.channel?.id ?? null,
        permalink: m.permalink ?? null,
      })),
    };
  },
});

const postMessage = defineTool({
  name: "slack_post_message",
  description:
    "Post a message as the user to a channel id or DM id. Pass threadTs to reply in a thread.",
  kind: "write",
  inputSchema: z.object({
    channel: z.string().min(1),
    text: z.string().min(1).max(40_000),
    threadTs: z.string().optional(),
  }),
  async execute(input, ctx) {
    const data = await slackCall<{ ok: boolean; ts?: string; channel?: string }>(
      ctx,
      "chat.postMessage",
      {
        body: {
          channel: input.channel,
          text: input.text,
          ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        },
      },
    );
    return { ts: data.ts ?? null, channel: data.channel ?? input.channel };
  },
});

export const slackManifest: ProviderToolManifest = {
  provider: "slack",
  tools: [listChannels, searchMessages, postMessage],
  mcp: null,
};
