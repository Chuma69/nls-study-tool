"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cleanQuestionStem } from "@/lib/question-text";
import { COURSE_IDS, COURSE_NAMES, COURSE_TOPICS, topicsForCourse } from "@/lib/course-topics";

type Item = {
  id: string;
  stem: string;
  selected_key: string;
  review_count: number;
  status: string;
};
type CourseUsage = {
  course: string;
  answers_count: number;
  total_seconds: number;
};
type ActivityUser = {
  id: number;
  username: string;
  email: string;
  identity_type: "registered" | "guest";
  role: string;
  last_active_at: string;
  questions_answered: number;
  sessions_count: number;
  total_seconds: number;
  courses: CourseUsage[];
};
type Report = {
  id: number;
  question_id: number;
  category: string;
  details: string | null;
  reporter: string;
  created_at: string;
  stem: string;
  options: { key: string; text: string }[];
  material_supported_key: string;
  explanation: string | null;
  course: string;
  topic: string | null;
};
type BankQuestion = {
  id: number;
  course: string;
  topic: string | null;
  stem: string;
  options: { key: string; text: string }[] | null;
  material_supported_key: string | null;
  explanation: string | null;
  explanation_citations: string[] | null;
  verification_status: string;
  shared_context: string | null;
  context_group_id: string | null;
  context_position: number | null;
  display_name: string | null;
  admin_flagged: boolean;
};
type AdminUser = {
  id: number;
  username: string;
  email: string;
  last_seen_at: string;
};

const courseNames: Record<string, string> = {
  civil_litigation: "Civil",
  criminal_litigation: "Criminal",
  corporate_law_practice: "Corporate",
  property_law_practice: "Property",
  professional_ethics_skills: "Ethics",
};
const fullCourseNames: Record<string, string> = {
  civil_litigation: "Civil Litigation",
  criminal_litigation: "Criminal Litigation",
  corporate_law_practice: "Corporate Law Practice",
  property_law_practice: "Property Law Practice",
  professional_ethics_skills: "Professional Ethics & Skills",
};
function courseLabel(course: string) {
  return fullCourseNames[course] ?? "Course not assigned";
}
function timeLabel(seconds: number) {
  if (!seconds) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function AdminPage() {
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = useState<
    "users" | "questions" | "reports" | "experts" | "team"
  >("users");
  const [email, setEmail] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [invite, setInvite] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [users, setUsers] = useState<ActivityUser[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [editing, setEditing] = useState<Report | null>(null);
  const [bankEditing, setBankEditing] = useState<BankQuestion | null>(null);
  const [bankSelected, setBankSelected] = useState<number[]>([]);
  const [scenarioDraft, setScenarioDraft] = useState("");
  const [showScenarioBuilder, setShowScenarioBuilder] = useState(false);
  const [editStem, setEditStem] = useState("");
  const [editOptions, setEditOptions] = useState<
    { key: string; text: string }[]
  >([]);
  const [editAnswer, setEditAnswer] = useState("");
  const [editExplanation, setEditExplanation] = useState("");
  const [editCourse, setEditCourse] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [bankCourse, setBankCourse] = useState("");
  const [bankTopic, setBankTopic] = useState("");
  const [bankStatus, setBankStatus] = useState("");
  const [bankReview, setBankReview] = useState("");
  const [bankPage, setBankPage] = useState(1);
  const [bankFiltersReady, setBankFiltersReady] = useState(false);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankMore, setBankMore] = useState(false);
  const [msg, setMsg] = useState("");
  const bankPageCount = Math.max(1, Math.ceil(bankTotal / 25));
  const bankVisiblePages = Array.from(
    new Set([
      1,
      ...Array.from(
        { length: 5 },
        (_, index) => bankPage - 2 + index,
      ).filter((page) => page > 0 && page <= bankPageCount),
      bankPageCount,
    ]),
  ).sort((first, second) => first - second);
  async function load() {
    try {
      const [consensus, activity, reportResponse, adminResponse] =
        await Promise.all([
          fetch("/api/admin/consensus"),
          fetch("/api/admin/activity"),
          fetch("/api/admin/question-reports"),
          fetch("/api/admin/admins"),
        ]);
      const [consensusData, activityData, reportData, adminData] =
        await Promise.all([
          consensus.json(),
          activity.json(),
          reportResponse.json(),
          adminResponse.json(),
        ]);
      setItems(consensusData.items ?? []);
      setUsers(activityData.users ?? []);
      setReports(reportData.reports ?? []);
      setAdmins(adminData.admins ?? []);
    } catch {
      setMsg(
        "Some admin information could not load. Please refresh and try again.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const routeTab = pathname.split("/")[2];
    if (["users", "questions", "reports", "experts", "team"].includes(routeTab))
      setTab(routeTab as typeof tab);
  }, [pathname]);
  function selectTab(nextTab: typeof tab) {
    setTab(nextTab);
    router.push(`/admin/${nextTab}`);
  }
  async function makeInvite() {
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    setInvite(data.inviteUrl ?? data.error ?? "");
  }
  async function act(id: string, action: "approve" | "reject") {
    await fetch("/api/admin/consensus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: id, action }),
    });
    setMsg("Decision saved.");
    void load();
  }
  function beginEdit(report: Report) {
    setEditing(report);
    setEditStem(report.stem);
    setEditOptions(report.options);
    setEditAnswer(report.material_supported_key);
    setEditExplanation(report.explanation ?? "");
    setEditCourse(COURSE_IDS.includes(report.course as (typeof COURSE_IDS)[number]) ? report.course : "");
    setEditTopic(report.topic ?? "");
  }
  async function resolveReport(action: "save" | "dismiss") {
    if (!editing) return;
    const response = await fetch("/api/admin/question-reports", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reportId: editing.id,
        action,
        stem: editStem,
        options: editOptions,
        answerKey: editAnswer,
        explanation: editExplanation,
        course: editCourse,
        topic: editTopic,
      }),
    });
    const data = await response.json();
    setMsg(
      response.ok
        ? action === "save"
          ? "Correction published live and report resolved."
          : "Report dismissed."
        : (data.error ?? "Could not update report."),
    );
    if (response.ok) {
      setEditing(null);
      void load();
    }
  }
  type BankFilters = { search: string; course: string; topic: string; status: string; review: string };
  async function loadBank(
    page = bankPage,
    filters: BankFilters = { search: bankSearch, course: bankCourse, topic: bankTopic, status: bankStatus, review: bankReview },
  ) {
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.course) params.set("course", filters.course);
      if (filters.topic) params.set("topic", filters.topic);
      if (filters.status) params.set("status", filters.status);
      if (filters.review) params.set("review", filters.review);
      const response = await fetch(`/api/admin/questions?${params}`);
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Could not load question bank.");
      setBankQuestions(data.questions ?? []);
      setBankTotal(data.total ?? 0);
      setBankMore(Boolean(data.hasMore));
      setBankPage(page);
    } catch {
      setBankQuestions([]);
      setBankTotal(0);
      setBankMore(false);
      setMsg("The question bank could not load. Please try again.");
    }
  }
  function applyBankFilters(page = 1, filters: BankFilters = { search: bankSearch, course: bankCourse, topic: bankTopic, status: bankStatus, review: bankReview }) {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.course) params.set("course", filters.course);
    if (filters.topic) params.set("topic", filters.topic);
    if (filters.status) params.set("status", filters.status);
    if (filters.review) params.set("review", filters.review);
    if (page > 1) params.set("page", String(page));
    router.replace(`/admin/questions${params.size ? `?${params}` : ""}`);
    void loadBank(page, filters);
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setBankSearch(params.get("search") ?? "");
    setBankCourse(params.get("course") ?? "");
    setBankTopic(params.get("topic") ?? "");
    setBankStatus(params.get("status") ?? "");
    setBankReview(params.get("review") ?? "");
    setBankPage(Math.max(1, Number(params.get("page")) || 1));
    setBankFiltersReady(true);
  }, []);
  useEffect(() => {
    if (tab === "questions" && bankFiltersReady) void loadBank();
  }, [tab, bankFiltersReady]);
  function beginBankEdit(question: BankQuestion) {
    const options = Array.isArray(question.options) ? question.options : [];
    setBankEditing({ ...question, options });
    setEditing(null);
    setEditStem(question.stem);
    setEditOptions(options);
    setEditAnswer(question.material_supported_key ?? options[0]?.key ?? "");
    setEditExplanation(question.explanation ?? "");
    setEditCourse(question.course);
    setEditTopic(question.topic ?? "");
  }
  async function publishBank() {
    if (!bankEditing) return;
    const response = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId: bankEditing.id,
        stem: editStem,
        options: editOptions,
        answerKey: editAnswer,
        explanation: editExplanation,
        course: editCourse,
        topic: editTopic,
      }),
    });
    const data = await response.json();
    setMsg(
      response.ok
        ? "Correction published live."
        : (data.error ?? "Could not publish correction."),
    );
    if (response.ok) {
      setBankEditing(null);
      void loadBank();
    }
  }
  async function changeBankStatus(action: "unpublish" | "delete") {
    if (!bankEditing) return;
    const prompt =
      action === "delete"
        ? "Delete this question permanently? Its related attempts, reports, and reviews will also be removed."
        : "Unpublish this question? Students will no longer see it, but you can review and publish it again later.";
    if (!window.confirm(prompt)) return;
    const response = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: bankEditing.id, action }),
    });
    const data = await response.json();
    setMsg(
      response.ok
        ? action === "delete"
          ? "Question deleted permanently."
          : "Question unpublished. It is no longer visible to students."
        : (data.error ?? "Could not update this question."),
    );
    if (response.ok) {
      setBankEditing(null);
      void loadBank();
    }
  }
  async function changeReviewFlag() {
    if (!bankEditing) return;
    const action = bankEditing.admin_flagged ? "unflag" : "flag";
    const response = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: bankEditing.id, action }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMsg(data.error ?? "Could not update the review flag.");
      return;
    }
    setMsg(action === "flag" ? "Question flagged for future review." : "Review flag removed.");
    setBankEditing(null);
    void loadBank();
  }
  function toggleBankSelection(questionId: number) {
    setBankSelected((selected) => selected.includes(questionId) ? selected.filter((id) => id !== questionId) : [...selected, questionId]);
  }
  async function groupSelectedQuestions() {
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "group_scenario", questionIds: bankSelected, scenario: scenarioDraft }) });
    const data = await response.json();
    setMsg(response.ok ? `${bankSelected.length} questions grouped into one scenario set.` : (data.error ?? "Could not group these questions."));
    if (response.ok) { setBankSelected([]); setScenarioDraft(""); setShowScenarioBuilder(false); void loadBank(); }
  }
  async function addAdmin() {
    const response = await fetch("/api/admin/admins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: adminEmail }),
    });
    const data = await response.json();
    setMsg(
      response.ok
        ? `${adminEmail.trim()} now has admin access.`
        : (data.error ?? "Could not add admin."),
    );
    if (response.ok) {
      setAdminEmail("");
      void load();
    }
  }
  return (
    <main>
      <Link className="back-link" href="/">
        ← Home
      </Link>
      <p className="eyebrow">Admin</p>
      <h1>Manage the tool.</h1>
      <nav className="admin-tabs" aria-label="Admin sections">
        <button
          className={tab === "users" ? "active" : ""}
          type="button"
          onClick={() => selectTab("users")}
        >
          Users
        </button>
        <button
          className={tab === "questions" ? "active" : ""}
          type="button"
          onClick={() => selectTab("questions")}
        >
          Questions
        </button>
        <button
          className={tab === "reports" ? "active" : ""}
          type="button"
          onClick={() => selectTab("reports")}
        >
          Reports
        </button>
        <button
          className={tab === "experts" ? "active" : ""}
          type="button"
          onClick={() => selectTab("experts")}
        >
          Experts
        </button>
        <button
          className={tab === "team" ? "active" : ""}
          type="button"
          onClick={() => selectTab("team")}
        >
          Team
        </button>
      </nav>
      {tab === "users" && (
        <>
          <section className="panel admin-activity">
            <p className="eyebrow">User activity</p>
            <h2>Students using the tool.</h2>
            <p className="muted">
              {users.length} profile{users.length === 1 ? "" : "s"} · question
              and time totals update after each answer.
            </p>
            <div className="activity-list">
              {users.map((user) => (
                <article className="activity-row" key={user.id}>
                  <div className="activity-person">
                    <strong>{user.username}</strong>
                    <span>
                      {user.identity_type === "guest"
                        ? "Guest session"
                        : user.email}{" "}
                      · {user.role}
                    </span>
                    <small>
                      Last active{" "}
                      {new Date(user.last_active_at).toLocaleString()}
                    </small>
                  </div>
                  <div className="activity-stat">
                    <strong>{user.questions_answered}</strong>
                    <span>answers</span>
                  </div>
                  <div className="activity-stat">
                    <strong>{timeLabel(user.total_seconds)}</strong>
                    <span>studied</span>
                  </div>
                  <div className="activity-courses">
                    {user.courses.length ? (
                      user.courses.map((course) => (
                        <span key={course.course}>
                          {courseNames[course.course] ?? course.course}:{" "}
                          {course.answers_count} ·{" "}
                          {timeLabel(course.total_seconds)}
                        </span>
                      ))
                    ) : (
                      <span>No course activity yet</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
      {tab === "questions" && (
        <>
          <section className="panel question-bank">
            <p className="eyebrow">Question bank</p>
            <h2>Review every question.</h2>
            <p className="muted">
              Select a row to see its options and review it before publishing.
            </p>
            <div className="bank-controls">
              <input
                value={bankSearch}
                onChange={(event) => setBankSearch(event.target.value)}
                placeholder="Search question text"
              />
              <select
                value={bankCourse}
                onChange={(event) => { setBankCourse(event.target.value); setBankTopic(""); }}
              >
                <option value="">All courses</option>
                <option value="none">Unassigned</option>
                {COURSE_IDS.map((id) => <option key={id} value={id}>{COURSE_NAMES[id]}</option>)}
              </select>
              <select
                value={bankTopic}
                onChange={(event) => setBankTopic(event.target.value)}
              >
                <option value="">All topics</option>
                <option value="none">No topic assigned</option>
                {(bankCourse === "none"
                  ? []
                  : bankCourse
                    ? topicsForCourse(bankCourse)
                    : COURSE_IDS.flatMap((id) => COURSE_TOPICS[id].topics)
                ).map((topic) => <option key={topic} value={topic}>{topic}</option>)}
              </select>
              <select
                value={bankStatus}
                onChange={(event) => setBankStatus(event.target.value)}
              >
                <option value="">All questions</option>
                <option value="live">Live</option>
                <option value="not_live">Not live</option>
              </select>
              <select
                value={bankReview}
                onChange={(event) => setBankReview(event.target.value)}
              >
                <option value="">All review flags</option>
                <option value="flagged">Flagged for review</option>
                <option value="not_flagged">Not flagged</option>
              </select>
              <button
                className="outline-button"
                type="button"
                onClick={() => {
                  applyBankFilters(1);
                }}
              >
                Search
              </button>
              <button
                className="text-button clear-bank-filters"
                type="button"
                onClick={() => {
                  const filters = { search: "", course: "", topic: "", status: "", review: "" };
                  setBankSearch(filters.search);
                  setBankCourse(filters.course);
                  setBankTopic(filters.topic);
                  setBankStatus(filters.status);
                  setBankReview(filters.review);
                  applyBankFilters(1, filters);
                }}
              >
                Clear filters
              </button>
            </div>
            <p className="muted">
              {bankTotal
                ? `${bankTotal.toLocaleString()} matching questions`
                : "Opening question bank…"}
            </p>
            {bankSelected.length > 0 && <div className="scenario-selection-bar"><strong>{bankSelected.length} selected</strong><span className="muted">Selection order becomes question order.</span><button className="primary-button" type="button" disabled={bankSelected.length < 2} onClick={() => setShowScenarioBuilder(true)}>Group into scenario</button><button className="text-button" type="button" onClick={() => setBankSelected([])}>Clear selection</button></div>}
            {showScenarioBuilder && <div className="shared-context scenario-builder"><label htmlFor="scenario-text">Shared scenario</label><textarea id="scenario-text" value={scenarioDraft} onChange={(event) => setScenarioDraft(event.target.value)} placeholder="Paste or write the scenario students must read before answering these questions…" /><div className="button-row"><button className="primary-button" type="button" disabled={bankSelected.length < 2 || !scenarioDraft.trim()} onClick={() => void groupSelectedQuestions()}>Save scenario group</button><button className="text-button" type="button" onClick={() => setShowScenarioBuilder(false)}>Cancel</button></div></div>}
            {bankQuestions.length > 0 && (
              <div className="review-list">
                {bankQuestions.map((question, index) => (
                  <div key={question.id}>
                    {question.context_group_id &&
                      (index === 0 ||
                        bankQuestions[index - 1]?.context_group_id !==
                          question.context_group_id) && (
                        <p className="case-study-label">
                          Case-study set · review these linked questions
                          together
                        </p>
                      )}
                    <article
                      className={`review-row question-bank-row ${bankSelected.includes(question.id) ? "selected-bank-row" : ""}`}
                      onClick={() => beginBankEdit(question)}
                    >
                      <label className="bank-question-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={bankSelected.includes(question.id)} onChange={() => toggleBankSelection(question.id)} /><span>Select question</span></label>
                      <p className="eyebrow">
                        #{question.id} · {courseLabel(question.course)}{question.topic ? ` · ${question.topic}` : " · Topic not assigned"} ·{" "}
                        {["material_supported", "staff_corrected"].includes(
                          question.verification_status,
                        ) && question.material_supported_key
                          ? "live"
                          : "not live"}{question.admin_flagged ? " · flagged for review" : ""}
                      </p>
                      <p>{cleanQuestionStem(question.stem)}</p>
                    </article>
                  </div>
                ))}
              </div>
            )}
            {bankQuestions.length > 0 && (
              <div className="button-row question-bank-pages">
                <button
                  className="secondary"
                  type="button"
                  disabled={bankPage === 1}
                  onClick={() => {
                    applyBankFilters(bankPage - 1);
                  }}
                >
                  Previous
                </button>
                <div className="bank-page-numbers" aria-label="Question bank pages">
                  {bankVisiblePages.map((page, index) => (
                    <span key={page}>
                      {index > 0 && page - bankVisiblePages[index - 1] > 1 && (
                        <span className="page-ellipsis">…</span>
                      )}
                      <button
                        className={page === bankPage ? "secondary active-page" : "secondary"}
                        type="button"
                        aria-current={page === bankPage ? "page" : undefined}
                        onClick={() => applyBankFilters(page)}
                      >
                        {page}
                      </button>
                    </span>
                  ))}
                </div>
                <button
                  className="secondary"
                  type="button"
                  disabled={!bankMore}
                  onClick={() => {
                    applyBankFilters(bankPage + 1);
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </section>
          {bankEditing && (
            <section id="bank-question-editor" className="panel report-editor">
              <p className="eyebrow">Reviewing question #{bankEditing.id}</p>
              {bankEditing.shared_context && (
                <div className="shared-context">
                  <p className="case-study-label">Case-study set</p>
                  <p>{bankEditing.shared_context}</p>
                  {bankEditing.context_group_id && (
                    <div className="linked-question-list">
                      {bankQuestions
                        .filter(
                          (question) =>
                            question.context_group_id ===
                            bankEditing.context_group_id,
                        )
                        .map((question) => (
                          <button
                            key={question.id}
                            className={
                              question.id === bankEditing.id
                                ? "secondary active-linked-question"
                                : "secondary"
                            }
                            type="button"
                            onClick={() => beginBankEdit(question)}
                          >
                            Question {question.context_position ?? ""}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
              <label>Question wording</label>
              <textarea
                value={editStem}
                onChange={(event) => setEditStem(event.target.value)}
              />
              <label>Course</label>
              <select
                value={editCourse}
                onChange={(event) => { setEditCourse(event.target.value); setEditTopic(""); }}
              >
                <option value="" disabled>Choose a course</option>
                {COURSE_IDS.map((id) => <option key={id} value={id}>{COURSE_NAMES[id]}</option>)}
              </select>
              <label>Topic</label>
              <select value={editTopic} onChange={(event) => setEditTopic(event.target.value)} disabled={!editCourse}>
                <option value="" disabled>Choose an official topic</option>
                {topicsForCourse(editCourse).map((topic) => <option key={topic} value={topic}>{topic}</option>)}
              </select>
              {editOptions.map((option, index) => (
                <div className="option-edit" key={option.key}>
                  <strong>{option.key}</strong>
                  <input
                    value={option.text}
                    onChange={(event) =>
                      setEditOptions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, text: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <label>Correct answer</label>
              <select
                value={editAnswer}
                onChange={(event) => setEditAnswer(event.target.value)}
              >
                {editOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key} — {option.text}
                  </option>
                ))}
              </select>
              <label>Explanation</label>
              <textarea
                value={editExplanation}
                onChange={(event) => setEditExplanation(event.target.value)}
              />
              <div className="button-row">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    void changeReviewFlag();
                  }}
                >
                  {bankEditing.admin_flagged
                    ? "Remove review flag"
                    : "Flag for future review"}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    void publishBank();
                  }}
                >
                  Publish correction
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    void changeBankStatus("unpublish");
                  }}
                >
                  Unpublish
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => {
                    void changeBankStatus("delete");
                  }}
                >
                  Delete permanently
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setBankEditing(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {tab === "reports" && (
        <>
          <section className="panel report-queue">
            <p className="eyebrow">Question reports</p>
            <h2>Fix reported questions.</h2>
            {!reports.length ? (
              <p className="muted">No question reports awaiting review.</p>
            ) : (
              <div className="review-list">
                {reports.map((report) => (
                  <article className="review-row" key={report.id}>
                    <p className="eyebrow">
                      {report.category} · reported by {report.reporter}
                    </p>
                    <p>{report.stem}</p>
                    {report.details && (
                      <p className="saved-note">{report.details}</p>
                    )}
                    <button
                      type="button"
                      className="outline-button"
                      onClick={() => beginEdit(report)}
                    >
                      Edit &amp; resolve
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
          {editing && (
            <section className="panel report-editor">
              <p className="eyebrow">Editing reported question</p>
              <label>Question wording</label>
              <textarea
                value={editStem}
                onChange={(event) => setEditStem(event.target.value)}
              />
              <label>Course</label>
              <select
                value={editCourse}
                onChange={(event) => {
                  setEditCourse(event.target.value);
                  setEditTopic("");
                }}
              >
                <option value="" disabled>Choose a course</option>
                {COURSE_IDS.map((id) => <option key={id} value={id}>{COURSE_NAMES[id]}</option>)}
              </select>
              <label>Topic</label>
              <select
                value={editTopic}
                onChange={(event) => setEditTopic(event.target.value)}
                disabled={!editCourse}
              >
                <option value="" disabled>Choose an official topic</option>
                {topicsForCourse(editCourse).map((topic) => <option key={topic} value={topic}>{topic}</option>)}
              </select>
              {editOptions.map((option, index) => (
                <div className="option-edit" key={option.key}>
                  <strong>{option.key}</strong>
                  <input
                    value={option.text}
                    onChange={(event) =>
                      setEditOptions((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, text: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
              <label>Correct answer</label>
              <select
                value={editAnswer}
                onChange={(event) => setEditAnswer(event.target.value)}
              >
                {editOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key} — {option.text}
                  </option>
                ))}
              </select>
              <label>Explanation</label>
              <textarea
                value={editExplanation}
                onChange={(event) => setEditExplanation(event.target.value)}
              />
              <div className="button-row">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    void resolveReport("save");
                  }}
                >
                  Publish correction
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    void resolveReport("dismiss");
                  }}
                >
                  Dismiss report
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {tab === "experts" && (
        <>
          <div className="expert-workspace">
            <section className="panel compact-panel">
              <p className="eyebrow">Experts</p>
              <h2>Invite an expert.</h2>
              <p className="muted">
                They can independently review questions that need a second
                opinion.
              </p>
              <div className="invite-controls">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="expert@example.com"
                />
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    void makeInvite();
                  }}
                >
                  Create invite
                </button>
              </div>
              {invite && (
                <p className="source">Share this one-time link: {invite}</p>
              )}
            </section>
            <section className="panel compact-panel review-queue">
              <p className="eyebrow">Expert reviews</p>
              <h2>Review queue.</h2>
              {items.map((item) => (
                <div key={item.id} className="review-row">
                  <div className="review-row-top">
                    <p>{cleanQuestionStem(item.stem)}</p>
                    {item.status === "awaiting_reviews" &&
                      !item.selected_key && (
                        <Link
                          className="outline-button"
                          href={`/expert?question=${item.id}`}
                        >
                          Review answer
                        </Link>
                      )}
                  </div>
                  <p className="source">
                    {item.review_count} review
                    {item.review_count === 1 ? "" : "s"} · proposed{" "}
                    {item.selected_key ?? "answer not selected"}
                  </p>
                  {item.selected_key && (
                    <div className="button-row">
                      <button
                        type="button"
                        onClick={() => {
                          void act(item.id, "approve");
                        }}
                      >
                        Approve review
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          void act(item.id, "reject");
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!items.length && (
                <p className="muted">No reviews awaiting action.</p>
              )}
            </section>
          </div>
        </>
      )}
      {tab === "team" && (
        <section className="panel admin-access">
          <p className="eyebrow">Team</p>
          <h2>Administrators.</h2>
          <p className="muted">
            Admins can manage users, experts, reports, and the question bank.
          </p>
          <div className="bank-controls">
            <input
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="admin@example.com"
            />
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                void addAdmin();
              }}
            >
              Add new admin
            </button>
          </div>
          {admins.length ? (
            <div className="activity-list">
              {admins.map((admin) => (
                <article className="activity-row" key={admin.id}>
                  <div className="activity-person">
                    <strong>{admin.username}</strong>
                    <span>{admin.email}</span>
                  </div>
                  <div className="activity-stat">
                    <strong>Admin</strong>
                    <span>access level</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">No administrators found.</p>
          )}
        </section>
      )}
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
