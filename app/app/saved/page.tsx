"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cleanQuestionStem } from "@/lib/question-text";
type Saved = { id: number; course: string; topic: string | null; stem: string; note: string | null; display_name: string | null };
export default function SavedPage() {
  const [items, setItems] = useState<Saved[] | null>(null); const [message, setMessage] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/flags"); const data = await response.json(); setItems(data.items ?? []); }, []);
  useEffect(() => { void load(); }, [load]);
  async function remove(id: number) { await fetch("/api/flags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: id, saved: false }) }); setMessage("Removed from saved questions."); void load(); }
  return <main className="narrow"><Link className="back-link" href="/">← Back to home</Link><p className="eyebrow">Saved &amp; notes</p><h1>Return to the hard ones.</h1>{items === null ? <p className="muted">Loading saved questions…</p> : !items.length ? <section className="panel empty-state"><h2>Nothing saved yet.</h2><p className="muted">Use the flag control in practice to save a question and add a note.</p><Link className="button-link" href="/practice">Start practice</Link></section> : <section className="saved-list">{items.map((item) => <article className="card saved-row" key={item.id}><p className="eyebrow">{item.course}{item.topic ? ` · ${item.topic}` : ""}</p><h2>{cleanQuestionStem(item.stem)}</h2>{item.note && <p className="saved-note">{item.note}</p>}<div className="button-row"><Link className="outline-button" href={`/practice?course=${item.course}&question=${item.id}`}>Practise it</Link><button className="text-button" type="button" onClick={() => { void remove(item.id); }}>Remove</button></div></article>)}</section>}{message && <p className="status-message">{message}</p>}<footer>Answers are limited to the loaded study materials and may be incomplete or outdated. This tool is exam-study support, not legal advice.</footer></main>;
}
