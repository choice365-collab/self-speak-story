/**
 * Converts an internal verb_key into a student-facing display.
 *
 * Rules:
 * - If verb_key contains "_": split at the FIRST underscore.
 *   Left = expression, Right = meaning (remaining "_" → spaces).
 * - If no "_": expression = verb_key, meaning = meaningEn fallback.
 * - Lowercase & trim everything.
 *
 * Examples:
 *   "get_receive"              → "get → receive"
 *   "get_better_become_better" → "get → better become better"
 *   "get ready" + "prepare"    → "get ready → prepare"
 */
export function formatVerbKey(verbKey: string, meaningEn?: string | null): string {
  const idx = verbKey.indexOf("_");

  if (idx > 0) {
    const expression = verbKey.slice(0, idx).trim().toLowerCase();
    const meaning = verbKey.slice(idx + 1).replace(/_/g, " ").trim().toLowerCase();
    return `${expression} → ${meaning}`;
  }

  // No underscore — use meaningEn as the meaning side
  const expression = verbKey.trim().toLowerCase();
  const meaning = meaningEn?.trim().toLowerCase();
  return meaning ? `${expression} → ${meaning}` : expression;
}
