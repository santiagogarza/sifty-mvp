import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { type RenderOptions, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type * as React from "react";

/** The provider the root layout gives every page, for component tests. */
export function IntlProvider({
  locale = "en",
  children,
}: {
  locale?: Locale;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={getMessages(locale)} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

/** `render` wrapped in the i18n provider (English unless `locale` is set). */
export function renderWithIntl(
  ui: React.ReactElement,
  { locale = "en", ...options }: Omit<RenderOptions, "wrapper"> & { locale?: Locale } = {},
) {
  return render(ui, {
    ...options,
    wrapper: ({ children }) => <IntlProvider locale={locale}>{children}</IntlProvider>,
  });
}
