// @vitest-environment jsdom
import { Sidebar } from "@/components/app-shell/sidebar";
import { LanguagePicker } from "@/components/settings/language-picker";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../helpers/intl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
}));
const setLocale = vi.fn(async (_locale: string) => {});
vi.mock("@/lib/i18n/actions", () => ({
  setLocale: (locale: string) => setLocale(locale),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LanguagePicker", () => {
  it("marks the current locale and stores a new choice, then refreshes", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LanguagePicker />);
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Español" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(setLocale).toHaveBeenCalledWith("es");
  });

  it("does nothing when the current language is picked again", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LanguagePicker />, { locale: "es" });
    await user.click(screen.getByRole("button", { name: "Español" }));
    expect(setLocale).not.toHaveBeenCalled();
  });
});

describe("Sidebar", () => {
  it("renders the navigation in Spanish", () => {
    renderWithIntl(<Sidebar />, { locale: "es" });
    for (const label of ["Hoy", "Bandeja de entrada", "Enfoque", "Decisiones", "Configuración"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });
});
