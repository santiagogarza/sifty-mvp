import { z } from "zod";
import {
  ConnectorApiError,
  type ConnectorToolContext,
  type ProviderToolManifest,
  defineTool,
  providerFetch,
} from "../manifest";

const GRAPHQL = "https://api.linear.app/graphql";

async function gql<T>(
  ctx: ConnectorToolContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await providerFetch(ctx, GRAPHQL, {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  const data = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (data.errors?.length) {
    throw new ConnectorApiError("linear", 200, data.errors.map((e) => e.message).join("; "));
  }
  if (!data.data) throw new ConnectorApiError("linear", 200, "empty response");
  return data.data;
}

interface IssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  state?: { name: string };
  assignee?: { name: string } | null;
  team?: { key: string };
}

function issueView(i: IssueNode) {
  return {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    state: i.state?.name ?? null,
    priority: i.priority,
    assignee: i.assignee?.name ?? null,
    team: i.team?.key ?? null,
    url: i.url,
  };
}

const listTeams = defineTool({
  name: "linear_list_teams",
  description:
    "List the Linear teams the user belongs to, with the team id needed to create issues.",
  kind: "read",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const data = await gql<{ teams: { nodes: Array<{ id: string; key: string; name: string }> } }>(
      ctx,
      "query { teams(first: 50) { nodes { id key name } } }",
      {},
    );
    return { teams: data.teams.nodes };
  },
});

const searchIssues = defineTool({
  name: "linear_search_issues",
  description:
    "Full-text search of Linear issues; returns identifier, title, state, assignee, and URL.",
  kind: "read",
  inputSchema: z.object({
    term: z.string().min(1).max(300),
    first: z.number().int().min(1).max(50).default(15),
  }),
  async execute(input, ctx) {
    const data = await gql<{ searchIssues: { nodes: IssueNode[] } }>(
      ctx,
      `query($term: String!, $first: Int!) {
        searchIssues(term: $term, first: $first) {
          nodes { id identifier title url priority state { name } assignee { name } team { key } }
        }
      }`,
      { term: input.term, first: input.first },
    );
    return { issues: data.searchIssues.nodes.map(issueView) };
  },
});

const createIssue = defineTool({
  name: "linear_create_issue",
  description:
    "Create a Linear issue in a team (use linear_list_teams for the team id). Markdown description.",
  kind: "write",
  inputSchema: z.object({
    teamId: z.string().min(1),
    title: z.string().min(1).max(300),
    description: z.string().max(50_000).optional(),
    priority: z.number().int().min(0).max(4).optional(),
  }),
  async execute(input, ctx) {
    const data = await gql<{ issueCreate: { success: boolean; issue: IssueNode | null } }>(
      ctx,
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url priority state { name } assignee { name } team { key } }
        }
      }`,
      { input },
    );
    if (!data.issueCreate.success || !data.issueCreate.issue) {
      throw new ConnectorApiError("linear", 200, "issueCreate did not succeed");
    }
    return issueView(data.issueCreate.issue);
  },
});

export const linearManifest: ProviderToolManifest = {
  provider: "linear",
  tools: [listTeams, searchIssues, createIssue],
  mcp: { url: "https://mcp.linear.app/mcp" },
};
