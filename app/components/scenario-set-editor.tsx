"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { COURSE_NAMES, COURSE_TOPICS } from "@/lib/course-topics";
import { QuestionCreator } from "@/components/question-creator";

type Option = { key: string; text: string };
type ScenarioQuestion = { id: number; course: string; topic: string | null; stem: string; options: Option[]; material_supported_key: string | null; explanation: string | null; verification_status: string; context_position: number | null; shared_context: string | null };

export function ScenarioSetEditor({ contextGroupId, onChanged, triggerClassName, triggerChildren }: { contextGroupId: string; onChanged?: () => void; triggerClassName?: string; triggerChildren?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<ScenarioQuestion[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [scenario, setScenario] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = questions.find((question) => question.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  async function load(preferredId?: number) {
    setOpen(true); setLoading(true); setError("");
    const response = await fetch(`/api/admin/scenarios?${new URLSearchParams({ contextGroupId })}`);
    const data = await response.json(); setLoading(false);
    if (!response.ok) { setError(data.error ?? "Could not load this scenario set."); return; }
    const linked = (data.linkedQuestions ?? []) as ScenarioQuestion[];
    setQuestions(linked); setActiveId(preferredId && linked.some((question) => question.id === preferredId) ? preferredId : linked[0]?.id ?? null); setScenario(linked[0]?.shared_context ?? "");
  }

  function updateActive(patch: Partial<ScenarioQuestion>) {
    setQuestions((current) => current.map((question) => question.id === activeId ? { ...question, ...patch } : question));
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    setQuestions((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }
  async function save(publishActive: boolean) {
    if (!active) return;
    setSaving(true); setError("");
    for (const question of questions) {
      const isCurrentlyLive = question.verification_status === "material_supported" || question.verification_status === "staff_corrected";
      const publish = question.id === active.id ? publishActive : isCurrentlyLive;
      const questionResponse = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, stem: question.stem, options: question.options, answerKey: question.material_supported_key, explanation: question.explanation, course: question.course, topic: question.topic, publish }) });
      const questionData = await questionResponse.json();
      if (!questionResponse.ok) { setSaving(false); setError(`Question ${question.id}: ${questionData.error ?? "Could not publish this question."}`); return; }
    }
    const orderResponse = await fetch("/api/admin/scenarios", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reorder", contextGroupId, questionIds: questions.map((question) => question.id), sharedContext: scenario }) });
    const orderData = await orderResponse.json(); setSaving(false);
    if (!orderResponse.ok) { setError(orderData.error ?? "The question was saved, but the scenario order could not be updated."); return; }
    setQuestions((current) => current.map((question, index) => ({ ...question, shared_context: scenario, context_position: index + 1, verification_status: question.id === active.id ? (publishActive ? "staff_corrected" : "unreviewed") : question.verification_status })));
    onChanged?.();
  }

  const topics = active?.course && active.course in COURSE_TOPICS ? COURSE_TOPICS[active.course as keyof typeof COURSE_TOPICS].topics : [];
  const editor = open && typeof document !== "undefined" ? createPortal(<><div className="modal-backdrop scenario-set-backdrop" aria-hidden="true" /><section className="panel scenario-set-editor" role="dialog" aria-modal="true" aria-label="Edit full scenario set">
      <button className="modal-close-button" type="button" aria-label="Close scenario editor" onClick={() => setOpen(false)}>×</button>
      <p className="eyebrow">Full scenario set</p>
      {loading ? <p className="muted">Loading linked questions…</p> : error && !questions.length ? <p className="error">{error}</p> : <>
        <label>Case study shown with every linked question</label><textarea className="scenario-set-context" value={scenario} onChange={(event) => setScenario(event.target.value)} />
        <div className="scenario-set-workspace">
          <aside className="scenario-set-sidebar"><div><strong>{questions.length} linked questions</strong><span className="muted">Use the arrows to set learner order</span><QuestionCreator contextGroupId={contextGroupId} fixedCourse={questions[0]?.course} label="Add question to this set" onCreated={(question) => { void load(question.id); }} /></div>{questions.map((question, index) => <div className={`scenario-set-item ${question.id === activeId ? "active" : ""}`} key={question.id}><button type="button" className="scenario-set-select" onClick={() => setActiveId(question.id)}><span>{index + 1}</span><span>{question.stem}</span></button><div className="scenario-order-actions"><button type="button" aria-label="Move question up" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label="Move question down" disabled={index === questions.length - 1} onClick={() => move(index, 1)}>↓</button></div></div>)}</aside>
          {active && <div className="scenario-set-question-editor"><p className="eyebrow">Question {questions.findIndex((question) => question.id === active.id) + 1} · {active.verification_status === "material_supported" || active.verification_status === "staff_corrected" ? "Live" : "Not live"}</p><label>Question wording</label><textarea value={active.stem} onChange={(event) => updateActive({ stem: event.target.value })} /><div className="admin-edit-grid"><div><label>Course</label><input value={COURSE_NAMES[active.course as keyof typeof COURSE_NAMES] ?? active.course} disabled /></div><div><label>Topic</label><select value={active.topic ?? ""} onChange={(event) => updateActive({ topic: event.target.value })}><option value="" disabled>Choose a topic</option>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select></div></div>{active.options.map((option, index) => <div className="option-edit" key={option.key}><strong>{option.key}</strong><input value={option.text} onChange={(event) => updateActive({ options: active.options.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} /></div>)}<label>Correct answer</label><select value={active.material_supported_key ?? ""} onChange={(event) => updateActive({ material_supported_key: event.target.value })}><option value="" disabled>Choose the correct answer</option>{active.options.map((option) => <option key={option.key} value={option.key}>{option.key} — {option.text}</option>)}</select><label>Explanation</label><textarea value={active.explanation ?? ""} onChange={(event) => updateActive({ explanation: event.target.value })} /></div>}
        </div>
        {error && <p className="error">{error}</p>}<p className="muted scenario-publish-note">These actions apply to the selected question only. Edits and ordering for the full scenario set are saved at the same time.</p><div className="button-row"><button className="primary-button" type="button" disabled={saving || !active} onClick={() => { void save(true); }}>{saving ? "Saving…" : "Save and publish"}</button><button className="outline-button" type="button" disabled={saving || !active} onClick={() => { void save(false); }}>{saving ? "Saving…" : "Unpublish"}</button></div>
      </>}
    </section></>, document.body) : null;
  return <>
    <button className={triggerClassName ?? "outline-button"} type="button" onClick={() => { void load(); }}>{triggerChildren ?? "Edit full scenario set"}</button>
    {editor}
  </>;
}
