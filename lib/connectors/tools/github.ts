import { z } from "zod";
import { type ProviderToolManifest, defineTool, providerFetch } from "../manifest";

const API = "https://api.github.com";
const HEADERS = { "X-GitHub-Api-Version": "2022-11-28" };
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface Repo {
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  pushed_at?: string;
  description?: string | null;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  repository_url?: string;
  pull_request?: unknown;
  user?: { login: string };
  updated_at?: string;
}

function issueView(i: Issue) {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    isPullRequest: !!i.pull_request,
    author: i.user?.login ?? null,
    repo: i.repository_url?.replace(`${API}/repos/`, "") ?? null,
    updatedAt: i.updated_at ?? null,
    url: i.html_url,
  };
}

const listRepos = defineTool({
  name: "github_list_repos",
  description:
    "List repositories the user can access, most recently pushed first, with full name, visibility, and default branch.",
  kind: "read",
  inputSchema: z.object({ perPage: z.number().int().min(1).max(100).default(30) }),
  async execute(input, ctx) {
    const params = new URLSearchParams({
      sort: "pushed",
      per_page: String(input.perPage),
      affiliation: "owner,collaborator,organization_member",
    });
    const res = await providerFetch(ctx, `${API}/user/repos?${params}`, { headers: HEADERS });
    const repos = (await res.json()) as Repo[];
    return {
      repos: repos.map((r) => ({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description ?? null,
        pushedAt: r.pushed_at ?? null,
        url: r.html_url,
      })),
    };
  },
});

const searchIssues = defineTool({
  name: "github_search_issues",
  description:
    "Search issues and pull requests with GitHub search syntax (e.g. 'repo:acme/app is:open flaky test').",
  kind: "read",
  inputSchema: z.object({
    query: z.string().min(1).max(500),
    perPage: z.number().int().min(1).max(50).default(20),
  }),
  async execute(input, ctx) {
    const params = new URLSearchParams({ q: input.query, per_page: String(input.perPage) });
    const res = await providerFetch(ctx, `${API}/search/issues?${params}`, { headers: HEADERS });
    const data = (await res.json()) as { total_count: number; items: Issue[] };
    return { total: data.total_count, items: data.items.map(issueView) };
  },
});

const createIssue = defineTool({
  name: "github_create_issue",
  description: "Open an issue in a repository ('owner/name'). Markdown body.",
  kind: "write",
  inputSchema: z.object({
    repo: z.string().regex(REPO, "owner/name"),
    title: z.string().min(1).max(256),
    body: z.string().max(60_000).optional(),
    labels: z.array(z.string()).max(20).default([]),
  }),
  async execute(input, ctx) {
    const res = await providerFetch(ctx, `${API}/repos/${input.repo}/issues`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
    });
    return issueView((await res.json()) as Issue);
  },
});

export const githubManifest: ProviderToolManifest = {
  provider: "github",
  tools: [listRepos, searchIssues, createIssue],
  mcp: { url: "https://api.githubcopilot.com/mcp/" },
};
