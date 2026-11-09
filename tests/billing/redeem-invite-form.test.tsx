// @vitest-environment jsdom
import { RedeemInviteForm } from "@/components/billing/redeem-invite-form";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../helpers/intl";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RedeemInviteForm", () => {
  it("maps the server's error code to a Spanish message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "That invite code has expired.", code: "expired" }, { status: 410 }),
      ),
    );
    renderWithIntl(<RedeemInviteForm initialCode="sifty-abc" />, { locale: "es" });
    fireEvent.click(screen.getByRole("button", { name: "Canjear" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ese código de invitación ya venció.",
    );
  });

  it("names the comp end date in Spanish", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ok: true, tier: "comped", compedUntil: "2027-02-14T00:00:00.000Z" }),
      ),
    );
    renderWithIntl(<RedeemInviteForm initialCode="sifty-abc" autoSubmit />, { locale: "es" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Tienes Pro hasta el 14 de febrero de 2027.",
    );
  });

  it("asks for a code before submitting, in English", () => {
    renderWithIntl(<RedeemInviteForm />);
    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an invite code.");
  });
});
