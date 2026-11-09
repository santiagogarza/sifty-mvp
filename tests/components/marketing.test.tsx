// @vitest-environment jsdom
import { LegalPage } from "@/components/marketing/legal-page";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { SiteFooter } from "@/components/marketing/site-footer";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithIntl } from "../helpers/intl";

afterEach(cleanup);

describe("pricing cards", () => {
  it("renders plan names, prices and the rolling-out badge in English", () => {
    renderWithIntl(<PricingCards />);
    expect(screen.getByRole("heading", { name: "Free" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pro" })).toBeTruthy();
    expect(screen.getByText("$10")).toBeTruthy();
    expect(screen.getByText("5 sifts a day")).toBeTruthy();
    expect(screen.getByText("or $96 a year (save 20%)")).toBeTruthy();
    expect(screen.getAllByText("rolling out").length).toBeGreaterThan(0);
  });

  it("renders in Spanish with glossary terms", () => {
    renderWithIntl(<PricingCards />, { locale: "es" });
    expect(screen.getByRole("heading", { name: "Gratis" })).toBeTruthy();
    expect(screen.getByText("5 clasificaciones al día")).toBeTruthy();
    expect(screen.getByText("o $96 al año (ahorra 20%)")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Empezar prueba de Pro de \d+ días/ })).toBeTruthy();
    expect(screen.getAllByText("en camino").length).toBeGreaterThan(0);
  });
});

describe("site footer", () => {
  it("translates links and the contact line", () => {
    renderWithIntl(<SiteFooter />, { locale: "es" });
    expect(screen.getByRole("link", { name: "Privacidad" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByText(/Una persona lee cada mensaje/)).toBeTruthy();
  });
});

describe("legal page frame", () => {
  it("shows the draft notice and no translation note in English", () => {
    renderWithIntl(
      <LegalPage title="Privacy policy" updated="2026-10-12">
        <p>Body</p>
      </LegalPage>,
    );
    expect(screen.getByText("October 12, 2026")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("Draft.");
    expect(screen.getByRole("note").textContent).not.toContain("prevails");
  });

  it("formats the date in Spanish and says the English version prevails", () => {
    renderWithIntl(
      <LegalPage title="Política de privacidad" updated="2026-10-12">
        <p>Cuerpo</p>
      </LegalPage>,
      { locale: "es" },
    );
    expect(screen.getByText("12 de octubre de 2026")).toBeTruthy();
    const note = screen.getByRole("note").textContent;
    expect(note).toContain("Borrador.");
    expect(note).toContain("prevalece la versión en inglés");
  });
});
