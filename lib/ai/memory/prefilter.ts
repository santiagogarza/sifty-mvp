/**
 * Cheap gate in front of the extraction model.
 *
 * Most captures ("buy milk", "fix the login bug") carry nothing durable
 * about the user; paying a model call to find that out on every sift would
 * add a sixth call to each capture for almost no memories. The regexes
 * below catch the shapes that do tend to carry memories — a named person
 * with a role, first-person habits, standing time or effort preferences,
 * recurring commitments. False negatives are acceptable; an edit that
 * contradicts the sift always runs extraction regardless.
 */

const NAMED_PERSON_RE = /\b[A-Z][a-z]{2,}\b(?:,| \(| my| our| is| who| from| at)/;
const HABIT_RE =
  /\b(?:I|we) (?:always|never|usually|prefer|like to|hate|tend to|only|can'?t|don'?t|need to)\b/i;
const TIME_PREF_RE =
  /\b(?:mornings?|afternoons?|evenings?|weekends?|before noon|after lunch|deep work|focus time|no meetings)\b/i;
const RECURRING_RE =
  /\b(?:every|each) (?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|quarter)\b|\bweekly\b|\bmonthly\b/i;
const ROLE_RE =
  /\bmy (?:accountant|lawyer|doctor|dentist|boss|manager|assistant|landlord|coach|therapist|mentor|co-?founder|partner|investor|advisor|designer|contractor|wife|husband|sister|brother|mother|father|kids?|team)\b/i;

export function looksMemoryWorthy(text: string): boolean {
  const body = text.trim();
  if (body.length < 12) return false;
  return (
    ROLE_RE.test(body) ||
    HABIT_RE.test(body) ||
    TIME_PREF_RE.test(body) ||
    RECURRING_RE.test(body) ||
    // A capitalised name mid-sentence (not the first word) with a role-like continuation.
    NAMED_PERSON_RE.test(body.slice(1))
  );
}
