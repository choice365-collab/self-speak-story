const STOPWORDS = new Set([
  "a", "an", "the", "to", "is", "am", "are", "was", "were",
  "be", "been", "being", "do", "does", "did", "has", "have", "had",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their",
  "in", "on", "at", "of", "for", "with", "by", "from",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter((w) => w.length > 0);
}

function contentTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t));
}

export type FeedbackLevel = "Great!" | "Not Bad" | "Try Again";

export type ErrorCategory =
  | "tense"
  | "word_order"
  | "missing_word"
  | "verb_form"
  | "off_topic"
  | "mixed_korean"
  | "none";

export type EvaluationResult = {
  feedbackLevel: FeedbackLevel;
  isOffTopic: boolean;
  correctedSentence: string | null;
  errorCategory: ErrorCategory;
};

export type CorrectionEntry = {
  timestamp: number;
  targetSentence: string;
  studentTranscript: string;
  correctedSentence: string;
  feedbackLevel: FeedbackLevel;
};

// Detect if text contains Korean characters
function hasKorean(text: string): boolean {
  return /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text);
}

// Infer error category from token analysis
function inferErrorCategory(
  targetTokens: string[],
  studentTokens: string[],
  studentTranscript: string,
  contentRatio: number
): ErrorCategory {
  if (hasKorean(studentTranscript)) return "mixed_korean";
  if (contentRatio < 0.15) return "off_topic";

  const targetSet = new Set(targetTokens);
  const studentSet = new Set(studentTokens);

  // Check missing content words
  const missingWords = targetTokens.filter((t) => !studentSet.has(t) && !STOPWORDS.has(t));
  if (missingWords.length > 0 && missingWords.length >= targetTokens.filter(t => !STOPWORDS.has(t)).length * 0.5) {
    return "missing_word";
  }

  // Simple word order check: same words but different sequence
  const studentFiltered = studentTokens.filter((t) => targetSet.has(t));
  const targetFiltered = targetTokens.filter((t) => studentSet.has(t));
  if (studentFiltered.length >= 2 && targetFiltered.length >= 2) {
    const orderDiff = studentFiltered.join(" ") !== targetFiltered.join(" ");
    if (orderDiff && studentFiltered.length === targetFiltered.length) return "word_order";
  }

  // Default to verb_form for partial matches
  return "verb_form";
}

export function evaluateAttempt(
  targetSentence: string,
  studentTranscript: string
): EvaluationResult {
  const targetTokens = tokenize(targetSentence);
  const studentTokens = tokenize(studentTranscript);

  // Empty or very short
  if (studentTokens.length === 0) {
    return { feedbackLevel: "Try Again", isOffTopic: true, correctedSentence: targetSentence, errorCategory: hasKorean(studentTranscript) ? "mixed_korean" : "off_topic" };
  }

  const targetContent = contentTokens(targetTokens);
  const studentContent = contentTokens(studentTokens);

  if (targetContent.length === 0) {
    const overlap = targetTokens.filter((t) => studentTokens.includes(t)).length;
    const ratio = overlap / Math.max(targetTokens.length, 1);
    if (ratio >= 0.8) return { feedbackLevel: "Great!", isOffTopic: false, correctedSentence: null, errorCategory: "none" };
    if (ratio >= 0.5) return { feedbackLevel: "Not Bad", isOffTopic: false, correctedSentence: targetSentence, errorCategory: "verb_form" };
    return { feedbackLevel: "Try Again", isOffTopic: ratio < 0.2, correctedSentence: targetSentence, errorCategory: inferErrorCategory(targetTokens, studentTokens, studentTranscript, ratio) };
  }

  const matchedContent = targetContent.filter((t) => studentContent.includes(t)).length;
  const contentRatio = matchedContent / targetContent.length;
  const matchedAll = targetTokens.filter((t) => studentTokens.includes(t)).length;
  const allRatio = matchedAll / Math.max(targetTokens.length, 1);
  const score = contentRatio * 0.6 + allRatio * 0.4;

  if (score >= 0.8) {
    return { feedbackLevel: "Great!", isOffTopic: false, correctedSentence: null, errorCategory: "none" };
  }
  if (score >= 0.45) {
    return { feedbackLevel: "Not Bad", isOffTopic: false, correctedSentence: targetSentence, errorCategory: inferErrorCategory(targetTokens, studentTokens, studentTranscript, contentRatio) };
  }
  return {
    feedbackLevel: "Try Again",
    isOffTopic: contentRatio < 0.15,
    correctedSentence: targetSentence,
    errorCategory: inferErrorCategory(targetTokens, studentTokens, studentTranscript, contentRatio),
  };
}
