# Translating Sifty

Sifty uses [next-intl](https://next-intl.dev) without locale routing: the
language is a personal setting (Settings → Language) stored in the
`NEXT_LOCALE` cookie, read per request in `lib/i18n/request.ts`. English
(`en`) is the default and the fallback; Spanish (`es`) is the second locale.
URLs never change with the language.

Spanish copy follows the shared glossary (tú, neutral Latin American
Spanish, product terms). Ask the coordinator for it if you don't have it;
don't invent a second word for a term the glossary already fixes.

## Layout

```
messages/
  index.ts            registry of every namespace, per locale (do not edit)
  en/<namespace>.json English source of truth
  es/<namespace>.json Spanish, exactly the same keys
```

One namespace per screen group. Each group owns its two JSON files, so
translators working in parallel never edit the same file.

| Namespace | Owns | Owner |
| --- | --- | --- |
| `common` | Shared actions, states, status names, plan tiers | Foundation — read-only for screen PRs |
| `shell` | Sidebar, bottom nav, top bar, command palette, shortcuts, sync notice, 404 | Foundation |
| `settings` | `/settings` page and sessions panel | Foundation |
| `tasks` | Today / Focus / Inbox / Waiting / Someday / Done lists, board, empty states, welcome and plan cards | Screen group |
| `taskDetail` | Capture dialog, task detail sheet, recurrence editor, pills | Screen group |
| `decisions` | `/decisions` and its components | Screen group |
| `memory` | `/memory` | Screen group |
| `account` | Billing, notifications, redeem, admin costs, payment banner | Screen group |
| `auth` | Sign in / up, password reset | Screen group |
| `marketing` | Landing, pricing, legal pages, site header/footer | Screen group |

Need a word that's already in `common` (Cancel, Save, a status name)? Use
it. Need a new shared word? Put it in your own namespace instead of editing
`common` — a duplicate string is cheaper than a merge conflict.

## Using translations

Client components:

```tsx
import { useTranslations } from "next-intl";

const t = useTranslations("tasks");
t("emptyInbox.title");
t("selected", { count: 3 }); // "{count, plural, one {# task} other {# tasks}} selected"
t.rich("hint", { key: (chunks) => <kbd>{chunks}</kbd> }); // "Press <key>c</key>"
```

Server components, `generateMetadata`, route handlers:

```ts
import { getTranslations } from "next-intl/server";

const t = await getTranslations("tasks");
```

Shared vocabulary: `useTranslations("common.status")` then
`t(\`${lifecycle}.label\`)`. Keys are type-checked against the English
catalog, so a typo or a missing English key fails `pnpm typecheck`.

## Rules

- Add every key to **both** `en/<ns>.json` and `es/<ns>.json` in the same
  PR. `tests/i18n/catalogs.test.ts` fails on a missing key, an empty
  string, or a placeholder/tag that differs between languages.
- Messages are [ICU](https://next-intl.dev/docs/usage/messages): use
  `{count, plural, one {…} other {…}}` for counts and `{name}` for values.
  Never build sentences by concatenating translated fragments; word order
  differs in Spanish.
- Markup inside a sentence uses rich-text tags (`<hl>…</hl>`), not split
  strings.
- Dates and numbers: `useFormatter()` / `getFormatter()`, always with an
  explicit `timeZone` (the user's for task dates, `"UTC"` for billing days).
- Leave untranslated: the product name Sifty, model/provider names, key
  names on `<Kbd>` (Esc, Shift, ⌘), env var names, `data-testid`s.
- Keep keys semantic and nested by area (`emptyInbox.title`, not
  `text12`). Sort is free; nesting is what matters.
- Domain modules (`lib/domain/*`) keep their English strings: AI prompts,
  emails, and logs read them. Translate at the component that renders
  them.
- Server-side text that isn't tied to a request (emails, push, AI output)
  is out of scope until the locale is stored on the account.

## Tests

Component tests that render translated components wrap them in the
provider:

```tsx
import { renderWithIntl } from "../helpers/intl";

renderWithIntl(<MyComponent />);                   // English
renderWithIntl(<MyComponent />, { locale: "es" }); // Spanish
```

Existing assertions on English text keep working under `renderWithIntl`.
Add at least one Spanish assertion per screen you translate.

## Trying it in Spanish

```bash
SIFTY_DISABLE_AUTH=1 SIFTY_AI_OFFLINE=1 pnpm dev
```

Open <http://localhost:3000/settings>, pick **Español** under Language.
Or set the cookie directly in the browser console:
`document.cookie = "NEXT_LOCALE=es; path=/"` and reload. Delete the cookie
(or pick English) to go back.

Before opening the PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
