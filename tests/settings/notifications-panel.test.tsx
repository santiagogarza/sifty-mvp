// @vitest-environment jsdom
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { DEFAULT_PREFERENCES } from "@/lib/notifications/preferences";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../helpers/intl";

vi.mock("@/lib/notifications/push-client", () => ({
  PushPermissionDeniedError: class extends Error {},
  getCurrentSubscription: async () => null,
  isIOS: () => false,
  isStandalone: () => false,
  pushSupport: () => ({ ok: true }),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        preferences: { ...DEFAULT_PREFERENCES, saved: true, updatedAt: null },
        pushConfigured: false,
        pushSubscriptions: [],
        recentSends: [
          { kind: "morning_plan", channel: "email", periodKey: "2026-11-09", status: "sent" },
        ],
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(locale: "en" | "es") {
  return renderWithIntl(
    <NotificationsPanel email="u@example.com" vapidPublicKey={null} unsubscribed={null} />,
    { locale },
  );
}

describe("NotificationsPanel", () => {
  it("formats hours and weekdays in English", async () => {
    renderPanel("en");
    const morning = await screen.findByRole("combobox", { name: "Morning plan time" });
    expect(morning).toHaveDisplayValue("7:00 AM");
    expect(screen.getByRole("combobox", { name: "Weekly review day" })).toHaveDisplayValue(
      "Sunday",
    );
  });

  it("speaks Spanish, with 24-hour times and Spanish weekdays", async () => {
    renderPanel("es");
    const morning = await screen.findByRole("combobox", { name: "Hora del plan matutino" });
    expect(
      screen.getByRole("combobox", { name: "Hora del recordatorio de vencimiento" }),
    ).toHaveDisplayValue("15:00");
    expect(morning).toHaveDisplayValue("7:00");
    expect(screen.getByRole("combobox", { name: "Día de la revisión semanal" })).toHaveDisplayValue(
      "domingo",
    );
    expect(screen.getByText("Los cambios se guardan automáticamente.")).toBeInTheDocument();
    expect(screen.getByText(/Plan matutino/, { selector: "li span" })).toHaveTextContent(
      "Plan matutino · correo",
    );
  });
});
