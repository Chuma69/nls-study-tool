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
    ["01", "Civil Litigation", "Pleadings · appeals · enforcement"],
    ["02", "Criminal Litigation", "Procedure · evidence · sentencing"],
    ["03", "Corporate Law Practice", "Companies · finance · insolvency"],
    ["04", "Property Law Practice", "Conveyancing · land · leases"],
    ["05", "Professional Ethics & Skills", "Conduct · client care · drafting"],
  ];

  return (
    <main>
      {user === undefined ? <p className="muted">Preparing your study space…</p> : user ? (
        <>
          <div className="home-grid" aria-live="polite">
            <section className="panel hero-card">
              <p className="eyebrow">Nigerian Law School · Bar Part II Finals</p>
              <h1>Welcome, {user.username}.</h1>
              <p className="lead">A calm place to practise, spot gaps, and build confidence from the study materials.</p>
              <div className="countdown"><strong>Study mode</strong><span className="muted">one question, properly understood</span></div>
              <div className="button-row"><Link className="button-link" href="/practice">Start practice</Link><button className="secondary" disabled title="Sprints are the next feature being built">Design a sprint</button></div>
            </section>
            <aside className="panel readiness-card">
              <div><p className="eyebrow">Readiness</p><div className="readiness-score">—</div><p className="muted">Your score appears after enough verified attempts.</p></div>
              <div><p className="eyebrow">Private study space</p><p className="muted">{user.identityType === "guest" ? "Guest progress stays on this browser." : "Your attempts and notes stay with this profile."}</p></div>
            </aside>
          </div>

          <div className="section-heading"><div><p className="eyebrow">Choose a course</p><h2>Learn where the marks are.</h2></div><span className="meta">Verified question bank</span></div>
          <section className="course-grid">
            {courses.map(([code, name, topics]) => <Link key={code} className="card course-card" href="/practice">
              <span className="course-code">{code}</span><h3>{name}</h3><div className="bar"><span /></div><div className="card-footer"><span>Practice set</span><span>→</span></div><p className="muted" style={{ fontSize: 13, marginTop: 12 }}>{topics}</p>
            </Link>)}
          </section>

          <div className="section-heading"><div><p className="eyebrow">Study tools</p><h2>Build a useful revision loop.</h2></div></div>
          <section className="shortcut-grid">
            <div className="card shortcut-card"><p className="course-code">Next</p><h3>Timed sprints</h3><p className="muted">Mini-exams with results held until the end.</p></div>
            <div className="card shortcut-card"><p className="course-code">Next</p><h3>Rule cards</h3><p className="muted">Time limits, sections, and formal requirements.</p></div>
            <Link className="card shortcut-card" href="/account"><p className="course-code">Available</p><h3>Private study data</h3><p className="muted">Manage your profile and the information saved for you.</p></Link>
          </section>
          <div className="section-heading"><div><p className="eyebrow">Focus next</p><h2>Your weak topics will appear here.</h2></div></div>
          <div className="weak-strip"><span className="topic-chip">Complete a few verified questions to begin</span></div>
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
