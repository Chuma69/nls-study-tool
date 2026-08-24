"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cleanQuestionStem } from "@/lib/question-text";
import { QuestionReport } from "@/components/question-report";
import { StudyFooter } from "@/components/study-footer";
import { AdminQuestionQuickEdit } from "@/components/admin-question-quick-edit";
import { COURSE_IDS, COURSE_NAMES, COURSE_TOPICS, type CourseId } from "@/lib/course-topics";

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

const DEFAULT_RUN_SIZE = 20;
const MAX_RUN_SIZE = 100;
function clampRunSize(value: number) { return Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), MAX_RUN_SIZE) : DEFAULT_RUN_SIZE; }
// The default run size is 20 questions for each selected course, capped at the max.
function defaultRunSizeForCourses(courseCount: number) { return courseCount > 0 ? Math.min(MAX_RUN_SIZE, courseCount * DEFAULT_RUN_SIZE) : DEFAULT_RUN_SIZE; }

function PracticeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedCourses = [...new Set(searchParams.getAll("course").filter((id) => id in COURSE_TOPICS))] as CourseId[];
  const runSize = searchParams.get("count") ? clampRunSize(Number(searchParams.get("count"))) : DEFAULT_RUN_SIZE;
  // Topic names are unique across courses, so the union is unambiguous for filtering.
  const courseTopics = [...new Set(selectedCourses.flatMap((id) => COURSE_TOPICS[id].topics))];
  const selectedTopics = [...new Set([
    ...searchParams.getAll("topic"),
    ...(searchParams.get("topics") ?? "").split(","),
  ].map((topic) => topic.trim()).filter((topic) => Boolean(topic) && (!selectedCourses.length || courseTopics.includes(topic))))];
  const topicSelectionKey = selectedTopics.join("\u001f");
  const courseSelectionKey = selectedCourses.slice().sort().join("|");
  const runActive = selectedCourses.length > 0 && selectedTopics.length > 0;
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
  const [courseDraft, setCourseDraft] = useState<CourseId[]>(selectedCourses);
  const [expandedCourses, setExpandedCourses] = useState<CourseId[]>([]);
  const [showAddCourses, setShowAddCourses] = useState(false);
  const [topicDraft, setTopicDraft] = useState<string[]>(selectedTopics);
  const [showTopics, setShowTopics] = useState(false);
  const courseDraftTopics = [...new Set(courseDraft.flatMap((id) => COURSE_TOPICS[id].topics))];
  const [previousQuestions, setPreviousQuestions] = useState<QuestionView[]>([]);
  const [nextQuestions, setNextQuestions] = useState<QuestionView[]>([]);
  const [countDraft, setCountDraft] = useState(runSize);
  const [countEdited, setCountEdited] = useState(false);
  const [answeredInRun, setAnsweredInRun] = useState(0);
  const [runCorrect, setRunCorrect] = useState(0);
  const [runComplete, setRunComplete] = useState(false);
  // Every question shown this run — excluded from further loads so a run never repeats itself.
  const runSeenIdsRef = useRef<Set<number>>(new Set());
  // Distinct questions answered this run — drives the "X of N" progress and the completion gate.
  const runAnsweredIdsRef = useRef<Set<number>>(new Set());

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
    selectedCourses.forEach((id) => params.append("course", id));
    selectedTopics.forEach((topic) => params.append("topic", topic));
    params.set("session", String(sessionId));
    if (excludeQuestionId) params.set("exclude", String(excludeQuestionId));
    if (questionId) params.set("question", String(questionId));
    const seenIds = [...runSeenIdsRef.current];
    if (seenIds.length) params.set("seen", seenIds.join(","));
    const response = await fetch(`/api/questions/next${params.size ? `?${params}` : ""}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load a question."); setQuestion(null); return; }
    const nextTotal = data.totalQuestions ?? 0;
    setTotalQuestions(nextTotal);
    setAttemptedQuestions(data.attemptedQuestions ?? 0);
    const questionGroup = (data.questionGroup ?? []) as Question[];
    questionGroup.forEach((item) => runSeenIdsRef.current.add(Number(item.id)));
    if (data.question) runSeenIdsRef.current.add(Number(data.question.id));
    // The eligible pool drained mid-run before the target count — treat that as a finished run.
    if (!data.question && runAnsweredIdsRef.current.size > 0) setRunComplete(true);
    setQuestion(data.question);
    setScenarioQueue(questionGroup.slice(1));
    setSaved(false); setNote(""); setShowSaveNote(false); setShowResultNote(false);
    setQuestionStartedAt(data.question ? Date.now() : null);
    setCurrentQuestionSeconds(0);
    if (data.question) {
      replaceQuestionInUrl(data.question.id);
      void fetch(`/api/flags?questionId=${data.question.id}`).then((flagResponse) => flagResponse.ok ? flagResponse.json() : null).then((flag) => {
        if (flag) { setSaved(Boolean(flag.saved)); setNote(flag.note ?? ""); }
      });
    }
  }, [courseSelectionKey, topicSelectionKey, replaceQuestionInUrl]);

  useEffect(() => setTopicDraft(selectedTopics), [courseSelectionKey, topicSelectionKey]);
  // Arriving with course(s) in the URL (e.g. from a home-page course card) opens straight into
  // the topic-selection view with those courses expanded.
  useEffect(() => { setCourseDraft(selectedCourses); setExpandedCourses(selectedCourses); setShowAddCourses(false); }, [courseSelectionKey]);
  useEffect(() => setCountDraft(runSize), [runSize]);

  useEffect(() => {
    if (!questionStartedAt || result) return;
    const interval = window.setInterval(() => setCurrentQuestionSeconds(Math.round((Date.now() - questionStartedAt) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [questionStartedAt, result]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCourses.length || !selectedTopics.length) { setQuestion(null); setPracticeSession(null); return; }
    setQuestion(undefined); setAttemptedQuestions(0); setPracticeSession(null); setPreviousQuestions([]); setNextQuestions([]);
    runSeenIdsRef.current = new Set(); runAnsweredIdsRef.current = new Set();
    setAnsweredInRun(0); setRunCorrect(0); setRunComplete(false);
    void fetch("/api/practice-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courses: selectedCourses }) })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) { setError(data.error ?? "Could not start practice."); setQuestion(null); return; }
        const session = data.session as PracticeSession;
        setPracticeSession(session);
        void loadQuestion(session.id, undefined, requestedQuestion || undefined);
      }).catch(() => { if (!cancelled) { setError("Could not start practice."); setQuestion(null); } });
    return () => { cancelled = true; };
  }, [courseSelectionKey, topicSelectionKey, runSize, loadQuestion]);

  async function saveFlag(nextSaved = saved, nextNote = note) {
    if (!question) return;
    const response = await fetch("/api/flags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, saved: nextSaved, note: nextNote }) });
    if (!response.ok) { const data = await response.json(); setError(data.error ?? "Could not save this question."); return; }
    setSaved(nextSaved);
  }

  // Track the live session id in a ref so we can end it on any exit without re-subscribing effects.
  const sessionIdRef = useRef<number | null>(null);
  useEffect(() => { sessionIdRef.current = practiceSession?.id ?? null; }, [practiceSession]);
  const beaconEndSession = useCallback(() => {
    const id = sessionIdRef.current;
    if (!id) return;
    sessionIdRef.current = null;
    try {
      const blob = new Blob([JSON.stringify({ action: "end", sessionId: id })], { type: "application/json" });
      navigator.sendBeacon("/api/practice-sessions", blob);
    } catch { /* best effort — the session simply stays resumable */ }
  }, []);
  // Record the session when the practice screen is left by any route: a full-page unload
  // (pagehide) or a client navigation that unmounts this component (top nav, browser back).
  useEffect(() => {
    window.addEventListener("pagehide", beaconEndSession);
    return () => { window.removeEventListener("pagehide", beaconEndSession); beaconEndSession(); };
  }, [beaconEndSession]);
  // "Back to home" ends the session, then leaves practice.
  const leavePractice = useCallback(async (destination: string) => {
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    if (id) {
      try { await fetch("/api/practice-sessions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: id }), keepalive: true }); } catch { /* fall through to navigation */ }
    }
    router.push(destination);
  }, [router]);

  const courseTitle = selectedCourses.length === 0 ? "Practice" : selectedCourses.length === 1 ? COURSE_NAMES[selectedCourses[0]] : `${selectedCourses.length} courses`;
  function toggleTopic(topic: string) { setTopicDraft((topics) => topics.includes(topic) ? topics.filter((item) => item !== topic) : [...topics, topic]); }
  function toggleCourse(courseId: CourseId) {
    const wasSelected = courseDraft.includes(courseId);
    // Selecting a course auto-expands it so its topics are ready to pick; deselecting collapses it.
    setExpandedCourses((prev) => wasSelected ? prev.filter((id) => id !== courseId) : [...new Set([...prev, courseId])]);
    setCourseDraft((prev) => {
      const next = prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId];
      const allowed = new Set(next.flatMap((id) => COURSE_TOPICS[id].topics));
      setTopicDraft((topics) => topics.filter((topic) => allowed.has(topic)));
      if (!countEdited) setCountDraft(defaultRunSizeForCourses(next.length));
      return next;
    });
  }
  function toggleExpanded(courseId: CourseId) {
    setExpandedCourses((prev) => prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId]);
  }
  function applyStart() {
    if (!courseDraft.length) { setError("Choose at least one course before starting practice."); return; }
    if (!topicDraft.length) { setError("Choose at least one topic before starting practice."); return; }
    const params = new URLSearchParams();
    courseDraft.forEach((id) => params.append("course", id));
    topicDraft.forEach((topic) => params.append("topic", topic));
    params.set("count", String(clampRunSize(countDraft)));
    router.replace(`/practice?${params.toString()}`);
    setShowTopics(false);
  }
  function startNewRun() {
    if (!practiceSession) return;
    runSeenIdsRef.current = new Set(); runAnsweredIdsRef.current = new Set();
    setAnsweredInRun(0); setRunCorrect(0); setRunComplete(false);
    setPreviousQuestions([]); setNextQuestions([]);
    void loadQuestion(practiceSession.id);
  }

  async function checkAnswer() {
    if (!question || !chosenKey) return;
    const secondsSpent = questionStartedAt ? Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000)) : 0;
    const response = await fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, chosenKey, practiceSessionId: practiceSession?.id, secondsSpent }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not save your answer."); return; }
    setPracticeSession((session) => session ? { ...session, answers_count: session.answers_count + 1, total_seconds: session.total_seconds + secondsSpent, last_question_id: question.id } : session);
    if (data.firstAttempt) setAttemptedQuestions((count) => Math.min(count + 1, totalQuestions));
    if (!runAnsweredIdsRef.current.has(question.id)) {
      runAnsweredIdsRef.current.add(question.id);
      setAnsweredInRun(runAnsweredIdsRef.current.size);
      if (data.matchesMaterialKey) setRunCorrect((value) => value + 1);
    }
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
    if (answeredInRun >= runSize) { setRunComplete(true); replaceQuestionInUrl(null); return; }
    void loadQuestion(practiceSession.id, question.id);
  }

  return (
    <main className="narrow practice-run-shell">
      <a className="back-link" href="/" onClick={(event) => { event.preventDefault(); void leavePractice("/"); }}>← Back to home</a>
      <div className="practice-header"><div><p className="eyebrow">MCQ practice</p><h1 className="course-practice-title">{!runActive || showTopics ? "Set up your Practice" : courseTitle}</h1></div><div className="practice-header-meta"><p className="meta">{runActive ? <>{runComplete ? `Run complete · ${runCorrect}/${answeredInRun} correct` : `Question ${Math.min(answeredInRun + 1, runSize)} of ${runSize}`}<br />Session {clock((practiceSession?.total_seconds ?? 0) + currentQuestionSeconds)}</> : "Choose courses to begin"}</p>{runActive && practiceSession && <button type="button" className="outline-button end-session-button" onClick={() => { void leavePractice("/"); }}>End session</button>}</div></div>
      <section className={`topic-filter panel${runActive && !showTopics ? " topic-filter-compact" : ""}`}><div className="course-checklist-heading"><div className="topic-filter-label"><p className="eyebrow">Setup</p><p className="muted">{runActive ? `${selectedCourses.length} course${selectedCourses.length === 1 ? "" : "s"} · ${selectedTopics.length} topic${selectedTopics.length === 1 ? "" : "s"} · ${runSize} questions per run${totalQuestions ? ` · ${attemptedQuestions} of ${totalQuestions} attempted` : ""}` : "Choose courses and topics to begin"}</p></div>{runActive && <div className="topic-heading-actions"><button className={showTopics ? "text-button" : "outline-button"} type="button" onClick={() => setShowTopics((open) => !open)}>{showTopics ? "Close" : "Edit setup"}</button></div>}</div>{(showTopics || !runActive) && <><div className="run-size-picker"><p className="eyebrow">Number of Questions</p><div className="number-stepper"><button type="button" aria-label="Reduce question count" onClick={() => { setCountEdited(true); setCountDraft((value) => Math.max(1, Math.min(MAX_RUN_SIZE, value - 1))); }}>−</button><input aria-label="Number of questions" type="number" min={1} max={MAX_RUN_SIZE} value={countDraft || ""} onChange={(event) => { setCountEdited(true); setCountDraft(Math.max(0, Math.min(MAX_RUN_SIZE, Math.floor(Number(event.target.value)) || 0))); }} /><span>questions</span><button type="button" aria-label="Increase question count" onClick={() => { setCountEdited(true); setCountDraft((value) => Math.max(1, Math.min(MAX_RUN_SIZE, value + 1))); }}>+</button></div><p className="hint">The default is 20 questions per course per run.</p></div>{courseDraft.length === 0 ? <><div className="topic-checklist-heading"><p className="eyebrow topic-checklist-label">Courses</p><div className="topic-checklist-actions"><button type="button" className="text-button" onClick={() => { setCourseDraft(COURSE_IDS); setExpandedCourses([]); if (!countEdited) setCountDraft(defaultRunSizeForCourses(COURSE_IDS.length)); }}>Select all</button></div></div><div className="course-checklist course-checklist-grid">{COURSE_IDS.map((id) => <label className="course-check" key={id}><input type="checkbox" checked={false} onChange={() => toggleCourse(id)} /><span>{COURSE_NAMES[id]}</span></label>)}</div></> : <><div className="topic-checklist-heading"><p className="eyebrow topic-checklist-label">Topics</p><div className="topic-checklist-actions">{courseDraft.length === COURSE_IDS.length && <button type="button" className="text-button" onClick={() => setTopicDraft(courseDraftTopics)}>Select all topics</button>}<button type="button" className="text-button" onClick={() => { setCourseDraft([]); setTopicDraft([]); setExpandedCourses([]); setShowAddCourses(false); if (!countEdited) setCountDraft(DEFAULT_RUN_SIZE); }}>Clear</button></div></div><div className="course-accordion-stack">{COURSE_IDS.filter((id) => courseDraft.includes(id)).map((id) => { const expanded = expandedCourses.includes(id); const topics = COURSE_TOPICS[id].topics; return <div className={`course-accordion selected${expanded ? " expanded" : ""}`} key={id}><div className="course-accordion-header"><button type="button" className="course-accordion-title" aria-label={expanded ? "Collapse topics" : "Expand topics"} onClick={() => toggleExpanded(id)}><span className="course-accordion-chevron">{expanded ? "▾" : "▸"}</span>{COURSE_NAMES[id]}</button><button type="button" className="course-accordion-remove" onClick={() => toggleCourse(id)}>Remove</button></div>{expanded && <div className="course-accordion-body"><div className="topic-checklist-heading"><p className="eyebrow topic-checklist-label course-group-label">Topics</p><div className="topic-checklist-actions"><button type="button" className="text-button" onClick={() => setTopicDraft((prev) => [...new Set([...prev, ...topics])])}>Select all</button><button type="button" className="text-button" onClick={() => setTopicDraft((prev) => prev.filter((topic) => !topics.includes(topic)))}>Clear</button></div></div><div className="course-accordion-topics">{topics.map((topic) => <label className="course-check" key={topic}><input type="checkbox" checked={topicDraft.includes(topic)} onChange={() => toggleTopic(topic)} /><span>{topic}</span></label>)}</div></div>}</div>; })}</div>{courseDraft.length < COURSE_IDS.length && (showAddCourses ? <div className="add-courses-panel"><div className="topic-checklist-heading"><p className="eyebrow topic-checklist-label">Add courses</p><div className="topic-checklist-actions"><button type="button" className="text-button" onClick={() => setShowAddCourses(false)}>Done</button></div></div><div className="course-checklist course-checklist-grid">{COURSE_IDS.filter((id) => !courseDraft.includes(id)).map((id) => <label className="course-check" key={id}><input type="checkbox" checked={false} onChange={() => toggleCourse(id)} /><span>{COURSE_NAMES[id]}</span></label>)}</div></div> : <button type="button" className="text-button add-courses-toggle" onClick={() => setShowAddCourses(true)}>+ Add other courses</button>)}</>}<div className="button-row"><button className="primary-button" type="button" disabled={!courseDraft.length || !topicDraft.length} onClick={applyStart}>Start practice</button></div></>}</section>
      {runActive && !showTopics && (runComplete ? (
        <section className="panel run-complete-panel">
          <p className="eyebrow">Run complete</p>
          <h2>You answered {answeredInRun} question{answeredInRun === 1 ? "" : "s"}</h2>
          <p className="lead">{runCorrect} correct · {answeredInRun - runCorrect} to review</p>
          <div className="button-row"><button className="primary-button" type="button" onClick={startNewRun}>Start a new run</button><button className="outline-button" type="button" onClick={() => { void leavePractice("/"); }}>Back to home</button></div>
        </section>
      ) : question === undefined ? <p>Choosing a question…</p> : error && !question ? <p role="alert">{error}</p> : !question ? <p>No live questions match this topic selection yet. Choose different topics or ask an administrator to assign questions to these topics.</p> : (
        <div className={`scenario-question-layout ${question.shared_context ? "has-case-study" : ""}`}>
          {question.shared_context && <aside className="case-study-side-panel" aria-label="Case study">
            <p className="case-study-label">Case study</p>
            <div className="case-study-side-copy">{question.shared_context}</div>
          </aside>}
          <section className="panel question-panel">
          <div className="question-admin-heading"><p className="question-meta">{question.topic ?? courseTitle} · {yearsLabel(question.exam_years)}</p><div className="question-heading-actions">{!result && <button className="text-button question-skip-button" type="button" onClick={nextQuestion}>Skip question →</button>}<AdminQuestionQuickEdit questionId={question.id} onSaved={(updated) => setQuestion((current) => current ? { ...current, course: updated.course, topic: updated.topic, stem: updated.stem, options: updated.options, explanation: updated.explanation, shared_context: updated.shared_context } : current)} /></div></div>
          <div className="practice-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((answeredInRun / runSize) * 100))}%` }} /></div>
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
          {!result ? <div className="button-row practice-actions">{previousQuestions.length > 0 && <button className="outline-button" type="button" onClick={previousQuestion}>← Previous question</button>}<button className="primary-button" type="button" disabled={!chosenKey} onClick={() => { void checkAnswer(); }}>
            {chosenKey ? "Check answer" : "Choose an option above first"}
          </button></div> : (
            <div className={`result ${result.matchesMaterialKey ? "" : "incorrect"}`} role="status">
              <p><strong>{result.matchesMaterialKey ? "Correct." : `Not quite — answer is ${result.materialSupportedKey}: ${question.options.find((option) => option.key === result.materialSupportedKey)?.text ?? ""}`}</strong></p>
              <p>{question.explanation?.replace(/^(The materials (expressly )?(state|say) that|According to the materials,?\s*)/i, "") ?? "A fuller tutor explanation is being prepared for this verified answer."}</p>
              {showResultNote ? (
                <div className="note-box"><label htmlFor="question-note">Your note</label><textarea id="question-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a reminder for later revision…" /><div className="button-row"><button type="button" className="outline-button" onClick={() => { void saveFlag(true, note); }}>Save note</button><button type="button" className="text-button" onClick={() => setShowResultNote(false)}>Hide</button></div></div>
              ) : (
                <button type="button" className="text-button add-note-toggle" onClick={() => setShowResultNote(true)}>+ Add a note for later revision</button>
              )}
              <div className="button-row practice-actions">{previousQuestions.length > 0 && <button className="outline-button" type="button" onClick={previousQuestion}>← Previous question</button>}<button className="primary-button" type="button" onClick={nextQuestion}>Next question</button></div>
            </div>
          )}
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
