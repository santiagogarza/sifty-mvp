/** The one answer a memory proposal takes; stored on the decision as its option. */
export const REMEMBER_OPTION = "Remember";

/** Header line for the inbox: questions, things Sifty noticed, or both. */
export function describeWaiting(questions: number, proposals: number): string {
  const q = questions === 0 ? null : questions === 1 ? "One question" : `${questions} questions`;
  const p =
    proposals === 0
      ? null
      : proposals === 1
        ? "one thing Sifty noticed about you"
        : `${proposals} things Sifty noticed about you`;
  if (q && p) return `${q} Sifty could not answer on its own, and ${p}. One tap each.`;
  if (q) return `${q} Sifty could not answer on its own. One tap each, or let it decide.`;
  if (p) return `${p.charAt(0).toUpperCase()}${p.slice(1)}. Remember it, or not.`;
  return "Questions Sifty could not answer on its own, and things it noticed, in one place.";
}
