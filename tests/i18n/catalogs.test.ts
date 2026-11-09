import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { CATALOGS } from "@/messages";
import { type MessageFormatElement, TYPE, parse } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";

/**
 * Every locale must carry exactly the English keys, with the same ICU
 * arguments and rich-text tags, so a screen is never half-translated and a
 * Spanish string can never drop a `{count}` the code passes in.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** Argument names and tag names a message uses, e.g. `{count}` and `<hl>`. */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  const walk = (elements: MessageFormatElement[]) => {
    for (const el of elements) {
      if (el.type === TYPE.literal || el.type === TYPE.pound) continue;
      names.add(el.type === TYPE.tag ? `<${el.value}>` : `{${el.value}}`);
      if (el.type === TYPE.tag) walk(el.children);
      if (el.type === TYPE.plural || el.type === TYPE.select) {
        for (const option of Object.values(el.options)) walk(option.value);
      }
    }
  };
  walk(parse(message));
  return [...names].sort();
}

const english = CATALOGS[DEFAULT_LOCALE];
const others = LOCALES.filter((l) => l !== DEFAULT_LOCALE);

describe("message catalogs", () => {
  it("every locale registers the same namespaces as English", () => {
    for (const locale of others) {
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual(Object.keys(english).sort());
    }
  });

  for (const locale of others) {
    describe(locale, () => {
      for (const namespace of Object.keys(english) as Array<keyof typeof english>) {
        const base = flatten(english[namespace] as Tree);
        const translated = flatten(CATALOGS[locale][namespace] as Tree);

        it(`${namespace}: has exactly the English keys`, () => {
          expect([...translated.keys()].sort()).toEqual([...base.keys()].sort());
        });

        it(`${namespace}: no empty strings, same placeholders and tags`, () => {
          for (const [key, message] of translated) {
            expect(message.trim(), `${namespace}.${key} is empty`).not.toBe("");
            const source = base.get(key);
            if (source === undefined) continue;
            expect(placeholders(message), `${namespace}.${key}`).toEqual(placeholders(source));
          }
        });
      }
    });
  }

  it("English messages are valid ICU", () => {
    for (const namespace of Object.keys(english) as Array<keyof typeof english>) {
      for (const [key, message] of flatten(english[namespace] as Tree)) {
        expect(() => parse(message), `${namespace}.${key}`).not.toThrow();
      }
    }
  });

  it("falls back to English for a key a locale lacks", () => {
    const es = getMessages("es");
    expect(es.shell.nav.settings).toBe("Configuración");
    expect(Object.keys(es)).toEqual(Object.keys(english));
  });
});
