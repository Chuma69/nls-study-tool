"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type User = { id: number; username: string; identityType: "registered" | "guest"; role: "learner" | "expert" | "admin" };
type CourseMetric = { course: string; total_questions: number; attempted_questions: number; total_topics: number; covered_topics: number; coverage: number };
type ProgressData = { courses: CourseMetric[]; coverage: { questions: number; answered: number; topics: number; topicsCovered: number; percentage: number }; readiness: { overall: number; weakestCourse: string | null; streak: number } };

export default function Home() {
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);

  useEffect(() => {
    setInviteToken(new URLSearchParams(window.location.search).get("invite"));
    fetch("/api/session")
      .then((response) => response.json())
      .then((data) => setUser(data.user ?? null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch("/api/progress").then((response) => response.json()).then((data) => setProgress(data)).catch(() => setProgress(null));
  }, [user]);

  async function start(mode: "registered" | "guest") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "guest" ? { mode } : { mode, username: name, email, inviteToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "We could not start your study session.");
      setUser(data.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void start("registered");
  }

  const courses = [
    ["civil_litigation", "CIV", "Civil Litigation"],
    ["criminal_litigation", "CRIM", "Criminal Litigation"],
    ["corporate_law_practice", "CORP", "Corporate Law Practice"],
    ["property_law_practice", "PROP", "Property Law Practice"],
    ["professional_ethics_skills", "ETH", "Professional Ethics & Skills"],
  ];
  const firstName = user?.username.trim().split(/\s+/)[0] ?? "there";
  const today = new Date();
  const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let finalsDate = new Date(today.getFullYear(), 9, 31);
  if (finalsDate < midnightToday) finalsDate = new Date(today.getFullYear() + 1, 9, 31);
  const daysToFinals = Math.round((finalsDate.getTime() - midnightToday.getTime()) / 86_400_000);
  const dateLine = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(today);
  const coverage = progress?.coverage;
  const readiness = progress?.readiness.overall ?? 0;
  const weakestCourse = progress?.readiness.weakestCourse;
  const weakestName = courses.find(([id]) => id === weakestCourse)?.[2];
  const readinessLine = !progress ? "Calculating your study position…" : readiness === 0 ? "Start answering verified questions to build your score." : readiness >= 70 ? "Strong position — keep coverage broad across every course." : readiness >= 60 ? `On track — ${weakestName ?? "your weakest course"} needs attention.` : `Build your base — begin with ${weakestName ?? "your weakest course"}.`;
  const streak = progress?.readiness.streak ?? 0;

  return (
    <main>
      {user === undefined ? <p className="muted">Preparing your study space…</p> : user ? (
        <>
          <div className="home-grid exact-home" aria-live="polite">
            <section className="panel hero-card">
              <p className="eyebrow">{dateLine}</p>
              <h1>Welcome, {firstName}.</h1>
              <p className="lead">It&apos;s a good day to know the answer.</p>
              <div className="countdown"><strong>{daysToFinals}</strong><span className="meta">Days until Bar Part II finals</span></div>
              <div className="button-row"><Link className="button-link" href="/practice">Start practice</Link><Link className="secondary button-link-muted" href="/sprint">Design a sprint</Link></div>
            </section>
            <aside className="panel readiness-card">
              <div><p className="eyebrow">Readiness</p><div className="readiness-score">{readiness} <span>/ 100</span></div><p className="readiness-line">{readinessLine}</p><div className="readiness-bar"><span style={{ width: `${readiness}%` }} /></div></div>
              <div className="readiness-footer"><div><strong>{streak}</strong><span>day streak</span></div><div><strong>{daysToFinals}</strong><span>days to finals</span></div></div>
            </aside>
          </div>

          <div className="section-heading"><h2>Start Practice</h2></div>
          <section className="course-grid">
            {courses.map(([id, code, name]) => { const metric = progress?.courses.find((course) => course.course === id); const completion = metric?.coverage ?? 0; const tone = completion >= 70 ? "good" : completion >= 40 ? "mid" : "bad"; return <Link key={code} className={`card course-card ${tone}`} href={`/practice?course=${id}`}>
              <div className="course-top"><span className="course-code">{code}</span><strong>{metric ? `${completion}%` : "—"}</strong></div><h3>{name}</h3><div className="bar"><span style={{ width: `${completion}%` }} /></div><p className="course-meta">{metric ? `${metric.attempted_questions}/${metric.total_questions} questions · ${metric.covered_topics}/${metric.total_topics} topics` : "Loading coverage…"}</p>
            </Link>; })}
          </section>

          <section className="shortcut-grid exact-shortcuts">
            <Link id="sprints" href="/sprint" className="card shortcut-card blue"><h3>Test sprint</h3><p className="muted">Pick a clock and a question count.</p></Link>
            <Link id="cards" href="/cards" className="card shortcut-card green"><h3>Rule cards</h3><p className="muted">Recall verified rules at your own pace.</p></Link>
            <Link id="saved" className="card shortcut-card amber" href="/saved"><h3>Saved &amp; notes</h3><p className="muted">Return to questions you flagged.</p></Link>
          </section>
          <section id="progress" className="coverage-panel"><p className="eyebrow">Coverage so far</p><div className="coverage-grid"><div><strong>{coverage?.answered ?? 0}</strong><span>of {coverage?.questions ?? 0} questions answered</span></div><div><strong>{coverage?.topicsCovered ?? 0}</strong><span>of {coverage?.topics ?? 0} topics covered</span></div><div><strong>{coverage?.percentage ?? 0}%</strong><span>question-bank completion</span></div></div></section>
          {(user.role === "expert" || user.role === "admin") && <Link className="text-link" href="/expert">Open expert review →</Link>}
          {user.role === "admin" && <Link className="text-link" href="/admin">Open admin review →</Link>}
          <button className="text-button" type="button" onClick={() => { void fetch("/api/session", { method: "DELETE" }).then(() => setUser(null)); }}>End this session</button>
        </>
      ) : (
        <section className="panel">
          <h2>{inviteToken ? "Join as an expert reviewer" : "Start studying"}</h2>
          <p className="muted">Create a private study profile, or try the tool as a guest.</p>
          <form onSubmit={submit}>
            <label htmlFor="name">Name</label>
            <input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Starting…" : "Create or resume private profile"}</button>
          </form>
          <div className="divider">or</div>
          <button type="button" className="secondary" disabled={busy} onClick={() => { void start("guest"); }}>
            Continue as guest
          </button>
          <p className="hint">Guest progress is private to this browser and cannot be recovered elsewhere.</p>
        </section>
      )}

      <footer>
        Answers are limited to the loaded study materials and may be incomplete or outdated. This tool is exam-study support, not legal advice.
      </footer>
    </main>
  );
}
