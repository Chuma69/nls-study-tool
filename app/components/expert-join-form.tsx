"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Phase = "loading" | "invalid" | "form" | "accepting";

export function ExpertJoinForm({ invite }: { invite: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const autoStarted = useRef(false);

  const accept = useCallback(async (username?: string) => {
    setPhase("accepting");
    setError("");
    try {
      const response = await fetch("/api/expert/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite, username }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "We couldn't accept this invitation. Please try again.");
        setPhase("form");
        return;
      }
      window.dispatchEvent(new Event("callready:session"));
      router.replace("/expert");
    } catch {
      setError("We couldn't reach the server. Please try again in a moment.");
      setPhase("form");
    }
  }, [invite, router]);

  useEffect(() => {
    let cancelled = false;
    if (!invite) { setPhase("invalid"); return; }
    fetch(`/api/expert/accept?invite=${encodeURIComponent(invite)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data?.valid) { setPhase("invalid"); return; }
        setEmail(data.email);
        // Existing Call Ready accounts are added and signed straight into the review view.
        if (data.existingUser) { if (!autoStarted.current) { autoStarted.current = true; void accept(); } }
        else setPhase("form");
      })
      .catch(() => { if (!cancelled) setPhase("invalid"); });
    return () => { cancelled = true; };
  }, [invite, accept]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void accept(name);
  }

  if (phase === "loading") {
    return <section className="panel signin-card expert-join-card"><p className="muted">Checking your invitation…</p></section>;
  }
  if (phase === "accepting") {
    return <section className="panel signin-card expert-join-card"><p className="eyebrow">Expert review</p><h2>Signing you in…</h2><p className="muted">Taking you to the review panel.</p></section>;
  }
  if (phase === "invalid") {
    return (
      <section className="panel signin-card expert-join-card">
        <p className="eyebrow">Expert review invitation</p>
        <h2>This invitation link isn&apos;t valid</h2>
        <p className="muted">It may have expired or already been used. Ask the admin to send a fresh invite.</p>
        <Link className="button-link" href="/">Back to home</Link>
      </section>
    );
  }
  return (
    <section className="panel signin-card expert-join-card">
      <p className="eyebrow">Expert review invitation</p>
      <h2>Join the review panel</h2>
      <p className="muted">You&apos;ve been invited to help verify Bar Part II practice questions. Reviews are independent and stay private until you submit them.</p>
      <p className="dual-account-note">Accepting also creates a <strong>learner study account</strong>, so you can practise Bar Part II questions yourself anytime — just switch to learner mode.</p>
      <form onSubmit={submit}>
        <label htmlFor="expert-email">Email</label>
        <input id="expert-email" type="email" value={email} readOnly aria-readonly="true" />
        <p className="field-hint">This invitation was sent to this address.</p>
        <label htmlFor="expert-name">Your name</label>
        <input id="expert-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={!name.trim()}>Accept &amp; start reviewing</button>
      </form>
      <p className="signin-consent">By joining, you agree to our <Link href="/terms">Terms of Use</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    </section>
  );
}
