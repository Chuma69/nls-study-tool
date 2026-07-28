"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PracticeSession = { id: number; course: string; started_at: string; last_activity_at: string; answers_count: number; correct_count: number; total_seconds: number };

const courseNames: Record<string, string> = {
  civil_litigation: "Civil Litigation", criminal_litigation: "Criminal Litigation",
  corporate_law_practice: "Corporate Law Practice", property_law_practice: "Property Law Practice",
  professional_ethics_skills: "Professional Ethics & Skills",
};

function duration(seconds: number) { return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }

export default function ProgressPage() {
  const [sessions, setSessions] = useState<PracticeSession[] | null>(null);
  useEffect(() => { fetch("/api/progress").then((r) => r.json()).then((data) => setSessions(data.sessions ?? [])).catch(() => setSessions([])); }, []);
  return <main className="narrow">
    <Link className="back-link" href="/">← Back to home</Link>
    <p className="eyebrow">Progress</p><h1>Past sessions.</h1>
    <p className="lead">Every answered question and the time spent on it is saved here.</p>
    {sessions === null ? <p className="muted" style={{ marginTop: 28 }}>Loading your sessions…</p> : sessions.length === 0 ? <section className="panel empty-state"><h2>No sessions yet.</h2><p className="muted">Choose a course and answer your first question to begin your record.</p><Link className="button-link" href="/practice">Start practice</Link></section> : <section className="session-list">
      {sessions.map((session) => { const percentage = session.answers_count ? Math.round(session.correct_count / session.answers_count * 100) : 0; return <article className="card session-row" key={session.id}>
        <div><p className="eyebrow">{new Date(session.last_activity_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p><h2>{courseNames[session.course] ?? session.course}</h2><p className="muted">{session.answers_count} answered · {duration(session.total_seconds)} total</p></div>
        <div className="session-score"><strong>{percentage}%</strong><span>{session.correct_count}/{session.answers_count} correct</span></div>
      </article>; })}
    </section>}
    <footer>Answers are limited to the loaded study materials and may be incomplete or outdated. This tool is exam-study support, not legal advice.</footer>
  </main>;
}
