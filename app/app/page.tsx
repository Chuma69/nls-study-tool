"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type User = { id: number; username: string; identityType: "registered" | "guest" };

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
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
        body: JSON.stringify(mode === "guest" ? { mode } : { mode, username: name, email }),
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

  return (
    <main>
      <p className="eyebrow">Nigerian Law School · Bar Part II Finals</p>
      <h1>NLS Study Tool</h1>
      <p className="muted">Practise past questions from the materials you provided.</p>

      {user === undefined ? <p>Preparing your study space…</p> : user ? (
        <section className="panel" aria-live="polite">
          <p className="eyebrow">Study session ready</p>
          <h2>Welcome, {user.username}.</h2>
          <p>
            {user.identityType === "guest"
              ? "Your guest progress stays private on this device. It cannot be restored on another device."
              : "Your progress stays private and will be restored on this device."}
          </p>
          <Link className="button-link" href="/practice">Start MCQ practice</Link>
          <Link className="text-link" href="/account">Privacy & data</Link>
          <button className="text-button" type="button" onClick={() => { void fetch("/api/session", { method: "DELETE" }).then(() => setUser(null)); }}>
            End this session
          </button>
        </section>
      ) : (
        <section className="panel">
          <h2>Start studying</h2>
          <p className="muted">Create a private study profile, or try the tool as a guest.</p>
          <form onSubmit={submit}>
            <label htmlFor="name">Name</label>
            <input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" disabled={busy}>{busy ? "Starting…" : "Create private profile"}</button>
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
