/**
 * Converts an internal verb_key like "GET_READY_PREPARE"
 * into a student-facing display: "get ready → prepare"
 *
 * Rules:
 * - Split at the LAST underscore
 * - Left = expression, Right = meaning
 * - Replace remaining underscores with spaces
 * - Lowercase everything
 */
export function formatVerbKey(verbKey: string): string {
  const lastUnderscore = verbKey.lastIndexOf("_");
  if (lastUnderscore <= 0) return verbKey.toLowerCase();

  const expression = verbKey.slice(0, lastUnderscore).replace(/_/g, " ").toLowerCase();
  const meaning = verbKey.slice(lastUnderscore + 1).replace(/_/g, " ").toLowerCase();

  return `${expression} → ${meaning}`;
}
