"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cleanQuestionStem } from "@/lib/question-text";
import { QuestionReport } from "@/components/question-report";

type Question = {
  id: number;
  course: string | null;
  exam_years: string[];
  stem: string;
  options: { key: string; text: string }[];
  verification_status: string;
  explanation: string | null;
  source_locator: string | null;
  display_name: string | null;
  rel_source_path: string | null;
};
type Result = { matchesMaterialKey: boolean; materialSupportedKey: string; verificationStatus: string };
type PracticeSession = { id: number; answers_count: number; total_seconds: number; last_question_id: number | null };

function yearsLabel(years: string[]) {
  return years.length ? `Exam year${years.length === 1 ? "" : "s"}: ${years.join(", ")}` : "Exam year: not identified in source";
}
function clock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

function PracticeContent() {
  const searchParams = useSearchParams();
  const course = searchParams.get("course");
  const requestedQuestion = Number(searchParams.get("question")) || 0;
  const [question, setQuestion] = useState<Question | null | undefined>(undefined);
  const [chosenKey, setChosenKey] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [questionNumber, setQuestionNumber] = useState(1);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [practiceSession, setPracticeSession] = useState<PracticeSession | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState<number | null>(null);
  const [currentQuestionSeconds, setCurrentQuestionSeconds] = useState(0);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState("");

  const loadQuestion = useCallback(async (sessionId: number, excludeQuestionId?: number, questionId?: number) => {
    setQuestion(undefined); setChosenKey(""); setResult(null); setError("");
    const params = new URLSearchParams();
    if (course) params.set("course", course);
    params.set("session", String(sessionId));
    if (excludeQuestionId) params.set("exclude", String(excludeQuestionId));
    if (questionId) params.set("question", String(questionId));
    const response = await fetch(`/api/questions/next${params.size ? `?${params}` : ""}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load a question."); setQuestion(null); return; }
    setTotalQuestions(data.totalQuestions ?? 0);
    setQuestionNumber((data.answeredCount ?? 0) + 1);
    setQuestion(data.question);
    setSaved(false); setNote("");
    setQuestionStartedAt(data.question ? Date.now() : null);
    setCurrentQuestionSeconds(0);
    if (data.question) {
      void fetch(`/api/flags?questionId=${data.question.id}`).then((flagResponse) => flagResponse.ok ? flagResponse.json() : null).then((flag) => {
        if (flag) { setSaved(Boolean(flag.saved)); setNote(flag.note ?? ""); }
      });
    }
  }, [course]);

  useEffect(() => {
    if (!questionStartedAt || result) return;
    const interval = window.setInterval(() => setCurrentQuestionSeconds(Math.round((Date.now() - questionStartedAt) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [questionStartedAt, result]);

  useEffect(() => {
    let cancelled = false;
    if (!course) { setQuestion(null); setPracticeSession(null); return; }
    setQuestion(undefined); setQuestionNumber(1); setPracticeSession(null);
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
  }, [course, loadQuestion, requestedQuestion]);

  async function saveFlag(nextSaved = saved, nextNote = note) {
    if (!question) return;
    const response = await fetch("/api/flags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, saved: nextSaved, note: nextNote }) });
    if (!response.ok) { const data = await response.json(); setError(data.error ?? "Could not save this question."); return; }
    setSaved(nextSaved);
  }

  const courseChoices = [
    ["civil_litigation", "CIV", "Civil Litigation"],
    ["criminal_litigation", "CRIM", "Criminal Litigation"],
    ["corporate_law_practice", "CORP", "Corporate Law Practice"],
    ["property_law_practice", "PROP", "Property Law Practice"],
    ["professional_ethics_skills", "ETH", "Professional Ethics & Skills"],
  ];
  const courseTitle = courseChoices.find(([id]) => id === course)?.[2] ?? "Practice";

  async function checkAnswer() {
    if (!question || !chosenKey) return;
    const secondsSpent = questionStartedAt ? Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000)) : 0;
    const response = await fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, chosenKey, practiceSessionId: practiceSession?.id, secondsSpent }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not save your answer."); return; }
    setPracticeSession((session) => session ? { ...session, answers_count: session.answers_count + 1, total_seconds: session.total_seconds + secondsSpent, last_question_id: question.id } : session);
    setResult(data);
  }

  return (
    <main className="narrow">
      <Link className="back-link" href="/">← Back to home</Link>
      <div className="practice-header"><div><p className="eyebrow">MCQ practice</p><h1 className="course-practice-title">{course ? courseTitle : "Choose a course"}</h1></div><p className="meta">{course ? <>Question {questionNumber} / {totalQuestions}<br />Session {clock((practiceSession?.total_seconds ?? 0) + currentQuestionSeconds)}</> : "Verified materials only"}</p></div>
      {!course ? <section className="course-picker"><p className="lead">Choose a course before you begin. You&apos;ll only see questions with answers supported by the loaded materials.</p><div className="picker-grid">{courseChoices.map(([id, code, label]) => <Link key={id} href={`/practice?course=${id}`} className="card picker-card"><span className="course-code">{code}</span><h3>{label}</h3><span className="picker-arrow">→</span></Link>)}</div></section> : question === undefined ? <p>Choosing a question…</p> : error && !question ? <p role="alert">{error}</p> : !question ? <p>Question verification is in progress for this course. We will only reopen practice when answers are supported by the loaded study materials, not by source answer sheets.</p> : (
        <section className="panel question-panel">
          <p className="question-meta">{question.course ?? "Course not identified"} · {yearsLabel(question.exam_years)}</p>
          <div className="practice-progress" aria-hidden="true"><span /></div>
          <p className="stem">{cleanQuestionStem(question.stem)}</p>
          <button type="button" className={`flag-button ${saved ? "saved" : ""}`} onClick={() => { void saveFlag(!saved); }}>{saved ? "★ Saved for later" : "☆ Flag for later"}</button>
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
          {!result ? <button className="primary-button" type="button" disabled={!chosenKey} onClick={() => { void checkAnswer(); }}>
            {chosenKey ? "Check answer" : "Choose an option above first"}
          </button> : (
            <div className={`result ${result.matchesMaterialKey ? "" : "incorrect"}`} role="status">
              <p><strong>{result.matchesMaterialKey ? "Correct." : `Not quite — answer is ${result.materialSupportedKey}: ${question.options.find((option) => option.key === result.materialSupportedKey)?.text ?? ""}`}</strong></p>
              <p>{question.explanation?.replace(/^(The materials (expressly )?(state|say) that|According to the materials,?\s*)/i, "") ?? "A fuller tutor explanation is being prepared for this verified answer."}</p>
              <div className="note-box"><label htmlFor="question-note">Your note</label><textarea id="question-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a reminder for later revision…" /><button type="button" className="outline-button" onClick={() => { void saveFlag(true, note); }}>Save note</button></div>
              <button className="primary-button" type="button" onClick={() => { if (practiceSession) void loadQuestion(practiceSession.id, question.id); }}>Next question</button>
            </div>
          )}
          <p className="source">Source: {question.display_name ?? question.rel_source_path ?? "Source retained"}{question.source_locator ? ` · ${question.source_locator}` : ""}</p>
        </section>
      )}
      <footer>Answers are limited to the loaded study materials and may be incomplete or outdated. This tool is exam-study support, not legal advice.</footer>
    </main>
  );
}

export default function PracticePage() {
  return <Suspense fallback={<main className="narrow"><p>Preparing practice…</p></main>}><PracticeContent /></Suspense>;
}
