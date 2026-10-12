// @vitest-environment jsdom
import { ConnectionsPanel } from "@/components/settings/connections-panel";
import type { ConnectionView } from "@/lib/connectors/service";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function view(overrides: Partial<ConnectionView>): ConnectionView {
  return {
    provider: "google",
    name: "Google",
    tagline: "Gmail and Calendar",
    description: "Read mail and your calendar, draft replies, and add events.",
    scopes: [
      { id: "gmail.readonly", label: "Read your email", kind: "read" },
      { id: "gmail.compose", label: "Create email drafts in Gmail", kind: "write" },
    ],
    tools: [
      { name: "google_gmail_search_messages", kind: "read" },
      { name: "google_gmail_create_draft", kind: "write" },
    ],
    mcp: false,
    availability: "available",
    status: "disconnected",
    externalAccount: null,
    lastCheckedAt: null,
    lastError: null,
    connectedAt: null,
    configHint: null,
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function respondWith(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ConnectionsPanel", () => {
  it("shows scopes in plain words, the not-configured state, and a connect button per provider", async () => {
    fetchMock.mockResolvedValueOnce(
      respondWith({
        allowed: true,
        proRequiredMessage: null,
        providers: [
          view({}),
          view({
            provider: "slack",
            name: "Slack",
            tagline: "Channels and messages",
            availability: "not_configured",
            configHint: "CONNECTOR_SLACK",
          }),
          view({
            provider: "mock",
            name: "Mock notes",
            tagline: "Test connector",
            status: "connected",
            externalAccount: "mock@sifty.local",
            lastCheckedAt: new Date().toISOString(),
          }),
        ],
      }),
    );
    render(<ConnectionsPanel notice={null} />);

    expect((await screen.findAllByText("Read your email")).length).toBe(3);
    expect(screen.getAllByText("Create email drafts in Gmail").length).toBeGreaterThan(0);
    expect(screen.getByTestId("connect-google")).toBeEnabled();
    expect(screen.getByTestId("connect-google")).toHaveTextContent("Connect Google");

    const slack = screen.getByTestId("connection-slack");
    expect(slack).toHaveAttribute("data-status", "disconnected");
    expect(slack).toHaveTextContent("Not configured");
    expect(slack).toHaveTextContent("hasn't been set up on this Sifty");
    expect(slack).toHaveTextContent("CONNECTOR_SLACK");
    expect(screen.getByTestId("connect-slack")).toBeDisabled();

    const mock = screen.getByTestId("connection-mock");
    expect(mock).toHaveAttribute("data-status", "connected");
    expect(mock).toHaveTextContent("Connected as mock@sifty.local");
    expect(mock).toHaveTextContent("Disconnect");
    expect(mock).toHaveTextContent("Check");
  });

  it("starts a connection by navigating to the broker URL and shows errors in place", async () => {
    fetchMock
      .mockResolvedValueOnce(
        respondWith({ allowed: true, proRequiredMessage: null, providers: [view({})] }),
      )
      .mockResolvedValueOnce(respondWith({ url: "https://vercel.com/connect/authorize/abc" }));
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign },
      writable: true,
    });

    render(<ConnectionsPanel notice={null} />);
    await userEvent.click(await screen.findByTestId("connect-google"));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://vercel.com/connect/authorize/abc"),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/connectors/google/start",
      expect.objectContaining({ method: "POST" }),
    );

    cleanup();
    fetchMock
      .mockResolvedValueOnce(
        respondWith({ allowed: true, proRequiredMessage: null, providers: [view({})] }),
      )
      .mockResolvedValueOnce(
        respondWith({ error: "Google is not set up on this deployment yet." }, 503),
      );
    render(<ConnectionsPanel notice={null} />);
    await userEvent.click(await screen.findByTestId("connect-google"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Google is not set up");
  });

  it("explains the Pro gate and renders the callback notices", async () => {
    fetchMock.mockResolvedValueOnce(
      respondWith({
        allowed: false,
        proRequiredMessage: "Connections are part of Sifty Pro.",
        providers: [view({ availability: "pro_required" })],
      }),
    );
    render(
      <ConnectionsPanel
        notice={{ kind: "error", message: "Google wasn't connected: declined." }}
      />,
    );
    expect(await screen.findByTestId("connections-pro-required")).toHaveTextContent("Sifty Pro");
    expect(screen.getByTestId("connections-notice")).toHaveTextContent("Google wasn't connected");
    expect(screen.getByTestId("connect-google")).toBeDisabled();

    cleanup();
    fetchMock.mockResolvedValueOnce(
      respondWith({
        allowed: true,
        proRequiredMessage: null,
        providers: [view({ status: "connected" })],
      }),
    );
    render(<ConnectionsPanel notice={{ kind: "connected", provider: "google" }} />);
    expect(await screen.findByTestId("connections-notice")).toHaveTextContent("Connected Google");
  });
});
