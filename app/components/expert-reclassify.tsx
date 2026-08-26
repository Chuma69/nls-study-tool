"use client";

import { useState } from "react";
import { COURSE_IDS, COURSE_NAMES, COURSE_TOPICS, type CourseId } from "@/lib/course-topics";

export function ExpertReclassify({ questionId, currentCourse }: { questionId: string; currentCourse: string | null }) {
  const [open, setOpen] = useState(false);
  const [course, setCourse] = useState<CourseId | "">(currentCourse && currentCourse in COURSE_TOPICS ? (currentCourse as CourseId) : "");
  const [topic, setTopic] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const topics = course ? COURSE_TOPICS[course].topics : [];

  async function submit() {
    if (!course || !topic) { setMessage("Pick a course and a topic."); return; }
    const response = await fetch("/api/question-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId, category: "reclassify", proposedCourse: course, proposedTopic: topic, details: note }),
    });
    if (!response.ok) { const data = await response.json().catch(() => ({})); setMessage(data.error ?? "Could not submit the suggestion."); return; }
    setMessage("Reassignment proposed — an admin will review and publish it.");
    setOpen(false); setTopic(""); setNote("");
  }

  return (
    <div className="expert-action">
      {!open ? (
        <button type="button" className="text-button" onClick={() => { setOpen(true); setMessage(""); }}>Suggest course / topic</button>
      ) : (
        <div className="expert-action-form">
          <label htmlFor="reclassify-course">Course</label>
          <select id="reclassify-course" value={course} onChange={(event) => { setCourse(event.target.value as CourseId | ""); setTopic(""); }}>
            <option value="">Select course</option>
            {COURSE_IDS.map((id) => <option key={id} value={id}>{COURSE_NAMES[id]}</option>)}
          </select>
          <label htmlFor="reclassify-topic">Topic</label>
          <select id="reclassify-topic" value={topic} onChange={(event) => setTopic(event.target.value)} disabled={!course}>
            <option value="">Select topic</option>
            {topics.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label htmlFor="reclassify-note">Note <span>(optional)</span></label>
          <textarea id="reclassify-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why does this classification fit better?" />
          <div className="button-row">
            <button type="button" className="outline-button" onClick={() => void submit()}>Propose reassignment</button>
            <button type="button" className="text-button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {message && <p className="status-message">{message}</p>}
    </div>
  );
}
