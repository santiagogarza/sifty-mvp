import { toLocalIsoDate } from "./snooze";

/**
 * Natural-language due dates for capture.
 *
 * A deliberately small grammar instead of a general parser: Sifty tracks
 * due dates at day precision, in the user's local calendar, and its own
 * conventions ("next week" is the coming Monday, exactly as the snooze
 * shortcuts resolve it) matter more than exotic phrasings. Everything is
 * computed with local `Date` fields and `setDate`, so a parse on the
 * evening of a DST change or across a month/year boundary lands on the
 * right calendar day.
 *
 * Recognized (case-insensitive, whole words, optional leading
 * by / on / before / until / due):
 *   today · tonight · tomorrow · day after tomorrow · this weekend
 *   <weekday> · this <weekday> · next <weekday> · abbreviations after a
 *   preposition ("by fri")
 *   next week (Monday) · next month (the 1st) · end of week/month/year · eow · eom
 *   in N days/weeks/months · in a week
 *   Oct 13 · October 13th · 13 Oct · 13th of October · 10/13 · 2026-10-13 · the 15th
 *   an attached time of day ("tomorrow 3pm", "at 15:00", "tomorrow morning")
 *
 * A time alone ("at 3pm") means today. The time is reported for display;
 * the due date stays day-precision.
 */

export interface NlDateMatch {
  /** Local calendar day, `YYYY-MM-DD`. */
  due: string;
  /** Character range of the matched phrase in the source text. */
  start: number;
  end: number;
  /** The matched phrase verbatim, as typed. */
  text: string;
  /** Time of day the phrase carried, normalized for display ("3pm", "15:00"), or null. */
  time: string | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ABBR: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_ABBR: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const SMALL_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const PREP = "(?:(?:by|on|before|until|till|due|due by|due on)\\s+)?";
const WEEKDAY_FULL = "(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)";
const WEEKDAY_ABBR_RE = "(?:sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)";
const MONTH_RE =
  "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";
const ORD = "(?:st|nd|rd|th)?";
const COMMON_FRACTIONS = new Set(["1/2", "1/3", "1/4", "2/3", "3/4", "1/8", "3/8", "5/8", "7/8"]);
/** "tomorrow's standup" names a meeting, not a deadline. */
const NOT_POSSESSIVE = "(?!['\u2019]s\\b)";
const TIME_RE =
  "(?:(?:at\\s+)?(?:(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)|(\\d{1,2}):(\\d{2})|(noon|midday|midnight))|(morning|afternoon|evening|night))";

interface Rule {
  re: RegExp;
  resolve(m: RegExpExecArray, today: Date, text: string): Date | null;
}

const RULES: Rule[] = [
  {
    re: new RegExp(`\\b${PREP}(?:the\\s+)?day after tomorrow\\b${NOT_POSSESSIVE}`, "gi"),
    resolve: (_m, today) => addDays(today, 2),
  },
  {
    re: new RegExp(`\\b${PREP}(?:tomorrow|tmrw|tmr)\\b${NOT_POSSESSIVE}`, "gi"),
    resolve: (_m, today) => addDays(today, 1),
  },
  {
    re: new RegExp(`\\b${PREP}(?:today|tonight)\\b${NOT_POSSESSIVE}`, "gi"),
    resolve: (_m, today) => today,
  },
  {
    re: new RegExp(`\\b${PREP}this weekend\\b${NOT_POSSESSIVE}`, "gi"),
    // Saturday or Sunday: the weekend is already here.
    resolve: (_m, today) =>
      today.getDay() === 0 ? today : nextWeekday(today, 6, { allowToday: true }),
  },
  {
    re: new RegExp(
      `\\b${PREP}(?:end of (?:the |this )?(week|month|year)|(eow|eom|eoy))\\b${NOT_POSSESSIVE}`,
      "gi",
    ),
    resolve: (m, today) => {
      const unit = (m[1] ?? m[2] ?? "").toLowerCase();
      if (unit === "week" || unit === "eow") return endOfWorkWeek(today);
      if (unit === "month" || unit === "eom") {
        return new Date(today.getFullYear(), today.getMonth() + 1, 0);
      }
      return new Date(today.getFullYear(), 11, 31);
    },
  },
  {
    re: new RegExp(`\\b${PREP}next week\\b${NOT_POSSESSIVE}`, "gi"),
    resolve: (_m, today) => nextWeekday(today, 1, { allowToday: false }),
  },
  {
    re: new RegExp(`\\b${PREP}next month\\b${NOT_POSSESSIVE}`, "gi"),
    resolve: (_m, today) => new Date(today.getFullYear(), today.getMonth() + 1, 1),
  },
  {
    re: new RegExp(
      `\\b${PREP}in\\s+(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(day|days|week|weeks|wk|wks|month|months)\\b`,
      "gi",
    ),
    resolve: (m, today) => {
      const raw = m[1]!.toLowerCase();
      const n = SMALL_NUMBERS[raw] ?? Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      const unit = m[2]!.toLowerCase();
      if (unit.startsWith("day")) return addDays(today, n);
      if (unit.startsWith("w")) return addDays(today, n * 7);
      return addMonths(today, n);
    },
  },
  {
    re: new RegExp(
      `\\b${PREP}next\\s+(${WEEKDAY_FULL}|${WEEKDAY_ABBR_RE})\\b${NOT_POSSESSIVE}`,
      "gi",
    ),
    resolve: (m, today) => {
      const weekday = weekdayIndex(m[1]!);
      if (weekday === null) return null;
      // "Next Friday" is next week's Friday: the coming one, pushed a week
      // out when it still falls inside this Monday–Sunday week.
      const coming = nextWeekday(today, weekday, { allowToday: true });
      return sameWeek(today, coming) ? addDays(coming, 7) : coming;
    },
  },
  {
    // "last Friday" is history, not a deadline.
    re: new RegExp(
      `(?<!\\blast\\s)\\b${PREP}(?:this\\s+)?(${WEEKDAY_FULL})\\b${NOT_POSSESSIVE}`,
      "gi",
    ),
    resolve: (m, today) => {
      const weekday = weekdayIndex(m[1]!);
      return weekday === null ? null : nextWeekday(today, weekday, { allowToday: true });
    },
  },
  {
    // Abbreviations are everyday words too ("sat down", "mon ami"), so they
    // only count after a preposition or "this".
    re: new RegExp(
      `\\b(?:by|on|before|until|till|due|due by|due on|this)\\s+(${WEEKDAY_ABBR_RE})\\b${NOT_POSSESSIVE}`,
      "gi",
    ),
    resolve: (m, today) => {
      const weekday = weekdayIndex(m[1]!);
      return weekday === null ? null : nextWeekday(today, weekday, { allowToday: true });
    },
  },
  {
    re: new RegExp(`\\b${PREP}(${MONTH_RE})\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`, "gi"),
    resolve: (m, today) => monthDay(today, m[1]!, m[2]!, m[3]),
  },
  {
    re: new RegExp(
      `\\b${PREP}(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${MONTH_RE})\\b(?:,?\\s+(\\d{4}))?`,
      "gi",
    ),
    resolve: (m, today) => monthDay(today, m[2]!, m[1]!, m[3]),
  },
  {
    re: new RegExp(`\\b${PREP}(\\d{4})-(\\d{2})-(\\d{2})\\b`, "gi"),
    resolve: (m) => validDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  },
  {
    re: new RegExp(`\\b${PREP}(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?\\b`, "gi"),
    resolve: (m, today, text) => {
      // "1/2 cup" and "by 1/2 of the budget" are fractions. A slash date is
      // the ambiguous form, so it only counts with nothing but punctuation
      // or a time of day behind it, preposition or not; month names carry
      // no such restriction.
      const tail = text.slice(m.index + m[0].length);
      if (
        !/^(?:\s*$|\s*[,.;!?)]|\s+(?:at\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|noon|midday|midnight)\b)/i.test(
          tail,
        )
      ) {
        return null;
      }
      const month = Number(m[1]) - 1;
      const day = Number(m[2]);
      if (m[3]) {
        const y = Number(m[3]);
        return validDate(y < 100 ? 2000 + y : y, month, day);
      }
      // Without a year, the everyday fractions read as fractions, not as
      // Jan 2 / Feb 3 / Mar 4 — people write those with the month's name.
      if (COMMON_FRACTIONS.has(`${Number(m[1])}/${day}`)) return null;
      return forwardDate(today, month, day);
    },
  },
  {
    re: new RegExp(
      `\\b(?:by|on|before|until|till|due|due by|due on)\\s+the\\s+(\\d{1,2})${ORD}\\b(?!\\s+(?:of\\s+)?${MONTH_RE}\\b)`,
      "gi",
    ),
    resolve: (m, today) => {
      const day = Number(m[1]);
      if (day < 1 || day > 31) return null;
      const thisMonth = validDate(today.getFullYear(), today.getMonth(), day);
      if (thisMonth && thisMonth.getTime() >= today.getTime()) return thisMonth;
      return validDate(today.getFullYear(), today.getMonth() + 1, day);
    },
  },
];

const TIME_ONLY =
  /(?:^|\s)(at\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|noon|midday|midnight)|\d{1,2}(?::\d{2})?\s*(?:am|pm))(?=$|[\s,.;!?])/i;
const TIME_AFTER = new RegExp(`^(?:\\s*(?:,|at)?\\s+${TIME_RE})(?=$|[\\s,.;!?)])`, "i");
const TIME_BEFORE = new RegExp(`(?:^|\\s)${TIME_RE}\\s*,?\\s*$`, "i");

/** Parse the first due-date phrase in `text`, resolved against `now`'s local day. */
export function parseNaturalDate(text: string, now: Date = new Date()): NlDateMatch | null {
  const today = startOfDay(now);
  let best: { match: NlDateMatch; prioritized: boolean } | null = null;

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null = rule.re.exec(text);
    while (m) {
      const date = rule.resolve(m, today, text);
      if (date && !Number.isNaN(date.getTime())) {
        const candidate = attachTime(text, m.index, m.index + m[0].length, date);
        const prioritized = /^(by|on|before|until|till|due)\b/i.test(m[0]);
        if (
          !best ||
          (prioritized && !best.prioritized) ||
          (prioritized === best.prioritized &&
            (candidate.start < best.match.start ||
              (candidate.start === best.match.start && candidate.end > best.match.end)))
        ) {
          best = { match: candidate, prioritized };
        }
      }
      // Zero-width safety; every rule consumes at least one char.
      if (m[0].length === 0) rule.re.lastIndex++;
      m = rule.re.exec(text);
    }
  }
  if (best) return best.match;

  const timeOnly = TIME_ONLY.exec(text);
  if (timeOnly) {
    const lead = timeOnly[0].length - timeOnly[0].trimStart().length;
    const start = timeOnly.index + lead;
    const phrase = text.slice(start, timeOnly.index + timeOnly[0].length);
    return {
      due: toLocalIsoDate(today),
      start,
      end: start + phrase.length,
      text: phrase,
      time: normalizeTime(phrase),
    };
  }
  return null;
}

/** The text with the matched phrase (and the punctuation it leaves behind) removed. */
export function stripMatch(text: string, match: Pick<NlDateMatch, "start" | "end">): string {
  const before = text.slice(0, match.start).replace(/[\s,;:–-]+$/, "");
  const after = text.slice(match.end).replace(/^[\s,;:–-]+/, "");
  const joined = after ? (before ? `${before} ${after}` : after) : before;
  const cleaned = joined.replace(/\s+/g, " ").trim();
  return cleaned.length ? cleaned : text.trim();
}

/** "Fri, Oct 16" — the chip's wording, same shape as the snooze toast. */
export function describeDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------

function attachTime(text: string, from: number, to: number, date: Date): NlDateMatch {
  let start = from;
  let end = to;
  let time: string | null = null;
  const after = TIME_AFTER.exec(text.slice(end));
  if (after) {
    end += after[0].length;
    time = normalizeTime(after[0]);
  } else {
    const before = TIME_BEFORE.exec(text.slice(0, start));
    if (before) {
      const lead = before[0].length - before[0].trimStart().length;
      start = before.index + lead;
      time = normalizeTime(before[0]);
    }
  }
  return { due: toLocalIsoDate(date), start, end, text: text.slice(start, end), time };
}

function normalizeTime(phrase: string): string | null {
  const p = phrase.toLowerCase();
  const clock = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/.exec(p);
  if (clock) return `${Number(clock[1])}${clock[2] ? `:${clock[2]}` : ""}${clock[3]}`;
  const twentyFour = /(\d{1,2}):(\d{2})/.exec(p);
  if (twentyFour) return `${twentyFour[1]!.padStart(2, "0")}:${twentyFour[2]}`;
  const word = /(noon|midday|midnight|morning|afternoon|evening|night)/.exec(p);
  return word ? word[1]! : null;
}

function weekdayIndex(word: string): number | null {
  const w = word.toLowerCase();
  const full = WEEKDAYS.indexOf(w);
  if (full >= 0) return full;
  return WEEKDAY_ABBR[w] ?? null;
}

function monthIndex(word: string): number | null {
  const w = word.toLowerCase();
  const full = MONTHS.indexOf(w);
  if (full >= 0) return full;
  return MONTH_ABBR[w] ?? null;
}

function monthDay(today: Date, monthWord: string, dayText: string, yearText?: string): Date | null {
  const month = monthIndex(monthWord);
  if (month === null) return null;
  const day = Number(dayText);
  if (yearText) return validDate(Number(yearText), month, day);
  return forwardDate(today, month, day);
}

/** A month/day without a year: this year, or next year once it has passed. */
function forwardDate(today: Date, month: number, day: number): Date | null {
  const thisYear = validDate(today.getFullYear(), month, day);
  if (!thisYear) return null;
  if (thisYear.getTime() >= today.getTime()) return thisYear;
  return validDate(today.getFullYear() + 1, month, day);
}

/** Rejects overflow such as Feb 30 instead of letting `Date` roll it over. */
function validDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

/** Adds whole months, clamping to the target month's length (Jan 31 + 1 → Feb 28/29). */
function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

function nextWeekday(today: Date, weekday: number, opts: { allowToday: boolean }): Date {
  let delta = (weekday - today.getDay() + 7) % 7;
  if (delta === 0 && !opts.allowToday) delta = 7;
  return addDays(today, delta);
}

/** Monday-based week index comparison. */
function sameWeek(a: Date, b: Date): boolean {
  return mondayOf(a).getTime() === mondayOf(b).getTime();
}

function mondayOf(d: Date): Date {
  const daysSinceMonday = (d.getDay() + 6) % 7;
  return addDays(d, -daysSinceMonday);
}

/** Friday of the current Monday–Sunday week; from Saturday on, next Friday. */
function endOfWorkWeek(today: Date): Date {
  const friday = addDays(mondayOf(today), 4);
  return friday.getTime() >= today.getTime() ? friday : addDays(friday, 7);
}
