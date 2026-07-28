"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type User = { username: string; identityType: "registered" | "guest" };

export default function AccountPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/session").then((response) => response.json()).then((data) => setUser(data.user ?? null)).catch(() => setUser(null));
  }, []);

  async function downloadData() {
    const response = await fetch("/api/privacy");
    if (!response.ok) { setMessage("Your data could not be downloaded. Please try again."); return; }
    const data = await response.json();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "nls-study-data.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Your data download has started.");
  }

  async function deleteData() {
    if (!window.confirm("Delete this study profile, all attempts, flags, and chats from this device? This cannot be undone.")) return;
    const response = await fetch("/api/privacy", { method: "DELETE" });
    if (!response.ok) { setMessage("Your data could not be deleted. Please try again."); return; }
    window.location.assign("/");
  }

  return (
    <main>
      <Link className="back-link" href="/">← Home</Link>
      <p className="eyebrow">Privacy & data</p>
      <h1>Your study data</h1>
      {user === undefined ? <p>Loading…</p> : !user ? <p>You do not have an active study session.</p> : (
        <>
          <section className="panel">
            <h2>{user.username}{user.identityType === "guest" ? " · Guest session" : ""}</h2>
            <p className="muted">{user.identityType === "guest"
              ? "Guest progress is only available in this browser."
              : "Your study progress is private to this device."}</p>
            <button type="button" onClick={() => { void downloadData(); }}>Download my data</button>
          </section>
          <section className="panel danger-panel">
            <h2>Delete my data</h2>
            <p className="muted">This permanently removes your profile, attempts, flags, and saved chats.</p>
            <button type="button" className="secondary" onClick={() => { void deleteData(); }}>Delete my study data</button>
          </section>
          {message && <p role="status">{message}</p>}
        </>
      )}
      <footer>This is a beta-phase study project and mistakes can happen. Please report any issue or feedback you spot. Answers draw on loaded study materials and reviews by legal experts; this tool is exam-study support, not legal advice.</footer>
    </main>
  );
}
