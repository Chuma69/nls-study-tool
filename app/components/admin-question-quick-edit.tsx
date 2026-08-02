"use client";

import { useEffect, useState, type ReactNode } from "react";
import { COURSE_IDS, COURSE_NAMES, COURSE_TOPICS } from "@/lib/course-topics";
import { SourceMaterialSearch } from "@/components/source-material-search";
import { ScenarioSetEditor } from "@/components/scenario-set-editor";
import { QuestionCreator } from "@/components/question-creator";
import { ModularOptionEditor } from "@/components/modular-option-editor";
import { questionStructure, type QuestionStructure } from "@/lib/question-structure";

type Option = { key: string; text: string };
export type QuickEditQuestion = { id: number; course: string; topic: string | null; stem: string; options: Option[]; material_supported_key: string | null; explanation: string | null; shared_context: string | null; context_group_id: string | null; context_position: number | null };
type ExistingScenario = { context_group_id: string; shared_context: string | null; course: string; question_count: number };
type CandidateQuestion = { id: number; stem: string; topic: string | null; verification_status: string; context_group_id: string | null; context_position?: number | null };
type ReviewFlag = { id: number; note: string | null; created_at: string; reviewer: string };
type LearnerReview = { id: number; category: string; details: string | null; reporter: string; created_at: string; status?: "open" | "resolved" };

export function AdminQuestionQuickEdit({ questionId, onSaved, onReviewResolved, learnerReview, triggerLabel, triggerChildren, triggerClassName, forceAdmin = false }: { questionId: number; onSaved?: (question: QuickEditQuestion) => void; onReviewResolved?: () => void; learnerReview?: LearnerReview; triggerLabel?: string; triggerChildren?: ReactNode; triggerClassName?: string; forceAdmin?: boolean }) {
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
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [scenarioEditorGroupId, setScenarioEditorGroupId] = useState<string | null>(null);
  const [scenarioEditorQuestionId, setScenarioEditorQuestionId] = useState<number | undefined>();
  const [reviewFlags, setReviewFlags] = useState<ReviewFlag[]>([]);
  const [notice, setNotice] = useState("");
  const [structure, setStructure] = useState<QuestionStructure>("standalone");

  useEffect(() => {
    if (forceAdmin) { setIsAdmin(true); return; }
    void fetch("/api/session").then((response) => response.ok ? response.json() : null).then((data) => setIsAdmin(data?.user?.role === "admin"));
  }, [forceAdmin]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (question && !saving) void save("save");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", handleShortcut); };
  }, [open, question, saving, structure]); // eslint-disable-line react-hooks/exhaustive-deps

  async function beginEdit() {
    setOpen(true); setError(""); setQuestion(null); setCandidateQuestions([]); setSelectedCandidateIds([]); setQuestionSearch("");
    const response = await fetch(`/api/admin/questions?questionId=${questionId}`); const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load this question."); return; }
    setQuestion({ ...data.question, options: Array.isArray(data.question.options) ? data.question.options : [] });
    setStructure(questionStructure(data.question.context_group_id, data.question.shared_context));
    setReviewFlags(Array.isArray(data.reviewFlags) ? data.reviewFlags : []);
    if (data.question.context_group_id) {
      const linkedResponse = await fetch(`/api/admin/scenarios?${new URLSearchParams({ contextGroupId: data.question.context_group_id })}`);
      if (linkedResponse.ok) { const linkedData = await linkedResponse.json(); setLinkedQuestions(linkedData.linkedQuestions ?? []); }
    } else setLinkedQuestions([]);
  }
  function update(patch: Partial<QuickEditQuestion>) { setQuestion((current) => current ? { ...current, ...patch } : current); }
  async function save(mode: "save" | "publish") {
    if (!question) return; setSaving(true); setError(""); setNotice("");
    const previousGroupId = question.context_group_id;
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, structure, stem: question.stem, options: question.options, answerKey: question.material_supported_key, explanation: question.explanation, course: question.course, topic: question.topic, scenario: structure === "scenario" ? (question.shared_context ?? "") : "", preserveStatus: mode === "save", publish: mode === "publish" }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not publish this edit."); return; }
    const updated = data.question ? { ...question, ...data.question } : question;
    setQuestion(updated); onSaved?.(updated);
    if (mode === "publish") setOpen(false); else setNotice("Changes saved without changing the question's live status.");
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
  async function deleteQuestion() {
    if (!question) return;
    if (!window.confirm("Permanently delete this question? Its attempts, learner reports, review flags, expert reviews, and scenario link will also be removed. This cannot be undone.")) return;
    setSaving(true); setError(""); setNotice("");
    const response = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: question.id, action: "delete" }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(data.error ?? "Could not permanently delete this question.");
      return;
    }
    setOpen(false);
    onReviewResolved?.();
    onSaved?.(question);
  }
  async function resolveReviewFlag(flagId: number) {
    if (!question) return;
    setSaving(true); setError("");
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, flagId, action: "resolve_review_flag" }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not resolve this review item."); return; }
    setReviewFlags((current) => current.filter((flag) => flag.id !== flagId));
    onReviewResolved?.();
  }
  async function resolveLearnerReview() {
    if (!learnerReview) return;
    setSaving(true); setError("");
    const response = await fetch("/api/admin/question-reports", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId: learnerReview.id, action: "dismiss" }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not resolve this learner review."); return; }
    onReviewResolved?.(); setOpen(false);
  }
  async function findScenarios() {
    if (!question) return;
    setSearchingScenarios(true); setError("");
    const params = new URLSearchParams({ search: scenarioSearch.trim() });
    params.set("structure", structure === "group" ? "group" : "scenario");
    if (question.course && question.course !== "general") params.set("course", question.course);
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
    const updated = { ...question, course: data.course ?? question.course, shared_context: data.sharedContext, context_group_id: data.contextGroupId }; setQuestion(updated); onSaved?.(updated); setScenarios([]); setScenarioSearch(""); setOpen(false); setScenarioEditorQuestionId(question.id); setScenarioEditorGroupId(data.contextGroupId);
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
  async function findStandaloneGroupCandidates() {
    if (!question) return;
    setSearchingQuestions(true); setError("");
    const params = new URLSearchParams({
      standaloneCandidates: "true",
      course: question.course,
      search: questionSearch.trim(),
      excludeQuestionId: String(question.id),
    });
    const response = await fetch(`/api/admin/scenarios?${params}`);
    const data = await response.json();
    setSearchingQuestions(false);
    if (!response.ok) { setError(data.error ?? "Could not search the question bank."); return; }
    setCandidateQuestions(data.questions ?? []);
    setSelectedCandidateIds([]);
  }
  function toggleCandidate(questionId: number) {
    setSelectedCandidateIds((current) => current.includes(questionId) ? current.filter((id) => id !== questionId) : [...current, questionId]);
  }
  async function createOrderedGroup() {
    if (!question || !selectedCandidateIds.length) return;
    setSaving(true); setError("");
    const response = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "group_ordered", questionIds: [question.id, ...selectedCandidateIds] }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) { setError(data.error ?? "Could not create this question group."); return; }
    const updated = { ...question, context_group_id: data.contextGroupId, shared_context: null, context_position: 1 };
    setQuestion(updated); onSaved?.(updated); setOpen(false);
    setScenarioEditorQuestionId(question.id); setScenarioEditorGroupId(data.contextGroupId);
  }

  if (!isAdmin) return null;
  const topics = question?.course && question.course in COURSE_TOPICS ? COURSE_TOPICS[question.course as keyof typeof COURSE_TOPICS].topics : [];
  return <>
    <button className={`${triggerChildren ? "admin-question-row-editor-trigger" : "admin-quick-edit-button"} ${triggerLabel ? "labeled" : ""} ${triggerClassName ?? ""}`} type="button" aria-label="Edit this question" title="Edit this question" onClick={() => { void beginEdit(); }}>{triggerChildren ?? <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Zm9.5-13.5 4 4" /></svg>{triggerLabel && <span>{triggerLabel}</span>}</>}</button>
    {open && <><div className="modal-backdrop" aria-hidden="true" onClick={() => setOpen(false)} /><section className="panel admin-quick-editor" role="dialog" aria-modal="true" aria-label="Edit question">
      <button className="modal-close-button" type="button" aria-label="Close editor" onClick={() => setOpen(false)}>×</button>
      <p className="eyebrow">Admin edit · Question #{questionId}</p>
      {!question ? <p className={error ? "error" : "muted"}>{error || "Loading question…"}</p> : <>
        {learnerReview && <section className="admin-review-items"><div className="scenario-picker-heading"><div><strong>Learner-submitted review</strong><p className="muted">{learnerReview.category.replaceAll("_", " ")} · {learnerReview.reporter} · {learnerReview.status ?? "open"}</p></div>{learnerReview.status !== "resolved" && <button className="outline-button" type="button" disabled={saving} onClick={() => { void resolveLearnerReview(); }}>Resolve</button>}</div>{learnerReview.details && <p>{learnerReview.details}</p>}</section>}
        {reviewFlags.length > 0 && <section className="admin-review-items"><div className="scenario-picker-heading"><div><strong>Open review items</strong><p className="muted">Resolve each item after checking or correcting the question.</p></div><span className="eyebrow">{reviewFlags.length} open</span></div><div className="admin-review-item-list">{reviewFlags.map((flag) => <article key={flag.id}><div><p>{flag.note?.trim() || "Flagged for review without a comment."}</p><span className="muted">{flag.reviewer} · {new Date(flag.created_at).toLocaleString()}</span></div><button className="outline-button" type="button" disabled={saving} onClick={() => { void resolveReviewFlag(flag.id); }}>Resolve</button></article>)}</div></section>}
        <label>Question type</label><select value={structure} onChange={(event) => { const next = event.target.value as QuestionStructure; setStructure(next); setCandidateQuestions([]); setSelectedCandidateIds([]); setQuestionSearch(""); if (next !== "scenario") update({ shared_context: null }); }}><option value="standalone">Standalone</option><option value="scenario">Scenario</option><option value="group">Group</option></select>
        <label>Question wording</label><textarea value={question.stem} onChange={(event) => update({ stem: event.target.value })} />
        <SourceMaterialSearch questionId={question.id} initialQuery={question.stem} onUseAsScenario={(text) => update({ shared_context: text })} />
        <div className="admin-edit-grid"><div><label>Course</label><select value={question.course} onChange={(event) => update({ course: event.target.value, topic: "" })}><option value="" disabled>Choose a course</option>{COURSE_IDS.map((id) => <option key={id} value={id}>{COURSE_NAMES[id]}</option>)}</select></div><div><label>Topic</label><select value={question.topic ?? ""} onChange={(event) => update({ topic: event.target.value })}><option value="">No topic (offline only)</option>{topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}</select></div></div>
        <ModularOptionEditor options={question.options} onChange={(options) => update({ options })} answerKey={question.material_supported_key} onAnswerKeyChange={(material_supported_key) => update({ material_supported_key })} />
        <label>Correct answer</label><select value={question.material_supported_key ?? ""} onChange={(event) => update({ material_supported_key: event.target.value })}><option value="">No correct answer (offline only)</option>{question.options.map((option) => <option key={option.key} value={option.key}>{option.key} — {option.text}</option>)}</select>
        <label>Explanation</label><textarea value={question.explanation ?? ""} onChange={(event) => update({ explanation: event.target.value })} />
        {structure !== "standalone" && <div className="existing-scenario-picker">{showScenarioSearch ? <><div className="scenario-picker-heading"><label>Find an existing {structure === "group" ? "question group" : "case study"}</label><button className="text-button" type="button" onClick={() => setShowScenarioSearch(false)}>Close</button></div><p className="muted">Search {structure === "group" ? "ordered groups" : "case studies"} in {COURSE_NAMES[question.course as keyof typeof COURSE_NAMES] ?? "this course"}, then add this question to the matching set.</p><div className="scenario-search-row"><input value={scenarioSearch} onChange={(event) => setScenarioSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findScenarios(); } }} placeholder={structure === "group" ? "Search grouped question text…" : "Search scenario text…"} /><button type="button" disabled={searchingScenarios} onClick={() => { void findScenarios(); }}>{searchingScenarios ? "Searching…" : "Search"}</button></div>{scenarios.length > 0 && <div className="scenario-search-results">{scenarios.map((scenario) => <article key={scenario.context_group_id}><p>{scenario.shared_context || "Ordered question group"}</p><div><span className="muted">{scenario.question_count} linked question{scenario.question_count === 1 ? "" : "s"}</span><button type="button" disabled={saving} onClick={() => { void attachScenario(scenario); }}>Add to this {structure === "group" ? "group" : "case study"}</button></div></article>)}</div>}{!searchingScenarios && scenarios.length === 0 && scenarioSearch && <p className="muted scenario-empty">No matching sets found.</p>}</> : <button className="text-button" type="button" onClick={() => setShowScenarioSearch(true)}>Find an existing {structure === "group" ? "question group" : "case study"}</button>}</div>}
        {structure === "group" && !question.context_group_id && <div className="existing-scenario-picker"><div className="scenario-picker-heading"><div><label>Create a new ordered group</label><p className="muted">Search for standalone questions to place after this question.</p></div></div><div className="scenario-search-row"><input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findStandaloneGroupCandidates(); } }} placeholder="Search standalone question wording…" /><button type="button" disabled={searchingQuestions} onClick={() => { void findStandaloneGroupCandidates(); }}>{searchingQuestions ? "Searching…" : "Search questions"}</button></div>{candidateQuestions.length > 0 && <div className="scenario-search-results">{candidateQuestions.map((candidate) => <article key={candidate.id} className={selectedCandidateIds.includes(candidate.id) ? "selected" : ""}><label className="candidate-question-check"><input type="checkbox" checked={selectedCandidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} /><span>{candidate.stem}</span></label><div><span className="muted">{candidate.topic || "No topic"} · {candidate.verification_status === "material_supported" || candidate.verification_status === "staff_corrected" ? "Live" : "Not live"}</span><AdminQuestionQuickEdit questionId={candidate.id} triggerLabel="Review now" /></div></article>)}</div>}<div className="button-row"><button className="primary-button" type="button" disabled={saving || selectedCandidateIds.length === 0} onClick={() => { void createOrderedGroup(); }}>{saving ? "Creating group…" : `Create group with ${selectedCandidateIds.length} selected`}</button></div></div>}
        {structure === "scenario" && <><label>Create or edit case study <span className="muted">(required)</span></label><textarea value={question.shared_context ?? ""} onChange={(event) => update({ shared_context: event.target.value })} placeholder="Add the shared scenario for this question." /></>}
        {structure !== "standalone" && question.context_group_id && <div className="scenario-set-launch"><ScenarioSetEditor contextGroupId={question.context_group_id} onChanged={() => { void findCandidateQuestions(); }} /></div>}
        {structure !== "standalone" && question.context_group_id && <div className="existing-scenario-picker"><label>Questions linked to this {structure === "group" ? "group" : "case study"}</label><p className="muted">These questions always appear together in this fixed order.</p><button className="text-button" type="button" disabled={searchingQuestions} onClick={() => { void findCandidateQuestions(); }}>{linkedQuestions.length ? "Refresh linked questions" : "Show linked questions"}</button>{linkedQuestions.length > 0 && <div className="scenario-search-results linked-question-results">{linkedQuestions.map((linked) => <article key={linked.id}><p>{linked.stem}</p><div><span className="muted">{linked.topic || "No topic"} · {linked.verification_status === "material_supported" || linked.verification_status === "staff_corrected" ? "Live" : "Not live"}</span>{linked.id !== question.id && <AdminQuestionQuickEdit questionId={linked.id} triggerLabel="Review now" />}</div></article>)}</div>}<hr />{showQuestionSearch ? <><div className="scenario-picker-heading"><label>Find more questions for this set</label><button className="text-button" type="button" onClick={() => setShowQuestionSearch(false)}>Close</button></div><div className="scenario-search-row"><input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findCandidateQuestions(); } }} placeholder="Search question wording…" /><button type="button" disabled={searchingQuestions} onClick={() => { void findCandidateQuestions(); }}>{searchingQuestions ? "Searching…" : "Search questions"}</button></div>{candidateQuestions.length > 0 && <div className="scenario-search-results">{candidateQuestions.map((candidate) => <article key={candidate.id}><p>{candidate.stem}</p><div><span className="muted">{candidate.topic || "No topic"}</span><div className="scenario-result-actions"><AdminQuestionQuickEdit questionId={candidate.id} triggerLabel="Review now" /><button type="button" disabled={saving} onClick={() => { void attachCandidate(candidate); }}>Add to set</button></div></div></article>)}</div>}<QuestionCreator contextGroupId={question.context_group_id} fixedCourse={question.course} fixedStructure={structure === "group" ? "group" : "scenario"} label="Create and add to this set" onCreated={() => { void findCandidateQuestions(); }} /></> : <button className="text-button" type="button" onClick={() => setShowQuestionSearch(true)}>Find more questions for this set</button>}</div>}
        {error && <p className="error">{error}</p>}{notice && <p className="success-text">{notice}</p>}<div className="button-row"><button className="outline-button" type="button" disabled={saving} onClick={() => { void save("save"); }}>{saving ? "Saving…" : "Save"}</button><button className="primary-button" type="button" disabled={saving} onClick={() => { void save("publish"); }}>{saving ? "Publishing…" : "Publish changes"}</button></div>
        <div className="critical-admin-action"><p><strong>Critical issue?</strong> Remove this question from learner circulation immediately and leave a follow-up note.</p><textarea value={unpublishComment} onChange={(event) => setUnpublishComment(event.target.value)} placeholder="Describe what is wrong and what needs review…" /><button className="danger-button" type="button" disabled={saving || !unpublishComment.trim()} onClick={() => { void unpublish(); }}>Unpublish immediately</button></div>
        <div className="critical-admin-action"><p><strong>Delete permanently</strong></p><p className="muted">This removes the question and its associated attempts, reports, reviews, flags, and scenario link. It cannot be undone.</p><button className="danger-button" type="button" disabled={saving} onClick={() => { void deleteQuestion(); }}>Delete question permanently</button></div>
      </>}
    </section></>}
    {scenarioEditorGroupId && <ScenarioSetEditor contextGroupId={scenarioEditorGroupId} initialQuestionId={scenarioEditorQuestionId} openOnMount hideTrigger />}
  </>;
}
