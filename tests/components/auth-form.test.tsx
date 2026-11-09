// @vitest-environment jsdom
import { AuthForm } from "@/components/auth/auth-form";
import { ForgotPasswordForm, ResetPasswordForm } from "@/components/auth/password-forms";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../helpers/intl";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

type AuthResult = { error: { code?: string; message?: string } | null };
const signInEmail = vi.fn(async (_input: unknown): Promise<AuthResult> => ({ error: null }));
const magicLink = vi.fn(async (_input: unknown): Promise<AuthResult> => ({ error: null }));
const requestPasswordReset = vi.fn(
  async (_input: unknown): Promise<AuthResult> => ({
    error: null,
  }),
);
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signIn: { email: (i: unknown) => signInEmail(i), magicLink: (i: unknown) => magicLink(i) },
    requestPasswordReset: (i: unknown) => requestPasswordReset(i),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthForm", () => {
  it("renders the sign-in form in English", () => {
    renderWithIntl(<AuthForm mode="sign-in" googleEnabled />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("renders the sign-up form in Spanish", () => {
    renderWithIntl(<AuthForm mode="sign-up" googleEnabled={false} />, { locale: "es" });
    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre visible (opcional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "placeholder",
      "Al menos 8 caracteres",
    );
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
  });

  it("maps Better Auth error codes to localized copy", async () => {
    signInEmail.mockResolvedValueOnce({
      error: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    });
    const user = userEvent.setup();
    renderWithIntl(<AuthForm mode="sign-in" googleEnabled={false} />, { locale: "es" });
    await user.type(screen.getByLabelText("Correo electrónico"), "a@b.co");
    await user.type(screen.getByLabelText("Contraseña"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByTestId("auth-error")).toHaveTextContent(
      "El correo o la contraseña son incorrectos.",
    );
  });

  it("localizes the rate-limit 429 and hides unmapped English messages", async () => {
    signInEmail
      .mockResolvedValueOnce({ error: { code: "rate_limited", message: "Too many attempts." } })
      .mockResolvedValueOnce({ error: { code: "SOMETHING_NEW", message: "Raw server text" } });
    const user = userEvent.setup();
    renderWithIntl(<AuthForm mode="sign-in" googleEnabled={false} />, { locale: "es" });
    await user.type(screen.getByLabelText("Correo electrónico"), "a@b.co");
    await user.type(screen.getByLabelText("Contraseña"), "pw");
    const submit = screen.getByRole("button", { name: "Iniciar sesión" });
    await user.click(submit);
    expect(await screen.findByTestId("auth-error")).toHaveTextContent(
      "Demasiados intentos. Intenta de nuevo en un minuto.",
    );
    await user.click(submit);
    expect(await screen.findByText("Algo salió mal. Intenta de nuevo.")).toBeInTheDocument();
  });

  it("shows the magic-link confirmation with the address in Spanish", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AuthForm mode="sign-in" googleEnabled={false} />, { locale: "es" });
    await user.click(
      screen.getByRole("button", { name: "Mejor envíame un enlace de inicio de sesión" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Primero escribe tu correo.");
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@ejemplo.com");
    await user.click(
      screen.getByRole("button", { name: "Mejor envíame un enlace de inicio de sesión" }),
    );
    expect(await screen.findByText("Revisa tu correo")).toBeInTheDocument();
    expect(
      screen.getByText(/Enviamos un enlace de un solo uso a ana@ejemplo.com/),
    ).toBeInTheDocument();
  });
});

describe("password forms", () => {
  it("confirms a reset request in Spanish", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ForgotPasswordForm />, { locale: "es" });
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@ejemplo.com");
    await user.click(screen.getByRole("button", { name: "Enviar enlace para restablecer" }));
    expect(await screen.findByTestId("reset-sent")).toHaveTextContent(
      "Si existe una cuenta para ana@ejemplo.com",
    );
  });

  it("labels the new-password form in Spanish", () => {
    renderWithIntl(<ResetPasswordForm token="t" />, { locale: "es" });
    expect(screen.getByLabelText("Nueva contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar nueva contraseña" })).toBeInTheDocument();
  });
});
