"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PracticeSession = { id: number; course: string; started_at: string; last_activity_at: string; answers_count: number; correct_count: number; total_seconds: number };
type SprintSession = { id: number; started_at: string; completed_at: string | null; status: string; question_count: number; correct_count: number; answered_count: number; duration_seconds: number };
type CourseProgress = { course: string; total_questions: number; attempted_questions: number; total_topics: number; covered_topics: number; accuracy: number; coverage: number };
type ProgressData = { sessions: PracticeSession[]; sprints: SprintSession[]; courses: CourseProgress[]; coverage: { questions: number; answered: number; topics: number; topicsCovered: number; percentage: number } };

const courseNames: Record<string, string> = {
  civil_litigation: "Civil Litigation", criminal_litigation: "Criminal Litigation",
  corporate_law_practice: "Corporate Law Practice", property_law_practice: "Property Law Practice",
  professional_ethics_skills: "Professional Ethics & Skills",
};

function duration(seconds: number) { return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [message, setMessage] = useState("");
  async function refresh() { const response = await fetch("/api/progress"); const data = await response.json(); setProgress(data); }
  useEffect(() => { void refresh().catch(() => setProgress({ sessions: [], sprints: [], courses: [], coverage: { questions: 0, answered: 0, topics: 0, topicsCovered: 0, percentage: 0 } })); }, []);
  async function clearCourse(course: string) {
    const name = courseNames[course] ?? course;
    if (!window.confirm(`Clear all saved attempts and session timing for ${name}? This cannot be undone.`)) return;
    const response = await fetch(`/api/progress?course=${encodeURIComponent(course)}`, { method: "DELETE" });
    if (!response.ok) { setMessage("That course could not be cleared. Please try again."); return; }
    setMessage(`${name} progress cleared.`);
    await refresh();
  }
  return <main className="narrow">
    <Link className="back-link" href="/">← Back to home</Link>
    <p className="eyebrow">Progress</p><h1>Progress by Course.</h1>
    <p className="lead">Every answered question and the time spent on it is saved here.</p>
    {progress === null ? <p className="muted" style={{ marginTop: 28 }}>Loading your sessions…</p> : <>
      <section className="course-progress"><p className="eyebrow">Coverage by course</p>{progress.courses.map((course) => <article className="course-progress-row" key={course.course}>
        <div className="course-progress-title"><strong>{courseNames[course.course] ?? course.course}</strong><span>{course.attempted_questions}/{course.total_questions} questions · {course.covered_topics}/{course.total_topics} topics</span><button className="clear-course" type="button" disabled={!course.attempted_questions} onClick={() => { void clearCourse(course.course); }}>Clear progress</button></div>
        <div className="bar"><span style={{ width: `${course.coverage}%` }} /></div><b>{course.coverage}%</b>
      </article>)}</section>
      <div className="section-heading compact"><div><p className="eyebrow">Past sessions</p><h2>Practice history.</h2></div></div>
      {progress.sessions.length === 0 && progress.sprints.length === 0 ? <section className="panel empty-state"><h2>No sessions yet.</h2><p className="muted">Choose a course and answer your first question to begin your record.</p><Link className="button-link" href="/practice">Start practice</Link></section> : <section className="session-list">
      {progress.sessions.map((session) => { const percentage = session.answers_count ? Math.round(session.correct_count / session.answers_count * 100) : 0; return <article className="card session-row" key={session.id}>
        <div><p className="eyebrow">{new Date(session.last_activity_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p><h2>{courseNames[session.course] ?? session.course}</h2><p className="muted">{session.answers_count} answered · {duration(session.total_seconds)} total</p></div>
        <div className="session-score"><strong>{percentage}%</strong><span>{session.correct_count}/{session.answers_count} correct</span></div>
      </article>; })}
      {progress.sprints.map((sprint) => { const percentage = sprint.question_count ? Math.round(sprint.correct_count / sprint.question_count * 100) : 0; return <article className="card session-row" key={`sprint-${sprint.id}`}>
        <div><p className="eyebrow">{new Date(sprint.completed_at ?? sprint.started_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · Timed sprint</p><h2>Test sprint</h2><p className="muted">{sprint.answered_count}/{sprint.question_count} answered · {duration(sprint.duration_seconds)} allowed</p></div>
        <div className="session-score"><strong>{percentage}%</strong><span>{sprint.correct_count}/{sprint.question_count} correct</span></div>
      </article>; })}
    </section>}</>}
    {message && <p className="status-message" role="status">{message}</p>}
    <footer>Answers are limited to the loaded study materials and may be incomplete or outdated. This tool is exam-study support, not legal advice.</footer>
  </main>;
}
