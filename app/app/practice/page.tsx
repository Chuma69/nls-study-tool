"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cleanQuestionStem } from "@/lib/question-text";
import { QuestionReport } from "@/components/question-report";
import { StudyFooter } from "@/components/study-footer";
import { AdminQuestionQuickEdit } from "@/components/admin-question-quick-edit";
import { COURSE_IDS, COURSE_NAMES, COURSE_TOPICS } from "@/lib/course-topics";

type Question = {
  id: number;
  course: string | null;
  topic: string | null;
  exam_years: string[];
  stem: string;
  options: { key: string; text: string }[];
  verification_status: string;
  explanation: string | null;
  source_locator: string | null;
  display_name: string | null;
  rel_source_path: string | null;
  shared_context: string | null;
  context_group_id: string | null;
  context_position: number | null;
};
type Result = { matchesMaterialKey: boolean; materialSupportedKey: string; verificationStatus: string; firstAttempt: boolean };
type PracticeSession = { id: number; answers_count: number; total_seconds: number; last_question_id: number | null };
type QuestionView = {
  question: Question;
  scenarioQueue: Question[];
  chosenKey: string;
  result: Result | null;
  saved: boolean;
  note: string;
};

function yearsLabel(years: string[]) {
  return years.length ? `Exam year${years.length === 1 ? "" : "s"}: ${years.join(", ")}` : "Exam year: not identified in source";
}
function clock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

function PracticeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const course = searchParams.get("course");
  const courseTopics = course && course in COURSE_TOPICS ? COURSE_TOPICS[course as keyof typeof COURSE_TOPICS].topics : [];
  const selectedTopics = [...new Set([
    ...searchParams.getAll("topic"),
    ...(searchParams.get("topics") ?? "").split(","),
  ].map((topic) => topic.trim()).filter((topic) => Boolean(topic) && (!course || courseTopics.includes(topic))))];
  const topicSelectionKey = selectedTopics.join("\u001f");
  const requestedQuestion = Number(searchParams.get("question")) || 0;
  const [question, setQuestion] = useState<Question | null | undefined>(undefined);
  const [scenarioQueue, setScenarioQueue] = useState<Question[]>([]);
  const [chosenKey, setChosenKey] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [attemptedQuestions, setAttemptedQuestions] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [practiceSession, setPracticeSession] = useState<PracticeSession | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState<number | null>(null);
  const [currentQuestionSeconds, setCurrentQuestionSeconds] = useState(0);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState("");
  const [showSaveNote, setShowSaveNote] = useState(false);
  const [showResultNote, setShowResultNote] = useState(false);
  const [topicDraft, setTopicDraft] = useState<string[]>(selectedTopics);
  const [showTopics, setShowTopics] = useState(false);
  const [previousQuestions, setPreviousQuestions] = useState<QuestionView[]>([]);
  const [nextQuestions, setNextQuestions] = useState<QuestionView[]>([]);

  const replaceQuestionInUrl = useCallback((questionId: number | null) => {
    const params = new URLSearchParams(window.location.search);
    if (questionId) params.set("question", String(questionId));
    else params.delete("question");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `/practice${query ? `?${query}` : ""}`);
  }, []);

  const loadQuestion = useCallback(async (sessionId: number, excludeQuestionId?: number, questionId?: number) => {
    setQuestion(undefined); setChosenKey(""); setResult(null); setError("");
    const params = new URLSearchParams();
    if (course) params.set("course", course);
    selectedTopics.forEach((topic) => params.append("topic", topic));
    params.set("session", String(sessionId));
    if (excludeQuestionId) params.set("exclude", String(excludeQuestionId));
    if (questionId) params.set("question", String(questionId));
    const response = await fetch(`/api/questions/next${params.size ? `?${params}` : ""}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load a question."); setQuestion(null); return; }
    const nextTotal = data.totalQuestions ?? 0;
    setTotalQuestions(nextTotal);
    setAttemptedQuestions(data.attemptedQuestions ?? 0);
    setQuestion(data.question);
    setScenarioQueue((data.questionGroup ?? []).slice(1));
    setSaved(false); setNote(""); setShowSaveNote(false); setShowResultNote(false);
    setQuestionStartedAt(data.question ? Date.now() : null);
    setCurrentQuestionSeconds(0);
    if (data.question) {
      replaceQuestionInUrl(data.question.id);
      void fetch(`/api/flags?questionId=${data.question.id}`).then((flagResponse) => flagResponse.ok ? flagResponse.json() : null).then((flag) => {
        if (flag) { setSaved(Boolean(flag.saved)); setNote(flag.note ?? ""); }
      });
    }
  }, [course, topicSelectionKey, replaceQuestionInUrl]);

  useEffect(() => setTopicDraft(selectedTopics), [course, topicSelectionKey]);

  useEffect(() => {
    if (!questionStartedAt || result) return;
    const interval = window.setInterval(() => setCurrentQuestionSeconds(Math.round((Date.now() - questionStartedAt) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [questionStartedAt, result]);

  useEffect(() => {
    let cancelled = false;
    if (!course || !selectedTopics.length) { setQuestion(null); setPracticeSession(null); return; }
    setQuestion(undefined); setAttemptedQuestions(0); setPracticeSession(null); setPreviousQuestions([]); setNextQuestions([]);
    void fetch("/api/practice-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course }) })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) { setError(data.error ?? "Could not start practice."); setQuestion(null); return; }
        const session = data.session as PracticeSession;
        setPracticeSession(session);
        void loadQuestion(session.id, undefined, requestedQuestion || undefined);
      }).catch(() => { if (!cancelled) { setError("Could not start practice."); setQuestion(null); } });
    return () => { cancelled = true; };
  }, [course, topicSelectionKey, loadQuestion]);

  async function saveFlag(nextSaved = saved, nextNote = note) {
    if (!question) return;
    const response = await fetch("/api/flags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, saved: nextSaved, note: nextNote }) });
    if (!response.ok) { const data = await response.json(); setError(data.error ?? "Could not save this question."); return; }
    setSaved(nextSaved);
  }

  const courseChoices = COURSE_IDS.map((id) => [id, id === "civil_litigation" ? "CIV" : id === "criminal_litigation" ? "CRIM" : id === "corporate_law_practice" ? "CORP" : id === "property_law_practice" ? "PROP" : "ETH", COURSE_NAMES[id]]);
  const courseTitle = course && course in COURSE_TOPICS ? COURSE_NAMES[course as keyof typeof COURSE_TOPICS] : "Practice";
  function toggleTopic(topic: string) { setTopicDraft((topics) => topics.includes(topic) ? topics.filter((item) => item !== topic) : [...topics, topic]); }
  function applyTopics() { if (!topicDraft.length) { setError("Choose at least one topic before starting practice."); return; } const params = new URLSearchParams(); if (course) params.set("course", course); topicDraft.forEach((topic) => params.append("topic", topic)); router.replace(`/practice?${params.toString()}`); setShowTopics(false); }

  async function checkAnswer() {
    if (!question || !chosenKey) return;
    const secondsSpent = questionStartedAt ? Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000)) : 0;
    const response = await fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, chosenKey, practiceSessionId: practiceSession?.id, secondsSpent }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not save your answer."); return; }
    setPracticeSession((session) => session ? { ...session, answers_count: session.answers_count + 1, total_seconds: session.total_seconds + secondsSpent, last_question_id: question.id } : session);
    if (data.firstAttempt) setAttemptedQuestions((count) => Math.min(count + 1, totalQuestions));
    setResult(data);
  }

  function currentView(): QuestionView | null {
    if (!question) return null;
    return { question, scenarioQueue, chosenKey, result, saved, note };
  }

  function restoreView(view: QuestionView) {
    setQuestion(view.question); setScenarioQueue(view.scenarioQueue); setChosenKey(view.chosenKey); setResult(view.result);
    setSaved(view.saved); setNote(view.note); setShowSaveNote(false); setShowResultNote(false); setError("");
    setQuestionStartedAt(view.result ? null : Date.now()); setCurrentQuestionSeconds(0);
    replaceQuestionInUrl(view.question.id);
  }

  function previousQuestion() {
    const current = currentView();
    const previous = previousQuestions.at(-1);
    if (!current || !previous) return;
    setPreviousQuestions((items) => items.slice(0, -1));
    setNextQuestions((items) => [current, ...items]);
    restoreView(previous);
  }

  function nextQuestion() {
    if (!practiceSession || !question) return;
    const current = currentView();
    if (!current) return;
    if (nextQuestions.length) {
      const [next, ...remaining] = nextQuestions;
      setPreviousQuestions((items) => [...items, current]);
      setNextQuestions(remaining);
      restoreView(next);
      return;
    }
    setPreviousQuestions((items) => [...items, current]);
    if (scenarioQueue.length) {
      const [next, ...remaining] = scenarioQueue;
      setScenarioQueue(remaining); setQuestion(next); setChosenKey(""); setResult(null); setError("");
      setSaved(false); setNote(""); setShowSaveNote(false); setShowResultNote(false);
      setQuestionStartedAt(Date.now()); setCurrentQuestionSeconds(0);
      replaceQuestionInUrl(next.id);
      return;
    }
    void loadQuestion(practiceSession.id, question.id);
  }

  return (
    <main className="narrow practice-run-shell">
      <Link className="back-link" href="/">← Back to home</Link>
      <div className="practice-header"><div><p className="eyebrow">MCQ practice</p><h1 className="course-practice-title">{course ? courseTitle : "Choose a course"}</h1></div><p className="meta">{course && selectedTopics.length ? <>Attempted {attemptedQuestions} / {totalQuestions}<br />Session {clock((practiceSession?.total_seconds ?? 0) + currentQuestionSeconds)}</> : "Choose topics to begin"}</p></div>
      {!course ? <section className="course-picker"><p className="lead">Choose a course before you begin. You&apos;ll only see questions with answers supported by the loaded materials.</p><div className="picker-grid">{courseChoices.map(([id, code, label]) => <Link key={id} href={`/practice?course=${id}`} className="card picker-card"><span className="course-code">{code}</span><h3>{label}</h3><span className="picker-arrow">→</span></Link>)}</div></section> : <section className="topic-filter panel"><div className="course-checklist-heading"><div><p className="eyebrow">Topics</p><p className="muted">{selectedTopics.length ? `${selectedTopics.length} selected` : "Choose at least one topic to begin"}</p></div><div className="topic-heading-actions"><button className="text-button" type="button" onClick={() => { setTopicDraft(courseTopics); setShowTopics(true); }}>Select all</button><button className={showTopics ? "text-button" : "primary-button"} type="button" onClick={() => setShowTopics((open) => !open)}>{showTopics ? "Close" : selectedTopics.length ? "Edit topics" : "Choose topics"}</button></div></div>{showTopics && <><div className="course-checklist">{courseTopics.map((topic) => <label className="course-check" key={topic}><input type="checkbox" checked={topicDraft.includes(topic)} onChange={() => toggleTopic(topic)} /><span>{topic}</span></label>)}</div><div className="button-row"><button className="primary-button" type="button" disabled={!topicDraft.length} onClick={applyTopics}>Start practice</button></div></>}</section>}
      {course && selectedTopics.length > 0 && (question === undefined ? <p>Choosing a question…</p> : error && !question ? <p role="alert">{error}</p> : !question ? <p>No live questions match this topic selection yet. Choose different topics or ask an administrator to assign questions to these topics.</p> : (
        <div className={`scenario-question-layout ${question.shared_context ? "has-case-study" : ""}`}>
          {question.shared_context && <aside className="case-study-side-panel" aria-label="Case study">
            <p className="case-study-label">Case study</p>
            <div className="case-study-side-copy">{question.shared_context}</div>
          </aside>}
          <section className="panel question-panel">
          <div className="question-admin-heading"><p className="question-meta">{question.topic ?? courseTitle} · {yearsLabel(question.exam_years)}</p><div className="question-heading-actions">{!result && <button className="text-button question-skip-button" type="button" onClick={nextQuestion}>Skip question →</button>}<AdminQuestionQuickEdit questionId={question.id} onSaved={(updated) => setQuestion((current) => current ? { ...current, course: updated.course, topic: updated.topic, stem: updated.stem, options: updated.options, explanation: updated.explanation, shared_context: updated.shared_context } : current)} /></div></div>
          <div className="practice-progress" aria-hidden="true"><span /></div>
          <p className="stem">{cleanQuestionStem(question.stem)}</p>
          <button type="button" className={`flag-button ${saved ? "saved" : ""}`} onClick={() => { if (!saved) void saveFlag(true); setShowSaveNote(true); }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3.5h12v17l-6-4-6 4v-17Z" /></svg>{saved ? "Saved for later" : "Save for later"}</button>
          {showSaveNote && <div className="save-note-box"><label htmlFor="save-for-later-note">Add a note <span>(optional)</span></label><textarea id="save-for-later-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should you remember when you return to this?" /><div className="button-row"><button className="outline-button" type="button" onClick={() => { void saveFlag(true, note); setShowSaveNote(false); }}>Save note</button><button className="text-button" type="button" onClick={() => setShowSaveNote(false)}>Skip</button></div></div>}
          <div className="options" role="radiogroup" aria-label="Answer options">
            {question.options.map((option) => <label key={option.key} className={`option ${chosenKey === option.key ? "selected" : ""} ${result ? "locked" : ""}`}>
              <input
                type="radio"
                name="answer"
                value={option.key}
                checked={chosenKey === option.key}
                disabled={Boolean(result)}
                onChange={() => setChosenKey(option.key)}
              />
              <strong>{option.key}</strong><span>{option.text}</span>
            </label>)}
          </div>
          <QuestionReport questionId={question.id} />
          {error && <p className="error" role="alert">{error}</p>}
          {result && (
            <div className={`result ${result.matchesMaterialKey ? "" : "incorrect"}`} role="status">
              <p><strong>{result.matchesMaterialKey ? "Correct." : `Not quite — answer is ${result.materialSupportedKey}: ${question.options.find((option) => option.key === result.materialSupportedKey)?.text ?? ""}`}</strong></p>
              <p>{question.explanation?.replace(/^(The materials (expressly )?(state|say) that|According to the materials,?\s*)/i, "") ?? "A fuller tutor explanation is being prepared for this verified answer."}</p>
              {showResultNote ? (
                <div className="note-box"><label htmlFor="question-note">Your note</label><textarea id="question-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a reminder for later revision…" /><div className="button-row"><button type="button" className="outline-button" onClick={() => { void saveFlag(true, note); }}>Save note</button><button type="button" className="text-button" onClick={() => setShowResultNote(false)}>Hide</button></div></div>
              ) : (
                <button type="button" className="text-button add-note-toggle" onClick={() => setShowResultNote(true)}>+ Add a note for later revision</button>
              )}
            </div>
          )}
          <div className="button-row practice-actions practice-action-bar">
            {previousQuestions.length > 0 && <button className="outline-button" type="button" onClick={previousQuestion}>← Previous question</button>}
            {!result
              ? <button className="primary-button" type="button" disabled={!chosenKey} onClick={() => { void checkAnswer(); }}>{chosenKey ? "Check answer" : "Choose an option above first"}</button>
              : <button className="primary-button" type="button" onClick={nextQuestion}>Next question</button>}
          </div>
          </section>
        </div>
      ))}
      <StudyFooter />
    </main>
  );
}

export default function PracticePage() {
  return <Suspense fallback={<main className="narrow"><p>Preparing practice…</p></main>}><PracticeContent /></Suspense>;
}
