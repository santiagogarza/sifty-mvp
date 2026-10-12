import { z } from "zod";
import { type ProviderToolManifest, defineTool, providerFetch } from "../manifest";

const API = "https://api.notion.com/v1";
const HEADERS = { "Notion-Version": "2022-06-28" };
const MAX_TEXT_CHARS = 20_000;

interface RichText {
  plain_text: string;
}
interface SearchResult {
  id: string;
  object: "page" | "database";
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, { type: string; title?: RichText[] }>;
  title?: RichText[];
}
interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

function titleOf(r: SearchResult): string {
  if (r.title?.length) return r.title.map((t) => t.plain_text).join("");
  for (const prop of Object.values(r.properties ?? {})) {
    if (prop.type === "title" && prop.title) return prop.title.map((t) => t.plain_text).join("");
  }
  return "(untitled)";
}

function blockText(block: Block): string {
  const payload = block[block.type] as { rich_text?: RichText[] } | undefined;
  const text = (payload?.rich_text ?? []).map((t) => t.plain_text).join("");
  if (!text) return "";
  if (block.type.startsWith("heading")) return `# ${text}`;
  if (block.type === "bulleted_list_item") return `- ${text}`;
  if (block.type === "numbered_list_item") return `1. ${text}`;
  if (block.type === "to_do") return `[ ] ${text}`;
  return text;
}

const search = defineTool({
  name: "notion_search",
  description:
    "Search pages and databases shared with Sifty by title or content; returns id, title, and URL.",
  kind: "read",
  inputSchema: z.object({
    query: z.string().max(300).default(""),
    pageSize: z.number().int().min(1).max(50).default(15),
  }),
  async execute(input, ctx) {
    const res = await providerFetch(ctx, `${API}/search`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        query: input.query,
        page_size: input.pageSize,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      }),
    });
    const data = (await res.json()) as { results: SearchResult[] };
    return {
      results: data.results.map((r) => ({
        id: r.id,
        kind: r.object,
        title: titleOf(r),
        lastEdited: r.last_edited_time ?? null,
        url: r.url ?? null,
      })),
    };
  },
});

const getPage = defineTool({
  name: "notion_get_page",
  description: "Read a page's content as plain text (top-level blocks) by page id.",
  kind: "read",
  inputSchema: z.object({ pageId: z.string().min(1) }),
  async execute(input, ctx) {
    const res = await providerFetch(
      ctx,
      `${API}/blocks/${encodeURIComponent(input.pageId)}/children?page_size=100`,
      { headers: HEADERS },
    );
    const data = (await res.json()) as { results: Block[]; has_more?: boolean };
    const text = data.results.map(blockText).filter(Boolean).join("\n");
    return {
      pageId: input.pageId,
      text: text.slice(0, MAX_TEXT_CHARS),
      truncated: text.length > MAX_TEXT_CHARS || !!data.has_more,
    };
  },
});

const createPage = defineTool({
  name: "notion_create_page",
  description:
    "Create a page under a parent page the user shared with Sifty. Content is plain paragraphs, one per line.",
  kind: "write",
  inputSchema: z.object({
    parentPageId: z.string().min(1),
    title: z.string().min(1).max(300),
    content: z.string().max(50_000).default(""),
  }),
  async execute(input, ctx) {
    const children = input.content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(0, 100)
      .map((line) => ({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: line.slice(0, 2000) } }] },
      }));
    const res = await providerFetch(ctx, `${API}/pages`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        parent: { page_id: input.parentPageId },
        properties: { title: { title: [{ type: "text", text: { content: input.title } }] } },
        children,
      }),
    });
    const page = (await res.json()) as SearchResult;
    return { id: page.id, title: input.title, url: page.url ?? null };
  },
});

export const notionManifest: ProviderToolManifest = {
  provider: "notion",
  tools: [search, getPage, createPage],
  mcp: { url: "https://mcp.notion.com/mcp" },
};
