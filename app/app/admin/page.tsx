"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Item = { id: string; stem: string; selected_key: string; review_count: number; status: string };
type CourseUsage = { course: string; answers_count: number; total_seconds: number };
type ActivityUser = { id: number; username: string; email: string; identity_type: "registered" | "guest"; role: string; last_active_at: string; questions_answered: number; sessions_count: number; total_seconds: number; courses: CourseUsage[] };

const courseNames: Record<string, string> = { civil_litigation: "Civil", criminal_litigation: "Criminal", corporate_law_practice: "Corporate", property_law_practice: "Property", professional_ethics_skills: "Ethics" };
function timeLabel(seconds: number) { if (!seconds) return "0m"; const hours = Math.floor(seconds / 3600); const minutes = Math.round(seconds % 3600 / 60); return hours ? `${hours}h ${minutes}m` : `${minutes}m`; }

export default function AdminPage() {
  const [email, setEmail] = useState(""); const [invite, setInvite] = useState(""); const [items, setItems] = useState<Item[]>([]); const [users, setUsers] = useState<ActivityUser[]>([]); const [msg, setMsg] = useState("");
  async function load() {
    const [consensus, activity] = await Promise.all([fetch("/api/admin/consensus"), fetch("/api/admin/activity")]);
    const [consensusData, activityData] = await Promise.all([consensus.json(), activity.json()]);
    setItems(consensusData.items ?? []); setUsers(activityData.users ?? []);
  }
  useEffect(() => { void load(); }, []);
  async function makeInvite() { const response = await fetch("/api/admin/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }); const data = await response.json(); setInvite(data.inviteUrl ?? data.error ?? ""); }
  async function act(id: string, action: "approve" | "reject") { await fetch("/api/admin/consensus", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: id, action }) }); setMsg("Decision saved."); void load(); }
  return <main><Link className="back-link" href="/">← Home</Link><p className="eyebrow">Admin review</p><h1>Invite and approve.</h1>
    <section className="panel"><label>Expert email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /><button className="primary-button" type="button" onClick={() => { void makeInvite(); }}>Create expert invite</button>{invite && <p className="source">Share this one-time link: {invite}</p>}</section>
    <section className="panel admin-activity"><p className="eyebrow">User activity</p><h2>Students using the tool.</h2><p className="muted">{users.length} profile{users.length === 1 ? "" : "s"} · question and time totals update after each answer.</p>
      <div className="activity-list">{users.map((user) => <article className="activity-row" key={user.id}><div className="activity-person"><strong>{user.username}</strong><span>{user.identity_type === "guest" ? "Guest session" : user.email} · {user.role}</span><small>Last active {new Date(user.last_active_at).toLocaleString()}</small></div><div className="activity-stat"><strong>{user.questions_answered}</strong><span>answers</span></div><div className="activity-stat"><strong>{timeLabel(user.total_seconds)}</strong><span>studied</span></div><div className="activity-courses">{user.courses.length ? user.courses.map((course) => <span key={course.course}>{courseNames[course.course] ?? course.course}: {course.answers_count} · {timeLabel(course.total_seconds)}</span>) : <span>No course activity yet</span>}</div></article>)}</div>
    </section>
    <section className="panel danger-panel"><h2>Consensus queue</h2>{items.map((item) => <div key={item.id} className="review-row"><p>{item.stem}</p><p className="source">{item.review_count} matching reviews · proposed {item.selected_key}</p>{item.status === "consensus_reached" && <><button type="button" onClick={() => { void act(item.id, "approve"); }}>Approve for main pool</button><button className="secondary" type="button" onClick={() => { void act(item.id, "reject"); }}>Reject</button></>}</div>)}{!items.length && <p>No consensus awaiting review.</p>}</section>{msg && <p role="status">{msg}</p>}</main>;
}
