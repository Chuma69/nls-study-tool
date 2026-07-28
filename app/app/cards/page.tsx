"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cleanQuestionStem } from "@/lib/question-text";

type Card = { id: number; course: string; stem: string; options: { key: string; text: string }[]; material_supported_key: string; explanation: string | null; display_name: string | null };

export default function CardsPage() {
  const [card, setCard] = useState<Card | null | undefined>(undefined); const [flipped, setFlipped] = useState(false); const [message, setMessage] = useState("");
  const load = useCallback(async () => { setCard(undefined); setFlipped(false); const response = await fetch("/api/cards"); const data = await response.json(); setCard(data.card ?? null); }, []);
  useEffect(() => { void load(); }, [load]);
  async function review(rating: "shaky" | "got_it") { if (!card) return; const response = await fetch("/api/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: card.id, rating }) }); const data = await response.json(); setMessage(rating === "got_it" ? `Next review in ${data.nextDueDays} days.` : "This card will return tomorrow."); void load(); }
  const answer = card?.options.find((option) => option.key === card.material_supported_key);
  return <main className="narrow"><Link className="back-link" href="/">← Back to home</Link><p className="eyebrow">Rule cards</p><h1>Recall the rule.</h1><p className="lead">Cards are drawn from answers verified against the loaded materials.</p>
    {card === undefined ? <p className="muted" style={{ marginTop: 28 }}>Finding your next card…</p> : !card ? <section className="panel empty-state"><h2>You are caught up.</h2><p className="muted">There are no due cards right now. Answer more questions to create review cards.</p></section> : <section className={`flashcard ${flipped ? "flipped" : ""}`}><button type="button" className="flashcard-face" onClick={() => setFlipped((value) => !value)}><p className="eyebrow">{card.course}</p>{!flipped ? <><h2>{cleanQuestionStem(card.stem)}</h2><span>Tap to reveal answer</span></> : <><p className="eyebrow">Answer {card.material_supported_key}</p><h2>{answer?.text}</h2><p>{card.explanation ?? "Supported by the loaded materials."}</p><small>{card.display_name ?? "Source retained"}</small></>}</button>{flipped && <div className="button-row"><button className="secondary" type="button" onClick={() => { void review("shaky"); }}>Still shaky — show again</button><button className="primary-button" type="button" onClick={() => { void review("got_it"); }}>Got it — push it out</button></div>}</section>}
    {message && <p className="status-message" role="status">{message}</p>}<footer>Answers are limited to the loaded study materials and may be incomplete or outdated. This tool is exam-study support, not legal advice.</footer></main>;
}
