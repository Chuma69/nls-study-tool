"use client";

// An expert account can both review questions and study as a learner. This tracks which
// "mode" the reviewer is currently using, persisted per browser. Default is the review view.
export const EXPERT_MODE_KEY = "callready:expertMode";
export const EXPERT_MODE_EVENT = "callready:mode";

export type ExpertMode = "review" | "learner";

export function getExpertMode(): ExpertMode {
  if (typeof window === "undefined") return "review";
  return window.localStorage.getItem(EXPERT_MODE_KEY) === "learner" ? "learner" : "review";
}

export function setExpertMode(mode: ExpertMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EXPERT_MODE_KEY, mode);
  window.dispatchEvent(new Event(EXPERT_MODE_EVENT));
}
