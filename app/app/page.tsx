"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type User = { id: number; username: string; identityType: "registered" | "guest"; role: "learner" | "expert" | "admin" };

export default function Home() {
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInviteToken(new URLSearchParams(window.location.search).get("invite"));
    fetch("/api/session")
      .then((response) => response.json())
      .then((data) => setUser(data.user ?? null))
      .catch(() => setUser(null));
  }, []);

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
    ["civil_litigation", "CIV", "Civil Litigation", 72, "good"],
    ["criminal_litigation", "CRIM", "Criminal Litigation", 64, "mid"],
    ["corporate_law_practice", "CORP", "Corporate Law Practice", 56, "bad"],
    ["property_law_practice", "PROP", "Property Law Practice", 69, "mid"],
    ["professional_ethics_skills", "ETH", "Professional Ethics & Skills", 81, "good"],
  ];
  const firstName = user?.username.trim().split(/\s+/)[0] ?? "there";
  const today = new Date();
  const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let finalsDate = new Date(today.getFullYear(), 9, 31);
  if (finalsDate < midnightToday) finalsDate = new Date(today.getFullYear() + 1, 9, 31);
  const daysToFinals = Math.round((finalsDate.getTime() - midnightToday.getTime()) / 86_400_000);
  const dateLine = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(today);

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
              <div className="button-row"><Link className="button-link" href="/practice">Start practice</Link><button className="secondary" disabled title="Sprints are the next feature being built">Design a sprint</button></div>
            </section>
            <aside className="panel readiness-card">
              <div><p className="eyebrow">Readiness</p><div className="readiness-score">68 <span>/ 100</span></div><p className="readiness-line">On track for a pass — Corporate is the drag.</p><div className="readiness-bar"><span /></div></div>
              <div className="readiness-footer"><div><strong>9</strong><span>day streak</span></div><div><strong>{daysToFinals}</strong><span>days to finals</span></div></div>
            </aside>
          </div>

          <div className="section-heading"><h2>Start Practice</h2></div>
          <section className="course-grid">
            {courses.map(([id, code, name, accuracy, tone]) => <Link key={code} className={`card course-card ${tone}`} href={`/practice?course=${id}`}>
              <div className="course-top"><span className="course-code">{code}</span><strong>{accuracy}%</strong></div><h3>{name}</h3><div className="bar"><span style={{ width: `${accuracy}%` }} /></div><p className="course-meta">180 questions · 5 topics</p>
            </Link>)}
          </section>

          <section className="shortcut-grid exact-shortcuts">
            <div id="sprints" className="card shortcut-card blue"><h3>Test sprint</h3><p className="muted">Pick a clock and a question count.</p></div>
            <div id="cards" className="card shortcut-card green"><h3>Rule cards</h3><p className="muted">Time limits, sections, forms — 30 seconds each.</p></div>
            <Link id="saved" className="card shortcut-card amber" href="/account"><h3>Saved &amp; notes</h3><p className="muted">2 flagged for a second look.</p></Link>
          </section>
          <section id="progress" className="weak-panel"><p className="eyebrow">Weak topics to revisit</p><div className="weak-strip"><span className="topic-chip">Meetings &amp; Resolutions <b>48%</b></span><span className="topic-chip">Securities &amp; Debentures <b>51%</b></span><span className="topic-chip">Directors &amp; Officers <b>55%</b></span><span className="topic-chip">Charges &amp; Information <b>58%</b></span><span className="topic-chip">Mortgages <b>58%</b></span></div></section>
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
