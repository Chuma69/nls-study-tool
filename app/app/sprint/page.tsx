"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const courses = [
  ["civil_litigation", "Civil Litigation"], ["criminal_litigation", "Criminal Litigation"],
  ["corporate_law_practice", "Corporate Law Practice"], ["property_law_practice", "Property Law Practice"],
  ["professional_ethics_skills", "Professional Ethics & Skills"],
];

export default function SprintSetup() {
  const router = useRouter(); const [minutes, setMinutes] = useState(15); const [count, setCount] = useState(10); const [selected, setSelected] = useState<string[]>(courses.map(([id]) => id)); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  function toggle(course: string) { setSelected((current) => current.includes(course) ? current.filter((item) => item !== course) : [...current, course]); }
  async function start() { setBusy(true); setError(""); const response = await fetch("/api/sprints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", courses: selected, count, minutes }) }); const data = await response.json(); setBusy(false); if (!response.ok) { setError(data.error ?? "Could not create this sprint."); return; } router.push(`/sprint/${data.sprintId}`); }
  return <main className="narrow"><Link className="back-link" href="/">← Back to home</Link><p className="eyebrow">Test sprint</p><h1>Design a focused run.</h1><p className="lead">Your answers stay hidden until the sprint is complete, just like an exam.</p><section className="panel sprint-setup"><h2>Time</h2><div className="chip-row">{[10,15,30,45].map((value) => <button key={value} className={`chip ${minutes === value ? "selected" : ""}`} onClick={() => setMinutes(value)}>{value} min</button>)}</div><h2>Questions</h2><div className="chip-row">{[5,10,20,30].map((value) => <button key={value} className={`chip ${count === value ? "selected" : ""}`} onClick={() => setCount(value)}>{value}</button>)}</div><h2>Courses</h2><div className="chip-row">{courses.map(([id,label]) => <button key={id} className={`chip ${selected.includes(id) ? "selected" : ""}`} onClick={() => toggle(id)}>{label}</button>)}</div><p className="sprint-summary">{Math.floor((minutes * 60) / count)} seconds per question · {selected.length} course{selected.length === 1 ? "" : "s"} selected</p>{error && <p className="error">{error}</p>}<button className="primary-button" disabled={busy || !selected.length} onClick={() => { void start(); }}>{busy ? "Building sprint…" : "Start sprint"}</button></section></main>;
}
