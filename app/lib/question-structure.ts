export type QuestionStructure = "standalone" | "scenario" | "group";

export function questionStructure(contextGroupId?: string | null, sharedContext?: string | null): QuestionStructure {
  if (!contextGroupId) return "standalone";
  return sharedContext?.trim() ? "scenario" : "group";
}
