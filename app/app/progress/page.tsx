"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudyFooter } from "@/components/study-footer";

type PracticeSession = { id: number; course: string; started_at: string; last_activity_at: string; answers_count: number; correct_count: number; total_seconds: number };
type SprintSession = { id: number; started_at: string; completed_at: string | null; status: string; question_count: number; correct_count: number; answered_count: number; duration_seconds: number };
type RuleCardStats = { reviewed: number; due: number; passed: number };
type CourseProgress = { course: string; total_questions: number; attempted_questions: number; correct_questions: number; total_topics: number; covered_topics: number; accuracy: number; coverage: number };
type ProgressData = { sessions: PracticeSession[]; sprints: SprintSession[]; courses: CourseProgress[]; coverage: { questions: number; answered: number; topics: number; topicsCovered: number; percentage: number } };

const courseNames: Record<string, string> = {
  civil_litigation: "Civil Litigation", criminal_litigation: "Criminal Litigation",
  corporate_law_practice: "Corporate Law Practice", property_law_practice: "Property Law Practice",
  professional_ethics_skills: "Professional Ethics & Skills",
};

function duration(seconds: number) { return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
function accuracyTone(accuracy: number) { return accuracy >= 70 ? "good" : accuracy >= 60 ? "mid" : "bad"; }

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [ruleCards, setRuleCards] = useState<RuleCardStats>({ reviewed: 0, due: 0, passed: 0 });
  const [message, setMessage] = useState("");
  async function refresh() { const response = await fetch("/api/progress"); const data = await response.json(); setProgress(data); }
  useEffect(() => { void refresh().catch(() => setProgress({ sessions: [], sprints: [], courses: [], coverage: { questions: 0, answered: 0, topics: 0, topicsCovered: 0, percentage: 0 } })); void fetch("/api/cards").then((response) => response.json()).then((data) => setRuleCards(data.stats ?? { reviewed: 0, due: 0, passed: 0 })).catch(() => undefined); }, []);
  async function clearCourse(course: string) {
    const name = courseNames[course] ?? course;
    if (!window.confirm(`Clear all saved attempts and session timing for ${name}? This cannot be undone.`)) return;
    const response = await fetch(`/api/progress?course=${encodeURIComponent(course)}`, { method: "DELETE" });
    if (!response.ok) { setMessage("That course could not be cleared. Please try again."); return; }
    setMessage(`${name} progress cleared.`);
    await refresh();
  }
  const answered = progress?.coverage.answered ?? 0;
  const correct = progress?.courses.reduce((sum, course) => sum + course.correct_questions, 0) ?? 0;
  const overallAccuracy = answered ? Math.round(correct / answered * 100) : 0;
  const practiceAnswers = progress?.sessions.reduce((sum, session) => sum + session.answers_count, 0) ?? 0;
  const practiceSeconds = progress?.sessions.reduce((sum, session) => sum + session.total_seconds, 0) ?? 0;
  const averagePace = practiceAnswers ? Math.round(practiceSeconds / practiceAnswers) : 0;
  const log = progress ? [
    ...progress.sprints.map((sprint) => ({ id: `sprint-${sprint.id}`, at: sprint.completed_at ?? sprint.started_at, label: `Sprint · ${sprint.answered_count}/${sprint.question_count} answered · ${duration(sprint.duration_seconds)}`, score: `${sprint.correct_count}/${sprint.question_count}`, tone: accuracyTone(sprint.question_count ? Math.round(sprint.correct_count / sprint.question_count * 100) : 0) })),
    ...progress.sessions.map((session) => ({ id: `practice-${session.id}`, at: session.last_activity_at, label: `MCQ set · ${courseNames[session.course] ?? session.course} · ${duration(session.total_seconds)}`, score: `${session.correct_count}/${session.answers_count}`, tone: accuracyTone(session.answers_count ? Math.round(session.correct_count / session.answers_count * 100) : 0) })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12) : [];
  return <main className="progress-page">
    <Link className="back-link" href="/">← Back to home</Link>
    <h1>Progress</h1>
    {progress === null ? <p className="muted" style={{ marginTop: 28 }}>Loading your sessions…</p> : <>
      <section className="progress-stat-grid"><article className="panel progress-stat"><p className="eyebrow">Overall accuracy</p><strong>{overallAccuracy}%</strong><span>{answered ? `${correct}/${answered} questions correct` : "Answer a question to begin"}</span></article><article className="panel progress-stat"><p className="eyebrow">Questions done</p><strong>{answered}</strong><span>{progress.coverage.percentage}% of the available bank covered</span></article><article className="panel progress-stat"><p className="eyebrow">Rule cards</p><strong>{ruleCards.reviewed}</strong><span>{ruleCards.reviewed ? `${ruleCards.reviewed} reviewed · ${ruleCards.passed} passed` : "Review a rule card to begin"}</span></article><article className="panel progress-stat"><p className="eyebrow">Avg pace</p><strong>{averagePace ? `${averagePace}s` : "—"}</strong><span>target is 60s a question</span></article></section>
      <div className="progress-detail-grid"><section className="panel accuracy-panel"><p className="eyebrow">Accuracy by course</p>{progress.courses.map((course) => <article className="accuracy-row" key={course.course}><div><strong>{courseNames[course.course] ?? course.course}</strong><span>{course.attempted_questions}/{course.total_questions} questions · {course.covered_topics}/{course.total_topics} topics</span>{course.attempted_questions > 0 && <button className="clear-course" type="button" onClick={() => { void clearCourse(course.course); }}>Clear progress</button>}</div><div className={`bar ${accuracyTone(course.accuracy)}`}><span style={{ width: `${course.accuracy}%` }} /></div><b>{course.attempted_questions ? `${course.accuracy}%` : "—"}</b></article>)}</section><section className="panel progress-session-log"><p className="eyebrow">Session log</p>{log.length ? log.map((item) => <article key={item.id} className="progress-log-row"><time>{new Date(item.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</time><span>{item.label}</span><b className={item.tone}>{item.score}</b></article>) : <div className="empty-state"><h2>No sessions yet.</h2><p className="muted">Choose a course and answer your first question to begin your record.</p><Link className="button-link" href="/practice">Start practice</Link></div>}</section></div></>}
    {message && <p className="status-message" role="status">{message}</p>}
    <StudyFooter />
  </main>;
}
