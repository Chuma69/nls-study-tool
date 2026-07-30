"use client";

import { useEffect, useState } from "react";
import { COURSE_IDS, COURSE_NAMES, COURSE_TOPICS } from "@/lib/course-topics";

type Option = { key: string; text: string };
export type QuickEditQuestion = { id: number; course: string; topic: string | null; stem: string; options: Option[]; material_supported_key: string | null; explanation: string | null; shared_context: string | null };

export function AdminQuestionQuickEdit({ questionId, onSaved }: { questionId: number; onSaved?: (question: QuickEditQuestion) => void }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState<QuickEditQuestion | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [unpublishComment, setUnpublishComment] = useState("");

  useEffect(() => { void fetch("/api/session").then((response) => response.ok ? response.json() : null).then((data) => setIsAdmin(data?.user?.role === "admin")); }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [open]);

  async function beginEdit() {
    setOpen(true); setError(""); setQuestion(null);
    const response = await fetch(`/api/admin/questions?questionId=${questionId}`); const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load this question."); return; }
    setQuestion({ ...data.question, options: Array.isArray(data.question.options) ? data.question.options : [] });
  }
  function update(patch: Partial<QuickEditQuestion>) { setQuestion((current) => current ? { ...current, ...patch } : current); }
  async function save() {
    if (!question) return; setSaving(true); setError("");
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, stem: question.stem, options: question.options, answerKey: question.material_supported_key, explanation: question.explanation, course: question.course, topic: question.topic, scenario: question.shared_context ?? "" }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not publish this edit."); return; }
    onSaved?.(question); setOpen(false);
  }
  async function unpublish() {
    const comment = unpublishComment.trim();
    if (!comment) { setError("Add a short comment explaining the critical issue before unpublishing."); return; }
    if (!window.confirm("Unpublish this question immediately? Learners will stop receiving it.")) return;
    setSaving(true); setError("");
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId, action: "unpublish", comment }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not unpublish this question."); return; }
    setOpen(false); window.location.reload();
  }

  if (!isAdmin) return null;
  const topics = question?.course && question.course in COURSE_TOPICS ? COURSE_TOPICS[question.course as keyof typeof COURSE_TOPICS].topics : [];
  return <>
    <button className="admin-quick-edit-button" type="button" aria-label="Edit this question" title="Edit this question" onClick={() => { void beginEdit(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Zm9.5-13.5 4 4" /></svg></button>
    {open && <><div className="modal-backdrop" aria-hidden="true" onClick={() => setOpen(false)} /><section className="panel admin-quick-editor" role="dialog" aria-modal="true" aria-label="Edit question">
      <button className="modal-close-button" type="button" aria-label="Close editor" onClick={() => setOpen(false)}>×</button>
      <p className="eyebrow">Admin edit · Question #{questionId}</p>
      {!question ? <p className={error ? "error" : "muted"}>{error || "Loading question…"}</p> : <>
        <label>Question wording</label><textarea value={question.stem} onChange={(event) => update({ stem: event.target.value })} />
        <div className="admin-edit-grid"><div><label>Course</label><select value={question.course} onChange={(event) => update({ course: event.target.value, topic: "" })}><option value="" disabled>Choose a course</option>{COURSE_IDS.map((id) => <option key={id} value={id}>{COURSE_NAMES[id]}</option>)}</select></div><div><label>Topic</label><select value={question.topic ?? ""} onChange={(event) => update({ topic: event.target.value })}><option value="" disabled>Choose a topic</option>{topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}</select></div></div>
        {question.options.map((option, index) => <div className="option-edit" key={option.key}><strong>{option.key}</strong><input value={option.text} onChange={(event) => update({ options: question.options.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} /></div>)}
        <label>Correct answer</label><select value={question.material_supported_key ?? ""} onChange={(event) => update({ material_supported_key: event.target.value })}><option value="" disabled>Choose the correct answer</option>{question.options.map((option) => <option key={option.key} value={option.key}>{option.key} — {option.text}</option>)}</select>
        <label>Explanation</label><textarea value={question.explanation ?? ""} onChange={(event) => update({ explanation: event.target.value })} />
        <label>Case study or scenario <span className="muted">(optional)</span></label><textarea value={question.shared_context ?? ""} onChange={(event) => update({ shared_context: event.target.value })} placeholder="Add the shared scenario for this question. Changes apply to every linked question." />
        {error && <p className="error">{error}</p>}<div className="button-row"><button className="primary-button" type="button" disabled={saving} onClick={() => { void save(); }}>{saving ? "Publishing…" : "Publish changes"}</button></div>
        <div className="critical-admin-action"><p><strong>Critical issue?</strong> Remove this question from learner circulation immediately and leave a follow-up note.</p><textarea value={unpublishComment} onChange={(event) => setUnpublishComment(event.target.value)} placeholder="Describe what is wrong and what needs review…" /><button className="danger-button" type="button" disabled={saving || !unpublishComment.trim()} onClick={() => { void unpublish(); }}>Unpublish immediately</button></div>
      </>}
    </section></>}
  </>;
}
