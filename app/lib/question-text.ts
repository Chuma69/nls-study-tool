export function cleanQuestionStem(stem: string) {
  return stem.replace(/^\s*\d{1,3}\s*[\.\):\-]\s*/, "");
}
