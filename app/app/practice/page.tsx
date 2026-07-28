"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

function yearsLabel(years: string[]) {
  return years.length ? `Exam year${years.length === 1 ? "" : "s"}: ${years.join(", ")}` : "Exam year: not identified in source";
}

export default function PracticePage() {
  const [question, setQuestion] = useState<Question | null | undefined>(undefined);
  const [chosenKey, setChosenKey] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  const loadQuestion = useCallback(async () => {
    setQuestion(undefined); setChosenKey(""); setResult(null); setError("");
    const response = await fetch("/api/questions/next");
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load a question."); setQuestion(null); return; }
    setQuestion(data.question);
  }, []);

  useEffect(() => { void loadQuestion(); }, [loadQuestion]);

  async function checkAnswer() {
    if (!question || !chosenKey) return;
    const response = await fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, chosenKey }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not save your answer."); return; }
    setResult(data);
  }

  return (
    <main className="narrow">
      <Link className="back-link" href="/">← Back to home</Link>
      <div className="practice-header"><div><p className="eyebrow">MCQ practice</p><h1>One question at a time.</h1></div><p className="meta">Verified materials only</p></div>
      {question === undefined ? <p>Choosing a question…</p> : error && !question ? <p role="alert">{error}</p> : !question ? <p>Question verification is in progress. We will only reopen practice when answers are supported by the loaded study materials, not by source answer sheets.</p> : (
        <section className="panel question-panel">
          <p className="question-meta">{question.course ?? "Course not identified"} · {yearsLabel(question.exam_years)}</p>
          <div className="practice-progress" aria-hidden="true"><span /></div>
          <p className="stem">{question.stem}</p>
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
          {error && <p className="error" role="alert">{error}</p>}
          {!result ? <button className="primary-button" type="button" disabled={!chosenKey} onClick={() => { void checkAnswer(); }}>
            {chosenKey ? "Check answer" : "Choose an option above first"}
          </button> : (
            <div className={`result ${result.matchesMaterialKey ? "" : "incorrect"}`} role="status">
              <p><strong>{result.matchesMaterialKey ? "Correct." : `Not quite — answer is ${result.materialSupportedKey}.`}</strong></p>
              <p>{question.explanation ?? "This answer is supported by the loaded materials. A fuller explanation is being prepared as verification continues."}</p>
              <button className="primary-button" type="button" onClick={() => { void loadQuestion(); }}>Next question</button>
            </div>
          )}
          <p className="source">Source: {question.display_name ?? question.rel_source_path ?? "Source retained"}{question.source_locator ? ` · ${question.source_locator}` : ""}</p>
        </section>
      )}
      <footer>Answers are limited to the loaded study materials and may be incomplete or outdated. This tool is exam-study support, not legal advice.</footer>
    </main>
  );
}
