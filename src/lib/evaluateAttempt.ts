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

export type EvaluationResult = {
  feedbackLevel: FeedbackLevel;
  isOffTopic: boolean;
  correctedSentence: string | null;
};

export type CorrectionEntry = {
  timestamp: number;
  targetSentence: string;
  studentTranscript: string;
  correctedSentence: string;
  feedbackLevel: FeedbackLevel;
};

export function evaluateAttempt(
  targetSentence: string,
  studentTranscript: string
): EvaluationResult {
  const targetTokens = tokenize(targetSentence);
  const studentTokens = tokenize(studentTranscript);

  // Empty or very short
  if (studentTokens.length === 0) {
    return { feedbackLevel: "Try Again", isOffTopic: true, correctedSentence: targetSentence };
  }

  const targetContent = contentTokens(targetTokens);
  const studentContent = contentTokens(studentTokens);

  if (targetContent.length === 0) {
    // fallback: use all tokens
    const overlap = targetTokens.filter((t) => studentTokens.includes(t)).length;
    const ratio = overlap / Math.max(targetTokens.length, 1);
    if (ratio >= 0.8) return { feedbackLevel: "Great!", isOffTopic: false, correctedSentence: null };
    if (ratio >= 0.5) return { feedbackLevel: "Not Bad", isOffTopic: false, correctedSentence: targetSentence };
    return { feedbackLevel: "Try Again", isOffTopic: ratio < 0.2, correctedSentence: targetSentence };
  }

  // Content-word overlap
  const matchedContent = targetContent.filter((t) => studentContent.includes(t)).length;
  const contentRatio = matchedContent / targetContent.length;

  // Full token overlap (including stopwords)
  const matchedAll = targetTokens.filter((t) => studentTokens.includes(t)).length;
  const allRatio = matchedAll / Math.max(targetTokens.length, 1);

  // Combined score
  const score = contentRatio * 0.6 + allRatio * 0.4;

  if (score >= 0.8) {
    return { feedbackLevel: "Great!", isOffTopic: false, correctedSentence: null };
  }
  if (score >= 0.45) {
    return { feedbackLevel: "Not Bad", isOffTopic: false, correctedSentence: targetSentence };
  }
  return {
    feedbackLevel: "Try Again",
    isOffTopic: contentRatio < 0.15,
    correctedSentence: targetSentence,
  };
}
