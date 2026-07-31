"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { COURSE_NAMES, COURSE_TOPICS } from "@/lib/course-topics";
import { QuestionCreator } from "@/components/question-creator";
import { ModularOptionEditor } from "@/components/modular-option-editor";

type Option = { key: string; text: string };
type ScenarioQuestion = { id: number; course: string; topic: string | null; stem: string; options: Option[]; material_supported_key: string | null; explanation: string | null; verification_status: string; context_position: number | null; shared_context: string | null };
type CandidateQuestion = { id: number; stem: string; topic: string | null; verification_status: string; context_group_id: string | null };

export function ScenarioSetEditor({ contextGroupId, onChanged, triggerClassName, triggerChildren, openOnMount = false, initialQuestionId, hideTrigger = false }: { contextGroupId: string; onChanged?: () => void; triggerClassName?: string; triggerChildren?: ReactNode; openOnMount?: boolean; initialQuestionId?: number; hideTrigger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<ScenarioQuestion[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [scenario, setScenario] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [addMode, setAddMode] = useState<"new" | "existing" | null>(null);
  const [questionSearch, setQuestionSearch] = useState("");
  const [candidateQuestions, setCandidateQuestions] = useState<CandidateQuestion[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [searchingQuestions, setSearchingQuestions] = useState(false);
  const active = questions.find((question) => question.id === activeId) ?? null;

  useEffect(() => { if (openOnMount) void load(initialQuestionId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  function setQuestionLive(questionId: number, live: boolean) {
    setQuestions((current) => current.map((question) => question.id === questionId
      ? { ...question, verification_status: live ? "staff_corrected" : "unreviewed" }
      : question));
  }
  async function findQuestions() {
    setSearchingQuestions(true); setError("");
    const response = await fetch(`/api/admin/scenarios?${new URLSearchParams({ contextGroupId, search: questionSearch.trim() })}`);
    const data = await response.json(); setSearchingQuestions(false);
    if (!response.ok) { setError(data.error ?? "Could not search the question bank."); return; }
    setCandidateQuestions(data.questions ?? []);
    setSelectedCandidateIds([]);
  }
  function toggleCandidate(questionId: number) {
    setSelectedCandidateIds((current) => current.includes(questionId)
      ? current.filter((id) => id !== questionId)
      : [...current, questionId]);
  }
  async function attachQuestions(questionIds: number[]) {
    if (!questionIds.length) return;
    setSaving(true); setError("");
    const orderedQuestionIds = candidateQuestions
      .filter((candidate) => questionIds.includes(candidate.id))
      .map((candidate) => candidate.id);
    const addedIds: number[] = [];
    for (const questionId of orderedQuestionIds) {
      const response = await fetch("/api/admin/scenarios", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId, contextGroupId }) });
      const data = await response.json();
      if (!response.ok) {
        const message = `${addedIds.length} question${addedIds.length === 1 ? " was" : "s were"} added before an error occurred: ${data.error ?? "Could not add a selected question to the case study."}`;
        setSaving(false);
        setCandidateQuestions((current) => current.filter((candidate) => !addedIds.includes(candidate.id)));
        setSelectedCandidateIds((current) => current.filter((id) => !addedIds.includes(id)));
        if (addedIds.length) await load(addedIds[addedIds.length - 1]);
        setError(message);
        onChanged?.();
        return;
      }
      addedIds.push(questionId);
    }
    setSaving(false);
    setCandidateQuestions((current) => current.filter((candidate) => !addedIds.includes(candidate.id)));
    setSelectedCandidateIds([]);
    setShowAddQuestion(false); setAddMode(null); setQuestionSearch("");
    await load(addedIds[addedIds.length - 1]); onChanged?.();
  }
  async function detachActiveQuestion() {
    if (!active) return;
    if (questions.length < 2) { setError("A case study must retain at least one linked question. Delete the case study or attach another question first."); return; }
    if (!window.confirm("Remove this question from the case study? It will remain in the question bank as a standalone question.")) return;
    setSaving(true); setError("");
    const response = await fetch("/api/admin/scenarios", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "detach", questionId: active.id, contextGroupId }) });
    const data = await response.json();
    if (!response.ok) { setSaving(false); setError(data.error ?? "Could not remove this question from the case study."); return; }
    const remaining = questions.filter((question) => question.id !== active.id);
    setQuestions(remaining);
    setActiveId(remaining[0]?.id ?? null);
    setSaving(false);
    onChanged?.();
  }
  async function deleteActiveQuestion() {
    if (!active) return;
    const activeIndex = questions.findIndex((question) => question.id === active.id);
    const deletingLastQuestion = questions.length === 1;
    const confirmed = window.confirm(deletingLastQuestion
      ? "Permanently delete this question? It is the last question in the scenario, so the scenario set will also disappear."
      : "Permanently delete this question from the database and remove it from this scenario set? This cannot be undone.");
    if (!confirmed) return;

    setSaving(true); setError("");
    const response = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: active.id, action: "delete" }),
    });
    const data = await response.json();
    if (!response.ok) {
      setSaving(false);
      setError(data.error ?? "Could not permanently delete this question.");
      return;
    }

    const remaining = questions.filter((question) => question.id !== active.id);
    if (!remaining.length) {
      setSaving(false);
      setQuestions([]);
      setActiveId(null);
      setOpen(false);
      onChanged?.();
      return;
    }

    const orderResponse = await fetch("/api/admin/scenarios", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reorder",
        contextGroupId,
        questionIds: remaining.map((question) => question.id),
        sharedContext: scenario,
      }),
    });
    const orderData = await orderResponse.json();
    setSaving(false);
    if (!orderResponse.ok) {
      setError(orderData.error ?? "The question was deleted, but the remaining scenario order could not be updated.");
      await load();
      onChanged?.();
      return;
    }

    const normalized = remaining.map((question, index) => ({
      ...question,
      shared_context: scenario,
      context_position: index + 1,
    }));
    setQuestions(normalized);
    setActiveId(normalized[Math.min(activeIndex, normalized.length - 1)].id);
    onChanged?.();
  }
  async function save(action: "save" | "publish" | "unpublish") {
    if (!active) return;
    setSaving(true); setError("");
    for (const question of questions) {
      const isCurrentlyLive = question.verification_status === "material_supported" || question.verification_status === "staff_corrected";
      const publish = question.id === active.id && action === "publish"
        ? true
        : question.id === active.id && action === "unpublish"
          ? false
          : isCurrentlyLive;
      const questionResponse = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, stem: question.stem, options: question.options, answerKey: question.material_supported_key, explanation: question.explanation, course: question.course, topic: question.topic, publish }) });
      const questionData = await questionResponse.json();
      if (!questionResponse.ok) { setSaving(false); setError(`Question ${question.id}: ${questionData.error ?? "Could not publish this question."}`); return; }
    }
    const orderResponse = await fetch("/api/admin/scenarios", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reorder", contextGroupId, questionIds: questions.map((question) => question.id), sharedContext: scenario }) });
    const orderData = await orderResponse.json(); setSaving(false);
    if (!orderResponse.ok) { setError(orderData.error ?? "The question was saved, but the scenario order could not be updated."); return; }
    setQuestions((current) => current.map((question, index) => ({ ...question, shared_context: scenario, context_position: index + 1, verification_status: question.id === active.id && action === "publish" ? "staff_corrected" : question.id === active.id && action === "unpublish" ? "unreviewed" : question.verification_status })));
    onChanged?.();
    if (action === "publish") setOpen(false);
  }

  const topics = active?.course && active.course in COURSE_TOPICS ? COURSE_TOPICS[active.course as keyof typeof COURSE_TOPICS].topics : [];
  const editor = open && typeof document !== "undefined" ? createPortal(<><div className="modal-backdrop scenario-set-backdrop" aria-hidden="true" /><section className="panel scenario-set-editor" role="dialog" aria-modal="true" aria-label="Edit full scenario set">
      <button className="modal-close-button" type="button" aria-label="Close scenario editor" onClick={() => setOpen(false)}>×</button>
      <p className="eyebrow">Full scenario set</p>
      {loading ? <p className="muted">Loading linked questions…</p> : error && !questions.length ? <p className="error">{error}</p> : <>
        <label>Edit the full case study or scenario</label><p className="muted">This shared text appears with every linked question. Save stores changes to the scenario, all questions, and their order.</p><textarea className="scenario-set-context" value={scenario} onChange={(event) => setScenario(event.target.value)} />
        <div className="scenario-set-workspace">
          <aside className="scenario-set-sidebar"><div><strong>{questions.length} linked questions</strong><span className="muted">Set each question live or offline, then arrange the learner order.</span><button className="primary-button" type="button" onClick={() => { setShowAddQuestion((current) => !current); setAddMode(null); setSelectedCandidateIds([]); }}>Add question to this set</button>{showAddQuestion && <div className="scenario-add-question"><div className="button-row"><button className="outline-button" type="button" onClick={() => setAddMode("new")}>New question</button><button className="outline-button" type="button" onClick={() => setAddMode("existing")}>Existing question</button></div>{addMode === "new" && <QuestionCreator contextGroupId={contextGroupId} fixedCourse={questions[0]?.course} label="Create new question" onCreated={(question) => { setShowAddQuestion(false); setAddMode(null); void load(question.id); }} />}{addMode === "existing" && <><div className="scenario-search-row"><input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findQuestions(); } }} placeholder="Search question wording…" /><button type="button" disabled={searchingQuestions} onClick={() => { void findQuestions(); }}>{searchingQuestions ? "Searching…" : "Search"}</button></div>{candidateQuestions.length > 0 && <><div className="scenario-result-actions"><button className="text-button" type="button" onClick={() => setSelectedCandidateIds(selectedCandidateIds.length === candidateQuestions.length ? [] : candidateQuestions.map((candidate) => candidate.id))}>{selectedCandidateIds.length === candidateQuestions.length ? "Clear selection" : "Select all"}</button><button className="primary-button" type="button" disabled={saving || !selectedCandidateIds.length} onClick={() => { void attachQuestions(selectedCandidateIds); }}>{saving ? "Adding…" : `Add selected (${selectedCandidateIds.length})`}</button></div><div className="scenario-search-results">{candidateQuestions.map((candidate) => <article key={candidate.id}><label className="scenario-candidate-select"><input type="checkbox" checked={selectedCandidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} /><span>{candidate.stem}</span></label><div><span className="muted">{candidate.topic || "No topic"} · {candidate.verification_status === "material_supported" || candidate.verification_status === "staff_corrected" ? "Live" : "Not live"}</span><button type="button" disabled={saving} onClick={() => { void attachQuestions([candidate.id]); }}>Add only this question</button></div></article>)}</div></>}</>}</div>}</div>{questions.map((question, index) => { const isLive = question.verification_status === "material_supported" || question.verification_status === "staff_corrected"; return <div className={`scenario-set-item ${question.id === activeId ? "active" : ""}`} key={question.id}><button type="button" className="scenario-set-select" onClick={() => setActiveId(question.id)}><span>{index + 1}</span><span>{question.stem}</span></button><div className="scenario-set-item-controls"><label className="scenario-question-live-toggle"><input type="checkbox" checked={isLive} onChange={(event) => setQuestionLive(question.id, event.target.checked)} /><span>Live</span></label><div className="scenario-order-actions"><button type="button" aria-label="Move question up" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label="Move question down" disabled={index === questions.length - 1} onClick={() => move(index, 1)}>↓</button></div></div></div>; })}</aside>
          {active && <div className="scenario-set-question-editor"><p className="eyebrow">Question {questions.findIndex((question) => question.id === active.id) + 1} · {active.verification_status === "material_supported" || active.verification_status === "staff_corrected" ? "Live" : "Not live"}</p><label>Question wording</label><textarea value={active.stem} onChange={(event) => updateActive({ stem: event.target.value })} /><div className="admin-edit-grid"><div><label>Course</label><input value={COURSE_NAMES[active.course as keyof typeof COURSE_NAMES] ?? active.course} disabled /></div><div><label>Topic</label><select value={active.topic ?? ""} onChange={(event) => updateActive({ topic: event.target.value })}><option value="" disabled>Choose a topic</option>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select></div></div><ModularOptionEditor options={active.options} onChange={(options) => updateActive({ options })} answerKey={active.material_supported_key} onAnswerKeyChange={(material_supported_key) => updateActive({ material_supported_key })} /><label>Correct answer</label><select value={active.material_supported_key ?? ""} onChange={(event) => updateActive({ material_supported_key: event.target.value })}><option value="" disabled>Choose the correct answer</option>{active.options.map((option) => <option key={option.key} value={option.key}>{option.key} — {option.text}</option>)}</select><label>Explanation</label><textarea value={active.explanation ?? ""} onChange={(event) => updateActive({ explanation: event.target.value })} /></div>}
        </div>
        {error && <p className="error">{error}</p>}<p className="muted scenario-publish-note">Save stores the full scenario set without forcing the selected question live. Publish and Unpublish change the selected question’s status. Remove from set returns the selected question to the standalone bank; delete removes it permanently.</p><div className="button-row"><button className="outline-button" type="button" disabled={saving || !active} onClick={() => { void save("save"); }}>{saving ? "Saving…" : "Save full scenario"}</button><button className="primary-button" type="button" disabled={saving || !active} onClick={() => { void save("publish"); }}>{saving ? "Saving…" : "Publish"}</button><button className="outline-button" type="button" disabled={saving || !active} onClick={() => { void save("unpublish"); }}>{saving ? "Saving…" : "Unpublish"}</button><button className="outline-button" type="button" disabled={saving || !active || questions.length < 2} onClick={() => { void detachActiveQuestion(); }}>Remove from set</button><button className="danger-button" type="button" disabled={saving || !active} onClick={() => { void deleteActiveQuestion(); }}>Delete question permanently</button></div>
      </>}
    </section></>, document.body) : null;
  return <>
    {!hideTrigger && <button className={triggerClassName ?? "outline-button"} type="button" onClick={() => { void load(initialQuestionId); }}>{triggerChildren ?? "Edit full scenario set"}</button>}
    {editor}
  </>;
}
