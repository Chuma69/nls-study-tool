"use client";

import { useEffect, useState, type ReactNode } from "react";
import { COURSE_IDS, COURSE_NAMES, COURSE_TOPICS } from "@/lib/course-topics";
import { SourceMaterialSearch } from "@/components/source-material-search";
import { ScenarioSetEditor } from "@/components/scenario-set-editor";
import { QuestionCreator } from "@/components/question-creator";

type Option = { key: string; text: string };
export type QuickEditQuestion = { id: number; course: string; topic: string | null; stem: string; options: Option[]; material_supported_key: string | null; explanation: string | null; shared_context: string | null; context_group_id: string | null; context_position: number | null };
type ExistingScenario = { context_group_id: string; shared_context: string; course: string; question_count: number };
type CandidateQuestion = { id: number; stem: string; topic: string | null; verification_status: string; context_group_id: string | null; context_position?: number | null };

export function AdminQuestionQuickEdit({ questionId, onSaved, triggerLabel, triggerChildren, triggerClassName, forceAdmin = false }: { questionId: number; onSaved?: (question: QuickEditQuestion) => void; triggerLabel?: string; triggerChildren?: ReactNode; triggerClassName?: string; forceAdmin?: boolean }) {
  const [isAdmin, setIsAdmin] = useState(forceAdmin);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState<QuickEditQuestion | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [unpublishComment, setUnpublishComment] = useState("");
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [scenarios, setScenarios] = useState<ExistingScenario[]>([]);
  const [searchingScenarios, setSearchingScenarios] = useState(false);
  const [showScenarioSearch, setShowScenarioSearch] = useState(true);
  const [questionSearch, setQuestionSearch] = useState("");
  const [candidateQuestions, setCandidateQuestions] = useState<CandidateQuestion[]>([]);
  const [linkedQuestions, setLinkedQuestions] = useState<CandidateQuestion[]>([]);
  const [searchingQuestions, setSearchingQuestions] = useState(false);
  const [showQuestionSearch, setShowQuestionSearch] = useState(false);
  const [scenarioEditorGroupId, setScenarioEditorGroupId] = useState<string | null>(null);
  const [scenarioEditorQuestionId, setScenarioEditorQuestionId] = useState<number | undefined>();

  useEffect(() => {
    if (forceAdmin) { setIsAdmin(true); return; }
    void fetch("/api/session").then((response) => response.ok ? response.json() : null).then((data) => setIsAdmin(data?.user?.role === "admin"));
  }, [forceAdmin]);
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
    if (data.question.context_group_id) {
      const linkedResponse = await fetch(`/api/admin/scenarios?${new URLSearchParams({ contextGroupId: data.question.context_group_id })}`);
      if (linkedResponse.ok) { const linkedData = await linkedResponse.json(); setLinkedQuestions(linkedData.linkedQuestions ?? []); }
    } else setLinkedQuestions([]);
  }
  function update(patch: Partial<QuickEditQuestion>) { setQuestion((current) => current ? { ...current, ...patch } : current); }
  async function save() {
    if (!question) return; setSaving(true); setError("");
    const previousGroupId = question.context_group_id;
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, stem: question.stem, options: question.options, answerKey: question.material_supported_key, explanation: question.explanation, course: question.course, topic: question.topic, scenario: question.shared_context ?? "" }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not publish this edit."); return; }
    const updated = data.question ? { ...question, ...data.question } : question;
    setQuestion(updated); onSaved?.(updated); setOpen(false);
    if (!previousGroupId && updated.context_group_id) { setScenarioEditorQuestionId(question.id); setScenarioEditorGroupId(updated.context_group_id); }
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
  async function findScenarios() {
    if (!question) return;
    setSearchingScenarios(true); setError("");
    const params = new URLSearchParams({ course: question.course, search: scenarioSearch.trim() });
    const response = await fetch(`/api/admin/scenarios?${params}`); const data = await response.json();
    setSearchingScenarios(false);
    if (!response.ok) { setError(data.error ?? "Could not search case studies."); return; }
    setScenarios(data.scenarios ?? []);
  }
  async function attachScenario(scenario: ExistingScenario) {
    if (!question) return;
    setSaving(true); setError("");
    const response = await fetch("/api/admin/scenarios", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, contextGroupId: scenario.context_group_id }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not add this question to the case study."); return; }
    const updated = { ...question, shared_context: data.sharedContext, context_group_id: data.contextGroupId }; setQuestion(updated); onSaved?.(updated); setScenarios([]); setScenarioSearch(""); setOpen(false); setScenarioEditorQuestionId(question.id); setScenarioEditorGroupId(data.contextGroupId);
  }
  async function findCandidateQuestions() {
    if (!question?.context_group_id) return;
    setSearchingQuestions(true); setError("");
    const params = new URLSearchParams({ contextGroupId: question.context_group_id, search: questionSearch.trim() });
    const response = await fetch(`/api/admin/scenarios?${params}`); const data = await response.json();
    setSearchingQuestions(false);
    if (!response.ok) { setError(data.error ?? "Could not search the question bank."); return; }
    setCandidateQuestions(data.questions ?? []); setLinkedQuestions(data.linkedQuestions ?? []);
  }
  async function attachCandidate(candidate: CandidateQuestion) {
    if (!question?.context_group_id) return;
    setSaving(true); setError("");
    const response = await fetch("/api/admin/scenarios", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: candidate.id, contextGroupId: question.context_group_id }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not add this question to the case study."); return; }
    setCandidateQuestions((current) => current.filter((item) => item.id !== candidate.id));
    setLinkedQuestions((current) => [...current, { ...candidate, context_group_id: question.context_group_id }]);
  }

  if (!isAdmin) return null;
  const topics = question?.course && question.course in COURSE_TOPICS ? COURSE_TOPICS[question.course as keyof typeof COURSE_TOPICS].topics : [];
  return <>
    <button className={`${triggerChildren ? "admin-question-row-editor-trigger" : "admin-quick-edit-button"} ${triggerLabel ? "labeled" : ""} ${triggerClassName ?? ""}`} type="button" aria-label="Edit this question" title="Edit this question" onClick={() => { void beginEdit(); }}>{triggerChildren ?? <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Zm9.5-13.5 4 4" /></svg>{triggerLabel && <span>{triggerLabel}</span>}</>}</button>
    {open && <><div className="modal-backdrop" aria-hidden="true" onClick={() => setOpen(false)} /><section className="panel admin-quick-editor" role="dialog" aria-modal="true" aria-label="Edit question">
      <button className="modal-close-button" type="button" aria-label="Close editor" onClick={() => setOpen(false)}>×</button>
      <p className="eyebrow">Admin edit · Question #{questionId}</p>
      {!question ? <p className={error ? "error" : "muted"}>{error || "Loading question…"}</p> : <>
        <label>Question wording</label><textarea value={question.stem} onChange={(event) => update({ stem: event.target.value })} />
        <SourceMaterialSearch questionId={question.id} initialQuery={question.stem} onUseAsScenario={(text) => update({ shared_context: text })} />
        <div className="admin-edit-grid"><div><label>Course</label><select value={question.course} onChange={(event) => update({ course: event.target.value, topic: "" })}><option value="" disabled>Choose a course</option>{COURSE_IDS.map((id) => <option key={id} value={id}>{COURSE_NAMES[id]}</option>)}</select></div><div><label>Topic</label><select value={question.topic ?? ""} onChange={(event) => update({ topic: event.target.value })}><option value="" disabled>Choose a topic</option>{topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}</select></div></div>
        {question.options.map((option, index) => <div className="option-edit" key={option.key}><strong>{option.key}</strong><input value={option.text} onChange={(event) => update({ options: question.options.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} /></div>)}
        <label>Correct answer</label><select value={question.material_supported_key ?? ""} onChange={(event) => update({ material_supported_key: event.target.value })}><option value="" disabled>Choose the correct answer</option>{question.options.map((option) => <option key={option.key} value={option.key}>{option.key} — {option.text}</option>)}</select>
        <label>Explanation</label><textarea value={question.explanation ?? ""} onChange={(event) => update({ explanation: event.target.value })} />
        <div className="existing-scenario-picker">{showScenarioSearch ? <><div className="scenario-picker-heading"><label>Find an existing case study</label><button className="text-button" type="button" onClick={() => setShowScenarioSearch(false)}>Close</button></div><p className="muted">Search case studies in {COURSE_NAMES[question.course as keyof typeof COURSE_NAMES] ?? "this course"}, then add this question to the matching set.</p><div className="scenario-search-row"><input value={scenarioSearch} onChange={(event) => setScenarioSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findScenarios(); } }} placeholder="Search scenario text…" /><button type="button" disabled={searchingScenarios} onClick={() => { void findScenarios(); }}>{searchingScenarios ? "Searching…" : "Search"}</button></div>{scenarios.length > 0 && <div className="scenario-search-results">{scenarios.map((scenario) => <article key={scenario.context_group_id}><p>{scenario.shared_context}</p><div><span className="muted">{scenario.question_count} linked question{scenario.question_count === 1 ? "" : "s"}</span><button type="button" disabled={saving} onClick={() => { void attachScenario(scenario); }}>Add to this case study</button></div></article>)}</div>}{!searchingScenarios && scenarios.length === 0 && scenarioSearch && <p className="muted scenario-empty">No matching case studies found.</p>}</> : <button className="text-button" type="button" onClick={() => setShowScenarioSearch(true)}>Find an existing case study</button>}</div>
        <label>Create or edit case study <span className="muted">(optional)</span></label><textarea value={question.shared_context ?? ""} onChange={(event) => update({ shared_context: event.target.value })} placeholder="Add a new shared scenario for this question. Changes apply to every linked question." />
        {question.context_group_id && <div className="scenario-set-launch"><ScenarioSetEditor contextGroupId={question.context_group_id} onChanged={() => { void findCandidateQuestions(); }} /></div>}
        {question.context_group_id && <div className="existing-scenario-picker"><label>Questions linked to this case study</label><p className="muted">Review every question learners will receive with this scenario.</p><button className="text-button" type="button" disabled={searchingQuestions} onClick={() => { void findCandidateQuestions(); }}>{linkedQuestions.length ? "Refresh linked questions" : "Show linked questions"}</button>{linkedQuestions.length > 0 && <div className="scenario-search-results linked-question-results">{linkedQuestions.map((linked) => <article key={linked.id}><p>{linked.stem}</p><div><span className="muted">{linked.topic || "No topic"} · {linked.verification_status === "material_supported" || linked.verification_status === "staff_corrected" ? "Live" : "Not live"}</span>{linked.id !== question.id && <AdminQuestionQuickEdit questionId={linked.id} triggerLabel="Review now" />}</div></article>)}</div>}<hr />{showQuestionSearch ? <><div className="scenario-picker-heading"><label>Find more questions for this case study</label><button className="text-button" type="button" onClick={() => setShowQuestionSearch(false)}>Close</button></div><p className="muted">Search all questions in this course, including questions that are not live yet. Review or correct them here before adding them.</p><div className="scenario-search-row"><input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findCandidateQuestions(); } }} placeholder="Search question wording…" /><button type="button" disabled={searchingQuestions} onClick={() => { void findCandidateQuestions(); }}>{searchingQuestions ? "Searching…" : "Search questions"}</button></div>{candidateQuestions.length > 0 && <div className="scenario-search-results">{candidateQuestions.map((candidate) => <article key={candidate.id}><p>{candidate.stem}</p><div><span className="muted">{candidate.topic || "No topic"} · {candidate.verification_status === "material_supported" || candidate.verification_status === "staff_corrected" ? "Live" : "Not live"}</span><div className="scenario-result-actions"><AdminQuestionQuickEdit questionId={candidate.id} triggerLabel="Review now" /><button type="button" disabled={saving} onClick={() => { void attachCandidate(candidate); }}>Add to case study</button></div></div></article>)}</div>}{!searchingQuestions && candidateQuestions.length === 0 && questionSearch && <p className="muted scenario-empty">No matching questions found.</p>}<QuestionCreator contextGroupId={question.context_group_id} fixedCourse={question.course} label="Create and add to this case study" onCreated={() => { void findCandidateQuestions(); }} /></> : <button className="text-button" type="button" onClick={() => setShowQuestionSearch(true)}>Find more questions for this case study</button>}</div>}
        {error && <p className="error">{error}</p>}<div className="button-row"><button className="primary-button" type="button" disabled={saving} onClick={() => { void save(); }}>{saving ? "Publishing…" : "Publish changes"}</button></div>
        <div className="critical-admin-action"><p><strong>Critical issue?</strong> Remove this question from learner circulation immediately and leave a follow-up note.</p><textarea value={unpublishComment} onChange={(event) => setUnpublishComment(event.target.value)} placeholder="Describe what is wrong and what needs review…" /><button className="danger-button" type="button" disabled={saving || !unpublishComment.trim()} onClick={() => { void unpublish(); }}>Unpublish immediately</button></div>
      </>}
    </section></>}
    {scenarioEditorGroupId && <ScenarioSetEditor contextGroupId={scenarioEditorGroupId} initialQuestionId={scenarioEditorQuestionId} openOnMount hideTrigger />}
  </>;
}
