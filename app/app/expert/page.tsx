"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cleanQuestionStem } from "@/lib/question-text";

type Question = {
  id: string;
  stem: string;
  options: { key: string; text: string }[];
  course: string | null;
  source_name: string | null;
  source_locator: string | null;
  consensus_status: string;
  review_count: number;
};
export default function ExpertPage() {
  const [items, setItems] = useState<Question[]>([]);
  const [active, setActive] = useState<Question | null>(null);
  const [key, setKey] = useState("");
  const [explanation, setExplanation] = useState("");
  const [confidence, setConfidence] = useState("medium");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const questionId = new URLSearchParams(window.location.search).get(
      "question",
    );
    fetch(`/api/expert/reviews${questionId ? `?question=${questionId}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.questions ?? []);
        setActive(d.questions?.[0] ?? null);
      })
      .catch(() => setMessage("Could not load the expert queue."));
  }, []);
  async function submit() {
    if (!active) return;
    const r = await fetch("/api/expert/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId: active.id,
        selectedKey: key,
        explanation,
        confidence,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      setMessage(d.error ?? "Could not save review.");
      return;
    }
    setMessage(
      d.published
        ? "Admin review published this correction live."
        : "Review saved. It remains independent until another expert submits.",
    );
    setItems(items.filter((x) => x.id !== active.id));
    setActive(items.find((x) => x.id !== active.id) ?? null);
    setKey("");
    setExplanation("");
  }
  return (
    <main>
      <Link className="back-link" href="/">
        ← Home
      </Link>
      <p className="eyebrow">Expert review</p>
      <h1>Resolve open questions.</h1>
      {!active ? (
        <p className="muted">No open questions right now.</p>
      ) : (
        <section className="panel">
          <p className="question-meta">
            {active.course ?? "Course not identified"} ·{" "}
            {Math.min(active.review_count, 2)} / 2 reviews
          </p>
          <p className="stem">{cleanQuestionStem(active.stem)}</p>
          {active.options.map((o) => (
            <label
              key={o.key}
              className={`option ${key === o.key ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="answer"
                checked={key === o.key}
                onChange={() => setKey(o.key)}
              />
              <strong>{o.key}</strong>
              <span>{o.text}</span>
            </label>
          ))}
          <label>Reasoning</label>
          <p className="muted">
            Please cite the supporting source, rule, section, or page within
            your explanation.
          </p>
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Why does the evidence support this option?"
          />
          <label>Confidence</label>
          <select
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button
            className="primary-button"
            type="button"
            disabled={!key || !explanation}
            onClick={() => void submit()}
          >
            Submit independent review
          </button>
          <p className="source">
            Original source: {active.source_name}
            {active.source_locator ? ` · ${active.source_locator}` : ""}
          </p>
        </section>
      )}{" "}
      {message && (
        <p className="status-message" role="status">
          {message}
        </p>
      )}
    </main>
  );
}
