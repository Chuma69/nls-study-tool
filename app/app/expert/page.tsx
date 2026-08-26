"use client";
import { useCallback, useEffect, useState } from "react";
import { cleanQuestionStem } from "@/lib/question-text";
import { COURSE_IDS, COURSE_NAMES } from "@/lib/course-topics";
import { QuestionReport } from "@/components/question-report";
import { ExpertReclassify } from "@/components/expert-reclassify";

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
  const [course, setCourse] = useState("");
  const [items, setItems] = useState<Question[]>([]);
  const [active, setActive] = useState<Question | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingByCourse, setPendingByCourse] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState("");
  const [explanation, setExplanation] = useState("");
  const [confidence, setConfidence] = useState("medium");
  const [message, setMessage] = useState("");

  const loadQueue = useCallback((courseId: string) => {
    setLoading(true);
    fetch(`/api/expert/reviews${courseId ? `?course=${courseId}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.questions ?? []);
        setActive(d.questions?.[0] ?? null);
        setReviewedCount(d.reviewedCount ?? 0);
        setPendingTotal(d.pendingTotal ?? 0);
        setPendingByCourse(d.pendingByCourse ?? {});
        setKey(""); setExplanation("");
      })
      .catch(() => setMessage("Could not load the expert queue."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadQueue(course); }, [course, loadQueue]);

  async function submit() {
    if (!active) return;
    const response = await fetch("/api/expert/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: active.id, selectedKey: key, explanation, confidence }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) { setMessage(data?.error ?? "Could not save review."); return; }
    setMessage(data?.published ? "Published live by admin review." : "Review saved. It stays independent until another expert submits.");
    const reviewedCourse = active.course;
    const remaining = items.filter((x) => x.id !== active.id);
    setItems(remaining);
    setActive(remaining[0] ?? null);
    setReviewedCount((c) => c + 1);
    setPendingTotal((t) => Math.max(0, t - 1));
    if (reviewedCourse) setPendingByCourse((prev) => ({ ...prev, [reviewedCourse]: Math.max(0, (prev[reviewedCourse] ?? 1) - 1) }));
    setKey(""); setExplanation("");
  }

  function skip() {
    if (!active) return;
    const remaining = items.filter((x) => x.id !== active.id);
    setItems(remaining);
    setActive(remaining[0] ?? null);
    setKey(""); setExplanation(""); setMessage("");
  }

  return (
    <main className="narrow expert-page">
      <div className="expert-header">
        <div>
          <p className="eyebrow">Expert review</p>
          <h1>Resolve open questions.</h1>
        </div>
        <div className="expert-stats">
          <div><strong>{reviewedCount}</strong><span>reviewed by you</span></div>
          <div><strong>{pendingTotal}</strong><span>awaiting review</span></div>
        </div>
      </div>

      <nav className="course-filter-bar" aria-label="Filter by course">
        <button type="button" className={`course-chip ${course === "" ? "active" : ""}`} onClick={() => setCourse("")}>
          All courses <span className="course-chip-count">{pendingTotal}</span>
        </button>
        {COURSE_IDS.map((id) => (
          <button key={id} type="button" className={`course-chip ${course === id ? "active" : ""}`} onClick={() => setCourse(id)}>
            {COURSE_NAMES[id]} <span className="course-chip-count">{pendingByCourse[id] ?? 0}</span>
          </button>
        ))}
      </nav>

      {loading ? (
        <p className="muted">Loading the review queue…</p>
      ) : !active ? (
        <section className="panel empty-state">
          <h2>Nothing to review here.</h2>
          <p className="muted">{course ? "This course has no open questions right now. Try another course." : "The queue is clear — thank you. Check back later for new questions."}</p>
        </section>
      ) : (
        <section className="panel expert-review-card">
          <p className="question-meta">
            {active.course ? COURSE_NAMES[active.course as keyof typeof COURSE_NAMES] ?? active.course : "Course not identified"} · {Math.min(active.review_count, 2)} / 2 reviews
          </p>
          <p className="stem">{cleanQuestionStem(active.stem)}</p>
          <div className="options" role="radiogroup" aria-label="Answer options">
            {active.options.map((o) => (
              <label key={o.key} className={`option ${key === o.key ? "selected" : ""}`}>
                <input type="radio" name="answer" checked={key === o.key} onChange={() => setKey(o.key)} />
                <strong>{o.key}</strong><span>{o.text}</span>
              </label>
            ))}
          </div>
          <label htmlFor="expert-reasoning">Reasoning</label>
          <p className="muted field-hint">Cite the supporting source, rule, section, or page in your explanation.</p>
          <textarea id="expert-reasoning" value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Why does the evidence support this option?" />
          <label htmlFor="expert-confidence">Confidence</label>
          <select id="expert-confidence" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button className="primary-button" type="button" disabled={!key || !explanation.trim()} onClick={() => void submit()}>Submit independent review</button>
          {active.source_name && <p className="source">Source: {active.source_name}{active.source_locator ? ` · ${active.source_locator}` : ""}</p>}
          <div className="expert-question-actions">
            <p className="eyebrow">Something off with this question?</p>
            <QuestionReport questionId={active.id} />
            <ExpertReclassify questionId={active.id} currentCourse={active.course} />
            <button type="button" className="text-button" onClick={skip}>Skip for now →</button>
          </div>
        </section>
      )}
      {message && <p className="status-message" role="status">{message}</p>}
    </main>
  );
}
