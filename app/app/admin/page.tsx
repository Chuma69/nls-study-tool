"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cleanQuestionStem } from "@/lib/question-text";
import { COURSE_IDS, COURSE_NAMES, COURSE_TOPICS, topicsForCourse } from "@/lib/course-topics";
import { SourceMaterialSearch } from "@/components/source-material-search";
import { QuestionCreator } from "@/components/question-creator";
import { ScenarioSetEditor } from "@/components/scenario-set-editor";
import { AdminQuestionQuickEdit } from "@/components/admin-question-quick-edit";

const REVIEW_QUEUE_STORAGE_KEY = "admin-question-review-queue";

type Item = {
  id: string;
  stem: string;
  selected_key: string;
  review_count: number;
  status: string;
};
type ActivityCourse = {
  course: string;
  answers: number;
  correct: number;
  total_seconds: number;
  accuracy: number;
};
type ActivityUser = {
  id: number;
  username: string;
  email: string;
  identity_type: "registered" | "guest";
  role: string;
  created_at: string;
  last_active_at: string;
  questions_answered: number;
  distinct_questions: number;
  correct_count: number;
  accuracy: number;
  active_days: number;
  sessions_count: number;
  total_seconds: number;
  courses: ActivityCourse[];
};
type ActivitySummary = {
  totalUsers: number; registered: number; guests: number; experts: number; admins: number;
  active24h: number; active7d: number; newThisWeek: number; activeLearners: number;
  totalAnswers: number; totalSeconds: number; avgAccuracy: number;
};
type Report = {
  id: number;
  review_source: "learner_report" | "admin_flag" | "mixed";
  queue_status: "open" | "resolved";
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
  review_count: number;
  reviews: Array<{ id: number; review_source: "learner_report" | "admin_flag"; category: string; details: string | null; reporter: string; created_at: string; queue_status: "open" | "resolved" }>;
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
  admin_flag_note: string | null;
  allowlisted: boolean;
  allowlisted_at: string | null;
  allowlisted_by: number | null;
};
type BankView = "list" | "review";
type AdminUser = {
  id: number;
  username: string;
  email: string;
  last_seen_at: string;
};
type DuplicateQuestion = {
  id: number;
  course: string | null;
  topic: string | null;
  stem: string;
  options: { key: string; text: string }[] | null;
  material_supported_key: string | null;
  explanation: string | null;
  shared_context: string | null;
  context_group_id: string | null;
  context_position: number | null;
  verification_status: string;
  created_at: string;
  allowlisted: boolean;
  attempts: number;
};
type DuplicateCluster = { key: string; count: number; questions: DuplicateQuestion[] };

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
function relativeTime(value: string) {
  const then = new Date(value).getTime();
  if (!then) return "—";
  const diff = Date.now() - then;
  const minute = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function accuracyTone(accuracy: number) {
  return accuracy >= 70 ? "good" : accuracy >= 50 ? "mid" : "bad";
}

export default function AdminPage() {
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = useState<
    "users" | "questions" | "reviews" | "experts" | "team"
  >("users");
  const [email, setEmail] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [invite, setInvite] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [users, setUsers] = useState<ActivityUser[]>([]);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userRole, setUserRole] = useState<"all" | "learner" | "expert" | "admin">("all");
  const [userIdentity, setUserIdentity] = useState<"all" | "registered" | "guest">("all");
  const [userSort, setUserSort] = useState<"recent" | "answers" | "accuracy" | "time" | "joined">("recent");
  const [userActiveOnly, setUserActiveOnly] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ActivityUser | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewOpenTotal, setReviewOpenTotal] = useState(0);
  const [reviewPageSize, setReviewPageSize] = useState(10);
  const [reviewStatus, setReviewStatus] = useState<"open" | "resolved" | "all">("open");
  const [reviewCourse, setReviewCourse] = useState("");
  const [reviewSubTab, setReviewSubTab] = useState<"flags" | "duplicates">("flags");
  const [dupMode, setDupMode] = useState<"exact" | "similar">("exact");
  const [dupCourse, setDupCourse] = useState("");
  const [dupClusters, setDupClusters] = useState<DuplicateCluster[]>([]);
  const [dupTotal, setDupTotal] = useState(0);
  const [dupRemovable, setDupRemovable] = useState(0);
  const [dupPage, setDupPage] = useState(1);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupCanonical, setDupCanonical] = useState<Record<string, number>>({});
  const [dupKept, setDupKept] = useState<Record<string, number[]>>({});
  const [dupBusyKey, setDupBusyKey] = useState<string | null>(null);
  const dupPageSize = 10;
  const dupPageCount = Math.max(1, Math.ceil(dupTotal / dupPageSize));
  const reviewPageCount = Math.max(1, Math.ceil(reviewTotal / reviewPageSize));
  const reviewVisiblePages = Array.from(
    new Set([
      1,
      ...Array.from(
        { length: 5 },
        (_, index) => reviewPage - 2 + index,
      ).filter((page) => page > 0 && page <= reviewPageCount),
      reviewPageCount,
    ]),
  ).sort((first, second) => first - second);
  function reviewQueueUrl(page = reviewPage, limit = reviewPageSize) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      status: reviewStatus,
    });
    if (reviewCourse) params.set("course", reviewCourse);
    return `/api/admin/question-reports?${params}`;
  }
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
  const [bankLoading, setBankLoading] = useState(true);
  const [bankSearch, setBankSearch] = useState("");
  const [bankCourse, setBankCourse] = useState("");
  const [bankTopic, setBankTopic] = useState("");
  const [bankStatus, setBankStatus] = useState("");
  const [bankScenario, setBankScenario] = useState("");
  const [bankAllowlist, setBankAllowlist] = useState("");
  const [bankView, setBankView] = useState<BankView>("list");
  const [expandedBankGroups, setExpandedBankGroups] = useState<Set<string>>(new Set());
  const attemptedAllowlistSyncStarted = useRef(false);
  const [bankPage, setBankPage] = useState(1);
  const [bankPageSize, setBankPageSize] = useState(25);
  const [bankFiltersReady, setBankFiltersReady] = useState(false);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankMore, setBankMore] = useState(false);
  const [reviewQueueIds, setReviewQueueIds] = useState<number[]>([]);
  const [msg, setMsg] = useState("");
  const bankPageCount = Math.max(1, Math.ceil(bankTotal / (bankView === "review" ? 1 : bankPageSize)));
  const bankQuestionGroups = Array.from(
    bankQuestions.reduce((groups, question) => {
      const key = question.context_group_id ?? `question-${question.id}`;
      groups.set(key, [...(groups.get(key) ?? []), question]);
      return groups;
    }, new Map<string, BankQuestion[]>()),
  ).map(([id, questions]) => ({ id, questions }));
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
          fetch(reviewQueueUrl()),
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
      setActivitySummary(activityData.summary ?? null);
      setReports(reportData.reports ?? []);
      setReviewTotal(reportData.total ?? 0);
      setReviewOpenTotal(reportData.openTotal ?? 0);
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
    void fetch(reviewQueueUrl())
      .then((response) => response.json())
      .then((data) => {
        setReports(data.reports ?? []);
        setReviewTotal(data.total ?? 0);
        setReviewOpenTotal(data.openTotal ?? 0);
      })
      .catch(() => setMsg("The review queue could not load."));
  }, [reviewPage, reviewPageSize, reviewStatus, reviewCourse]);
  useEffect(() => {
    const routeTab = pathname.split("/")[2];
    if (routeTab === "reports") {
      setTab("reviews");
      router.replace("/admin/reviews");
      return;
    }
    if (["users", "questions", "reviews", "experts", "team"].includes(routeTab))
      setTab(routeTab as typeof tab);
  }, [pathname, router]);
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
        publish: true,
        resolveReviewFlags: true,
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
  async function loadDuplicates(page = dupPage, mode = dupMode, course = dupCourse) {
    setDupLoading(true);
    try {
      const params = new URLSearchParams({ mode, page: String(page), limit: String(dupPageSize) });
      if (course) params.set("course", course);
      const response = await fetch(`/api/admin/duplicates?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load duplicates.");
      const clusters = (data.clusters ?? []) as DuplicateCluster[];
      setDupClusters(clusters);
      setDupTotal(data.total ?? 0);
      setDupRemovable(data.removable ?? 0);
      setDupPage(page);
      // Default: keep the allowlisted copy if any (already sorted first), else the first.
      setDupCanonical((current) => {
        const next = { ...current };
        for (const cluster of clusters) if (next[cluster.key] === undefined) next[cluster.key] = cluster.questions[0]?.id;
        return next;
      });
      setDupKept({});
    } catch (reason) {
      setDupClusters([]);
      setDupTotal(0);
      setDupRemovable(0);
      setMsg(reason instanceof Error ? reason.message : "Could not load duplicates.");
    } finally {
      setDupLoading(false);
    }
  }
  useEffect(() => {
    if (tab !== "reviews" || reviewSubTab !== "duplicates") return;
    void loadDuplicates(1, dupMode, dupCourse);
  }, [tab, reviewSubTab, dupMode, dupCourse]); // eslint-disable-line react-hooks/exhaustive-deps
  async function mergeDuplicateCluster(cluster: DuplicateCluster) {
    const canonicalId = dupCanonical[cluster.key] ?? cluster.questions[0]?.id;
    if (!canonicalId) return;
    const kept = new Set(dupKept[cluster.key] ?? []);
    const duplicateIds = cluster.questions.map((q) => q.id).filter((id) => id !== canonicalId && !kept.has(id));
    if (!duplicateIds.length) { setMsg("Nothing to merge — every other copy is marked to keep."); return; }
    if (!window.confirm(`Keep question #${canonicalId} and permanently delete ${duplicateIds.length} duplicate${duplicateIds.length === 1 ? "" : "s"} (${duplicateIds.map((id) => `#${id}`).join(", ")})? Their attempts and reports are removed too. The kept question will be allowlisted.`)) return;
    setDupBusyKey(cluster.key);
    try {
      const response = await fetch("/api/admin/duplicates", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "merge", canonicalId, duplicateIds, allowlist: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not merge these duplicates.");
      setMsg(`Merged ${data.merged} duplicate${data.merged === 1 ? "" : "s"} into #${canonicalId}${data.allowlisted ? " and allowlisted it" : ""}.`);
      await loadDuplicates(dupPage, dupMode, dupCourse);
    } catch (reason) {
      setMsg(reason instanceof Error ? reason.message : "Could not merge these duplicates.");
    } finally {
      setDupBusyKey(null);
    }
  }
  async function ignoreDuplicateCluster(cluster: DuplicateCluster) {
    if (!window.confirm("Mark this cluster as 'not duplicates'? It won't appear here again.")) return;
    setDupBusyKey(cluster.key);
    try {
      const response = await fetch("/api/admin/duplicates", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ignore", clusterKey: cluster.key, mode: dupMode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not dismiss this cluster.");
      setMsg("Cluster dismissed as not duplicates.");
      await loadDuplicates(dupPage, dupMode, dupCourse);
    } catch (reason) {
      setMsg(reason instanceof Error ? reason.message : "Could not dismiss this cluster.");
    } finally {
      setDupBusyKey(null);
    }
  }
  async function deleteDuplicateCluster(cluster: DuplicateCluster) {
    const questionIds = cluster.questions.map((q) => q.id);
    if (!window.confirm(`Permanently delete ALL ${questionIds.length} questions in this cluster (${questionIds.map((id) => `#${id}`).join(", ")})? Nothing is kept. Their attempts and reports are removed too. This cannot be undone.`)) return;
    setDupBusyKey(cluster.key);
    try {
      const response = await fetch("/api/admin/duplicates", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_all", questionIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not delete this cluster.");
      setMsg(`Deleted all ${data.deleted} questions in the cluster.`);
      await loadDuplicates(dupPage, dupMode, dupCourse);
    } catch (reason) {
      setMsg(reason instanceof Error ? reason.message : "Could not delete this cluster.");
    } finally {
      setDupBusyKey(null);
    }
  }
  function toggleDuplicateKept(clusterKey: string, questionId: number) {
    setDupKept((current) => {
      const kept = new Set(current[clusterKey] ?? []);
      if (kept.has(questionId)) kept.delete(questionId); else kept.add(questionId);
      return { ...current, [clusterKey]: [...kept] };
    });
  }
  type BankFilters = { search: string; course: string; topic: string; status: string; scenario: string; allowlist: string; pageSize: number; view: BankView };
  async function loadBank(
    page = bankPage,
    filters: BankFilters = { search: bankSearch, course: bankCourse, topic: bankTopic, status: bankStatus, scenario: bankScenario, allowlist: bankAllowlist, pageSize: bankPageSize, view: bankView },
  ) {
    setBankLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.course) params.set("course", filters.course);
      if (filters.topic) params.set("topic", filters.topic);
      if (filters.status) params.set("status", filters.status);
      if (filters.scenario) params.set("scenario", filters.scenario);
      if (filters.allowlist) params.set("allowlist", filters.allowlist);
      params.set("view", filters.view);
      params.set("limit", String(filters.pageSize));
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
    } finally {
      setBankLoading(false);
    }
  }
  async function loadReviewQuestion(position: number, queue = reviewQueueIds) {
    const questionId = queue[position - 1];
    if (!questionId) {
      setBankQuestions([]);
      return;
    }
    try {
      const response = await fetch(`/api/admin/questions?questionId=${questionId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load question.");
      setBankQuestions([data.question]);
      setBankPage(position);
      setBankTotal(queue.length);
      setBankMore(position < queue.length);
      sessionStorage.setItem(REVIEW_QUEUE_STORAGE_KEY, JSON.stringify({ questionIds: queue, position }));
    } catch {
      setMsg("That review question could not load. Please try again.");
    }
  }
  async function enterReviewMode(filters: BankFilters) {
    try {
      const params = new URLSearchParams({ snapshot: "1", view: "review" });
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.course) params.set("course", filters.course);
      if (filters.topic) params.set("topic", filters.topic);
      if (filters.status) params.set("status", filters.status);
      if (filters.scenario) params.set("scenario", filters.scenario);
      if (filters.allowlist) params.set("allowlist", filters.allowlist);
      const response = await fetch(`/api/admin/questions?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start review mode.");
      const queue = (data.questionIds ?? []) as number[];
      setReviewQueueIds(queue);
      sessionStorage.setItem(REVIEW_QUEUE_STORAGE_KEY, JSON.stringify({ questionIds: queue, position: 1 }));
      setBankView("review");
      setBankTotal(queue.length);
      const urlParams = new URLSearchParams(params);
      urlParams.delete("snapshot");
      router.replace(`/admin/questions?${urlParams}`);
      await loadReviewQuestion(1, queue);
    } catch {
      setMsg("Review mode could not start. Please try again.");
    }
  }
  function exitReviewMode() {
    setReviewQueueIds([]);
    sessionStorage.removeItem(REVIEW_QUEUE_STORAGE_KEY);
    const filters: BankFilters = { search: bankSearch, course: bankCourse, topic: bankTopic, status: bankStatus, scenario: bankScenario, allowlist: bankAllowlist, pageSize: bankPageSize, view: "list" };
    setBankView("list");
    applyBankFilters(1, filters);
  }
  function applyBankFilters(page = 1, filters: BankFilters = { search: bankSearch, course: bankCourse, topic: bankTopic, status: bankStatus, scenario: bankScenario, allowlist: bankAllowlist, pageSize: bankPageSize, view: bankView }) {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.course) params.set("course", filters.course);
    if (filters.topic) params.set("topic", filters.topic);
    if (filters.status) params.set("status", filters.status);
    if (filters.scenario) params.set("scenario", filters.scenario);
    if (filters.allowlist) params.set("allowlist", filters.allowlist);
    if (filters.view === "review") params.set("view", "review");
    if (filters.pageSize !== 25) params.set("limit", String(filters.pageSize));
    if (page > 1) params.set("page", String(page));
    router.replace(`/admin/questions${params.size ? `?${params}` : ""}`);
    void loadBank(page, filters);
  }
  function clearBankFilters() {
    const filters: BankFilters = { search: "", course: "", topic: "", status: "", scenario: "", allowlist: "", pageSize: bankPageSize, view: "list" };
    setBankSearch(filters.search);
    setBankCourse(filters.course);
    setBankTopic(filters.topic);
    setBankStatus(filters.status);
    setBankScenario(filters.scenario);
    setBankAllowlist(filters.allowlist);
    setBankView("list");
    applyBankFilters(1, filters);
  }
  const hasActiveBankFilters = Boolean(bankSearch || bankCourse || bankTopic || bankStatus || bankScenario || bankAllowlist);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setBankSearch(params.get("search") ?? "");
    setBankCourse(params.get("course") ?? "");
    setBankTopic(params.get("topic") ?? "");
    setBankStatus(params.get("status") ?? "");
    setBankScenario(params.get("scenario") ?? "");
    setBankAllowlist(params.get("allowlist") ?? "");
    setBankView(params.get("view") === "review" ? "review" : "list");
    setBankPageSize([10,25,50,100].includes(Number(params.get("limit"))) ? Number(params.get("limit")) : 25);
    setBankPage(Math.max(1, Number(params.get("page")) || 1));
    setBankFiltersReady(true);
  }, []);
  useEffect(() => {
    if (tab !== "questions" || !bankFiltersReady) return;
    if (bankView !== "review") {
      void loadBank();
      return;
    }
    try {
      const stored = JSON.parse(sessionStorage.getItem(REVIEW_QUEUE_STORAGE_KEY) ?? "null") as { questionIds?: number[]; position?: number } | null;
      const queue = stored?.questionIds?.filter((id) => Number.isSafeInteger(id) && id > 0) ?? [];
      if (queue.length) {
        const position = Math.min(Math.max(1, stored?.position ?? 1), queue.length);
        setReviewQueueIds(queue);
        void loadReviewQuestion(position, queue);
        return;
      }
    } catch {
      sessionStorage.removeItem(REVIEW_QUEUE_STORAGE_KEY);
    }
    const filters: BankFilters = { search: bankSearch, course: bankCourse, topic: bankTopic, status: bankStatus, scenario: bankScenario, allowlist: bankAllowlist, pageSize: bankPageSize, view: "review" };
    void enterReviewMode(filters);
  }, [tab, bankFiltersReady, bankView]);
  useEffect(() => {
    if (tab !== "questions" || !bankFiltersReady || attemptedAllowlistSyncStarted.current) return;
    attemptedAllowlistSyncStarted.current = true;
    void fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "allowlist_attempted" }),
    }).then(async (response) => {
      const data = await response.json();
      if (response.ok) {
        if (data.updated) setMsg(`${data.updated} previously attempted questions were allowlisted.`);
        void loadBank(1);
      }
    });
  }, [tab, bankFiltersReady]);
  useEffect(() => {
    if (bankView !== "review") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [bankView]);
  useEffect(() => {
    if (!bankEditing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setBankEditing(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [bankEditing]);
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
  function togglePageSelection() {
    const ids = bankQuestions.map((question) => question.id);
    const allSelected = ids.length > 0 && ids.every((id) => bankSelected.includes(id));
    setBankSelected((selected) => allSelected
      ? selected.filter((id) => !ids.includes(id))
      : Array.from(new Set([...selected, ...ids])));
  }
  function toggleExpandedGroup(groupId: string) {
    setExpandedBankGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }
  async function toggleQuestionAllowlist(question: BankQuestion) {
    const response = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: question.id, action: question.allowlisted ? "remove_allowlist" : "allowlist" }),
    });
    const data = await response.json();
    if (!response.ok) { setMsg(data.error ?? "Could not update allowlist status."); return; }
    setBankQuestions((current) => current.map((item) => item.id === question.id
      ? { ...item, allowlisted: !question.allowlisted, allowlisted_at: !question.allowlisted ? new Date().toISOString() : null }
      : item));
    setMsg(question.allowlisted ? "Question removed from the allowlist." : "Question allowlisted.");
  }
  async function groupSelectedQuestions() {
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "group_scenario", questionIds: bankSelected, scenario: scenarioDraft }) });
    const data = await response.json();
    setMsg(response.ok ? `${bankSelected.length} questions grouped into one scenario set.` : (data.error ?? "Could not group these questions."));
    if (response.ok) { setBankSelected([]); setScenarioDraft(""); setShowScenarioBuilder(false); void loadBank(); }
  }
  async function groupSelectedQuestionsInOrder() {
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "group_ordered", questionIds: bankSelected }) });
    const data = await response.json();
    setMsg(response.ok ? `${bankSelected.length} questions grouped in a fixed learner order.` : (data.error ?? "Could not group these questions."));
    if (response.ok) { setBankSelected([]); void loadBank(); }
  }
  async function runBulkQuestionAction(action: "bulk_publish" | "bulk_unpublish" | "bulk_flag" | "bulk_unflag" | "bulk_allowlist" | "bulk_remove_allowlist" | "bulk_delete") {
    if (action === "bulk_unpublish" && !window.confirm(`Unpublish ${bankSelected.length} selected questions? Students will no longer see them.`)) return;
    if (action === "bulk_delete" && !window.confirm(`Permanently delete ${bankSelected.length} selected questions? Their related attempts, reports, reviews, and scenario links will also be removed. This cannot be undone.`)) return;
    const response = await fetch("/api/admin/questions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, questionIds: bankSelected }) });
    const data = await response.json();
    const labels = { bulk_publish: "published", bulk_unpublish: "unpublished", bulk_flag: "flagged for review", bulk_unflag: "removed from review flags", bulk_allowlist: "allowlisted", bulk_remove_allowlist: "removed from the allowlist", bulk_delete: "permanently deleted" };
    setMsg(response.ok ? `${data.updated ?? 0} questions ${labels[action]}.${data.skipped ? ` ${data.skipped} skipped because they were ineligible or already updated.` : ""}` : (data.error ?? "Could not update the selected questions."));
    if (response.ok) { setBankSelected([]); void loadBank(); }
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
  useEffect(() => {
    if (!selectedUser) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedUser(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [selectedUser]);
  const userQuery = userSearch.trim().toLowerCase();
  const visibleUsers = users
    .filter((user) => userRole === "all" || user.role === userRole)
    .filter((user) => userIdentity === "all" || user.identity_type === userIdentity)
    .filter((user) => !userActiveOnly || user.questions_answered > 0)
    .filter((user) => !userQuery || user.username.toLowerCase().includes(userQuery) || user.email.toLowerCase().includes(userQuery))
    .sort((first, second) => {
      switch (userSort) {
        case "answers": return second.questions_answered - first.questions_answered;
        case "accuracy": return second.accuracy - first.accuracy || second.questions_answered - first.questions_answered;
        case "time": return second.total_seconds - first.total_seconds;
        case "joined": return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
        default: return new Date(second.last_active_at).getTime() - new Date(first.last_active_at).getTime();
      }
    });
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
          className={tab === "reviews" ? "active" : ""}
          type="button"
          onClick={() => selectTab("reviews")}
        >
          Reviews
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
          <section className="admin-user-summary" aria-label="Cohort insights">
            <article className="panel admin-stat"><p className="eyebrow">Students</p><strong>{activitySummary?.totalUsers ?? 0}</strong><span>{activitySummary?.registered ?? 0} registered · {activitySummary?.guests ?? 0} guest</span></article>
            <article className="panel admin-stat"><p className="eyebrow">Active this week</p><strong>{activitySummary?.active7d ?? 0}</strong><span>{activitySummary?.active24h ?? 0} in the last 24h</span></article>
            <article className="panel admin-stat"><p className="eyebrow">Questions answered</p><strong>{(activitySummary?.totalAnswers ?? 0).toLocaleString()}</strong><span>{activitySummary?.activeLearners ?? 0} learners practicing</span></article>
            <article className="panel admin-stat"><p className="eyebrow">Study time</p><strong>{timeLabel(activitySummary?.totalSeconds ?? 0)}</strong><span>across all sessions</span></article>
            <article className="panel admin-stat"><p className="eyebrow">Avg accuracy</p><strong>{activitySummary?.avgAccuracy ?? 0}%</strong><span>{activitySummary?.experts ?? 0} experts · {activitySummary?.admins ?? 0} admins</span></article>
            <article className="panel admin-stat"><p className="eyebrow">New this week</p><strong>{activitySummary?.newThisWeek ?? 0}</strong><span>joined in the last 7 days</span></article>
          </section>
          <section className="panel admin-activity">
            <p className="eyebrow">User activity</p>
            <h2>Students using the tool.</h2>
            <div className="admin-user-controls">
              <input className="admin-user-search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search name or email" aria-label="Search students" />
              <select value={userRole} onChange={(event) => setUserRole(event.target.value as typeof userRole)} aria-label="Filter by role">
                <option value="all">All roles</option>
                <option value="learner">Learners</option>
                <option value="expert">Experts</option>
                <option value="admin">Admins</option>
              </select>
              <select value={userIdentity} onChange={(event) => setUserIdentity(event.target.value as typeof userIdentity)} aria-label="Filter by identity">
                <option value="all">All accounts</option>
                <option value="registered">Registered</option>
                <option value="guest">Guest</option>
              </select>
              <select value={userSort} onChange={(event) => setUserSort(event.target.value as typeof userSort)} aria-label="Sort students">
                <option value="recent">Most recent</option>
                <option value="answers">Most answers</option>
                <option value="accuracy">Highest accuracy</option>
                <option value="time">Most study time</option>
                <option value="joined">Newest joined</option>
              </select>
              <label className="admin-user-toggle"><input type="checkbox" checked={userActiveOnly} onChange={(event) => setUserActiveOnly(event.target.checked)} />Active only</label>
            </div>
            <p className="muted admin-user-count">{visibleUsers.length} of {users.length} student{users.length === 1 ? "" : "s"} · click a student for full insights.</p>
            <div className="admin-user-list">
              {visibleUsers.length ? visibleUsers.map((user) => (
                <button type="button" className="admin-user-row" key={user.id} onClick={() => setSelectedUser(user)}>
                  <div className="admin-user-id">
                    <strong>{user.username}</strong>
                    <span>{user.identity_type === "guest" ? "Guest session" : user.email}</span>
                    <div className="admin-user-badges">
                      <span className={`role-badge role-${user.role}`}>{user.role}</span>
                      {user.identity_type === "guest" && <span className="role-badge role-guest">guest</span>}
                      <span className="admin-user-lastactive">{relativeTime(user.last_active_at)}</span>
                    </div>
                  </div>
                  <div className="admin-user-metrics">
                    <div className="metric"><strong>{user.questions_answered.toLocaleString()}</strong><span>answers</span></div>
                    <div className="metric"><strong>{user.questions_answered ? `${user.accuracy}%` : "—"}</strong><span>accuracy</span></div>
                    <div className="metric"><strong>{timeLabel(user.total_seconds)}</strong><span>studied</span></div>
                    <div className="metric"><strong>{user.courses.length}</strong><span>course{user.courses.length === 1 ? "" : "s"}</span></div>
                  </div>
                  <div className="admin-user-accuracy" aria-hidden="true"><span className={`accuracy-fill ${accuracyTone(user.accuracy)}`} style={{ width: `${user.questions_answered ? user.accuracy : 0}%` }} /></div>
                </button>
              )) : <p className="muted admin-user-empty">No students match these filters.</p>}
            </div>
          </section>
          {selectedUser && (
            <>
              <div className="modal-backdrop" aria-hidden="true" onClick={() => setSelectedUser(null)} />
              <section className="panel user-detail-modal" role="dialog" aria-modal="true" aria-label={`Insights for ${selectedUser.username}`}>
                <button className="modal-close-button" type="button" aria-label="Close insights" onClick={() => setSelectedUser(null)}>×</button>
                <p className="eyebrow">Student insights</p>
                <h2>{selectedUser.username}</h2>
                <p className="muted">{selectedUser.identity_type === "guest" ? "Guest session" : selectedUser.email} · {selectedUser.role}</p>
                <div className="user-detail-stats">
                  <div><strong>{selectedUser.questions_answered.toLocaleString()}</strong><span>answers</span></div>
                  <div><strong>{selectedUser.distinct_questions.toLocaleString()}</strong><span>unique questions</span></div>
                  <div><strong className={accuracyTone(selectedUser.accuracy)}>{selectedUser.questions_answered ? `${selectedUser.accuracy}%` : "—"}</strong><span>accuracy</span></div>
                  <div><strong>{timeLabel(selectedUser.total_seconds)}</strong><span>study time</span></div>
                  <div><strong>{selectedUser.sessions_count}</strong><span>sessions</span></div>
                  <div><strong>{selectedUser.active_days}</strong><span>active day{selectedUser.active_days === 1 ? "" : "s"}</span></div>
                </div>
                <p className="muted user-detail-meta">Joined {new Date(selectedUser.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · last active {relativeTime(selectedUser.last_active_at)}{selectedUser.questions_answered ? ` · ${selectedUser.total_seconds && selectedUser.questions_answered ? Math.round(selectedUser.total_seconds / selectedUser.questions_answered) : 0}s per answer` : ""}</p>
                <div className="user-detail-course-heading"><p className="eyebrow">By course</p></div>
                {selectedUser.courses.length ? (
                  <div className="user-detail-courses">
                    {selectedUser.courses.map((course) => (
                      <div className="user-course-row" key={course.course}>
                        <div className="user-course-head"><strong>{courseLabel(course.course)}</strong><span>{course.answers} answer{course.answers === 1 ? "" : "s"} · {timeLabel(course.total_seconds)} · {course.accuracy}%</span></div>
                        <div className={`bar ${accuracyTone(course.accuracy)}`}><span style={{ width: `${course.accuracy}%` }} /></div>
                      </div>
                    ))}
                  </div>
                ) : <p className="muted">No course activity yet.</p>}
              </section>
            </>
          )}
        </>
      )}
      {tab === "questions" && (
        <>
          {bankView === "review" && (
            <div className="admin-review-overlay" role="dialog" aria-modal="true" aria-label="Question review mode">
              <main className="admin-review-experience">
                <header className="admin-review-header">
                  <div><p className="eyebrow">Admin review mode</p><h2>Question {bankPage} of {bankTotal}</h2><p className="muted">{bankCourse ? courseLabel(bankCourse) : "All courses"}{bankTopic ? ` · ${bankTopic}` : ""}</p></div>
                  <button className="outline-button" type="button" onClick={exitReviewMode}>Exit review mode</button>
                </header>
                {bankQuestions[0] ? (() => { const question = bankQuestions[0]; return (
                  <article className="admin-review-question-card">
                    {question.shared_context?.trim() && <aside className="admin-review-scenario"><p className="eyebrow">Case study</p><p>{question.shared_context}</p></aside>}
                    <div className="admin-review-question-body">
                      <p className="eyebrow">{courseLabel(question.course)}{question.topic ? ` · ${question.topic}` : " · No topic"} · {question.allowlisted ? "Allowlisted" : "Not allowlisted"}</p>
                      <h3>{cleanQuestionStem(question.stem)}</h3>
                      <div className="admin-review-options">{(question.options ?? []).map((option) => <div className={option.key === question.material_supported_key ? "correct-option" : ""} key={option.key}><strong>{option.key.toUpperCase()}</strong><span>{option.text}</span></div>)}</div>
                      {question.explanation && <section className="admin-review-explanation"><p className="eyebrow">Explanation</p><p>{question.explanation}</p></section>}
                      <div className="button-row">
                        <AdminQuestionQuickEdit questionId={question.id} forceAdmin onSaved={() => void loadReviewQuestion(bankPage)} triggerChildren="Edit question" />
                        {question.context_group_id && <ScenarioSetEditor contextGroupId={question.context_group_id} onChanged={() => void loadReviewQuestion(bankPage)} triggerClassName="outline-button" triggerChildren="Edit scenario set" />}
                        <button className={question.allowlisted ? "outline-button" : "primary-button"} type="button" onClick={() => void toggleQuestionAllowlist(question)}>{question.allowlisted ? "Remove allowlist" : "Allowlist question"}</button>
                      </div>
                    </div>
                  </article>
                ); })() : <p>No questions match these filters.</p>}
                <footer className="admin-review-navigation"><button className="secondary" type="button" disabled={bankPage <= 1} onClick={() => void loadReviewQuestion(bankPage - 1)}>Previous question</button><span className="eyebrow">{bankPage} / {bankTotal}</span><button className="primary-button" type="button" disabled={bankPage >= bankTotal} onClick={() => void loadReviewQuestion(bankPage + 1)}>Next question</button></footer>
              </main>
            </div>
          )}
          <section className="panel question-bank">
            <div className="question-bank-title-row">
              <div><p className="question-bank-heading">Question bank</p><p className="muted">List view supports browsing, batch actions, and scenario management.</p></div>
              <div className="button-row"><button className="primary-button" type="button" onClick={() => { const filters: BankFilters = { search: bankSearch, course: bankCourse, topic: bankTopic, status: bankStatus, scenario: bankScenario, allowlist: bankAllowlist, pageSize: bankPageSize, view: "review" }; void enterReviewMode(filters); }}>Enter review mode</button><QuestionCreator onCreated={() => { void loadBank(1); }} /></div>
            </div>
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
                <option value="">All Questions</option>
                <option value="live">Live</option>
                <option value="not_live">Offline</option>
                <option value="flagged">Flagged for Review</option>
              </select>
              <select
                value={bankScenario}
                onChange={(event) => setBankScenario(event.target.value)}
              >
                <option value="">All structures</option>
                <option value="scenario">Scenario</option>
                <option value="group">Group</option>
                <option value="standalone">Standalone questions</option>
                <option value="grouped">All ordered sets</option>
              </select>
              <select value={bankAllowlist} onChange={(event) => setBankAllowlist(event.target.value)}>
                <option value="">All allowlist states</option>
                <option value="allowlisted">Allowlisted</option>
                <option value="not_allowlisted">Not allowlisted</option>
              </select>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  applyBankFilters(1);
                }}
              >
                Search
              </button>
            </div>
            <div className="bank-results-summary">
              <p className="muted">
                {bankLoading
                  ? "Opening question bank…"
                  : bankTotal
                    ? `${bankTotal.toLocaleString()} matching ${bankScenario === "scenario" ? "scenario sets" : bankScenario === "group" ? "question groups" : bankScenario === "grouped" ? "ordered sets" : "questions"}`
                    : "No matching questions"}
              </p>
              <button className="text-button" type="button" onClick={togglePageSelection}>{bankQuestions.length > 0 && bankQuestions.every((question) => bankSelected.includes(question.id)) ? "Clear page selection" : "Select all on page"}</button>
              <button
                className="text-button clear-bank-filters"
                type="button"
                onClick={clearBankFilters}
              >
                Clear filters
              </button>
            </div>
            {bankSelected.length > 0 && <div className="scenario-selection-bar"><strong>{bankSelected.length} selected</strong><button className="primary-button" type="button" disabled={bankSelected.length < 2} onClick={() => setShowScenarioBuilder(true)}>Group into scenario</button><button className="outline-button" type="button" disabled={bankSelected.length < 2} onClick={() => void groupSelectedQuestionsInOrder()}>Group in order</button><button className="outline-button" type="button" onClick={() => void runBulkQuestionAction("bulk_publish")}>Publish</button><button className="outline-button" type="button" onClick={() => void runBulkQuestionAction("bulk_unpublish")}>Unpublish</button><button className="outline-button" type="button" onClick={() => void runBulkQuestionAction("bulk_flag")}>Flag for review</button><button className="outline-button" type="button" onClick={() => void runBulkQuestionAction("bulk_unflag")}>Remove flags</button><button className="outline-button" type="button" onClick={() => void runBulkQuestionAction("bulk_allowlist")}>Allowlist</button><button className="outline-button" type="button" onClick={() => void runBulkQuestionAction("bulk_remove_allowlist")}>Remove allowlist</button><button className="danger-button" type="button" onClick={() => void runBulkQuestionAction("bulk_delete")}>Delete</button><button className="text-button" type="button" onClick={() => setBankSelected([])}>Clear selection</button><span className="muted selection-order-note">Selection order becomes learner order.</span></div>}
            {showScenarioBuilder && <div className="shared-context scenario-builder"><label htmlFor="scenario-text">Shared scenario</label><textarea id="scenario-text" value={scenarioDraft} onChange={(event) => setScenarioDraft(event.target.value)} placeholder="Paste or write the scenario students must read before answering these questions…" /><div className="button-row"><button className="primary-button" type="button" disabled={bankSelected.length < 2 || !scenarioDraft.trim()} onClick={() => void groupSelectedQuestions()}>Save scenario group</button><button className="text-button" type="button" onClick={() => setShowScenarioBuilder(false)}>Cancel</button></div></div>}
            {!bankLoading && bankQuestions.length === 0 && (
              <div className="bank-empty-state">
                <p className="bank-empty-title">No questions</p>
                <p className="muted">
                  {hasActiveBankFilters
                    ? "No questions match these filters. Try widening or clearing them."
                    : "There are no questions in the bank yet."}
                </p>
                {hasActiveBankFilters && (
                  <button className="outline-button" type="button" onClick={clearBankFilters}>Clear filters</button>
                )}
              </div>
            )}
            {bankQuestions.length > 0 && (
              <div className="review-list">
                {bankQuestionGroups.map((group) => (
                  <section className={group.questions[0]?.context_group_id ? "admin-scenario-group" : undefined} key={group.id}>
                    {group.questions[0]?.context_group_id && <div className="admin-scenario-context"><button className="admin-scenario-expand" type="button" aria-expanded={expandedBankGroups.has(group.id)} onClick={() => toggleExpandedGroup(group.id)}><span><span className="case-study-label">{group.questions[0].shared_context?.trim() ? "Case-study set" : "Question group"} · {group.questions.length} linked questions</span><span>{group.questions[0].shared_context?.trim() || "Fixed learner order"}</span></span><span aria-hidden="true">{expandedBankGroups.has(group.id) ? "−" : "+"}</span></button><ScenarioSetEditor contextGroupId={group.questions[0].context_group_id} onChanged={() => { void loadBank(bankPage); }} triggerClassName="outline-button" triggerChildren="Edit set" /></div>}
                    {(!group.questions[0]?.context_group_id || expandedBankGroups.has(group.id)) && <div className="admin-scenario-questions">
                      {group.questions.map((question, index) => (
                        <article
                          key={question.id}
                          className={`review-row question-bank-row ${bankSelected.includes(question.id) ? "selected-bank-row" : ""}`}
                        >
                          <label className="bank-question-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select question ${question.id}`} checked={bankSelected.includes(question.id)} onChange={() => toggleBankSelection(question.id)} /></label>
                          <AdminQuestionQuickEdit
                            questionId={question.id}
                            forceAdmin
                            onSaved={(updated) => {
                              // Moving a standalone question into a scenario changes its list grouping.
                              // Keep this row mounted so the full-set editor can open successfully.
                              if (updated.context_group_id !== question.context_group_id) return;
                              setBankQuestions((current) => current.map((item) => item.id === updated.id
                                ? { ...item, ...updated, verification_status: "staff_corrected" }
                                : item));
                            }}
                            triggerChildren={<>
                              {question.context_group_id && <span className="scenario-question-number">Question {index + 1}</span>}
                              <p className="eyebrow">
                                #{question.id} · {courseLabel(question.course)}{question.topic ? ` · ${question.topic}` : " · Topic not assigned"} ·{" "}
                                {["material_supported", "staff_corrected"].includes(question.verification_status) && question.material_supported_key ? "live" : "not live"}{question.admin_flagged ? " · flagged for review" : ""}
                              </p>
                              <p>{cleanQuestionStem(question.stem)}</p>
                              {question.allowlisted && <span className="allowlist-badge">Allowlisted</span>}
                            </>}
                          />
                        </article>
                      ))}
                    </div>}
                  </section>
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
                <label className="page-size-control">Questions per page<select value={bankPageSize} onChange={(event) => { const pageSize = Number(event.target.value); setBankPageSize(pageSize); applyBankFilters(1, { search: bankSearch, course: bankCourse, topic: bankTopic, status: bankStatus, scenario: bankScenario, allowlist: bankAllowlist, pageSize, view: "list" }); }}><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
              </div>
            )}
          </section>
          {bankEditing && (
            <><div className="modal-backdrop" aria-hidden="true" /><section id="bank-question-editor" className="panel report-editor" role="dialog" aria-modal="true" aria-labelledby="bank-question-editor-title">
              <button className="modal-close-button" type="button" aria-label="Close question review" onClick={() => setBankEditing(null)}>×</button>
              <p className="eyebrow" id="bank-question-editor-title">Reviewing question #{bankEditing.id}</p>
              {bankEditing.admin_flag_note && <div className="admin-review-note"><strong>Review comment</strong><p>{bankEditing.admin_flag_note}</p></div>}
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
                        .sort(
                          (a, b) =>
                            (a.context_position ?? Number.MAX_SAFE_INTEGER) -
                              (b.context_position ?? Number.MAX_SAFE_INTEGER) ||
                            a.id - b.id,
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
                  {bankEditing.context_group_id && (
                    <div className="scenario-order-launch">
                      <ScenarioSetEditor
                        contextGroupId={bankEditing.context_group_id}
                        onChanged={() => { void loadBank(bankPage); }}
                      />
                      <span className="muted">Reorder questions with the arrow controls, then publish the full set.</span>
                    </div>
                  )}
                </div>
              )}
              <label>Question wording</label>
              <textarea
                value={editStem}
                onChange={(event) => setEditStem(event.target.value)}
              />
              <SourceMaterialSearch questionId={bankEditing.id} initialQuery={editStem} />
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
              </div>
            </section></>
          )}
        </>
      )}
      {tab === "reviews" && (
        <>
          <nav className="admin-tabs admin-subtabs" aria-label="Review sections">
            <button className={reviewSubTab === "flags" ? "active" : ""} type="button" onClick={() => setReviewSubTab("flags")}>Flags</button>
            <button className={reviewSubTab === "duplicates" ? "active" : ""} type="button" onClick={() => setReviewSubTab("duplicates")}>Duplicates</button>
          </nav>
          {reviewSubTab === "flags" && (
          <>
          <section className="panel report-queue">
            <p className="eyebrow">Learner reports</p>
            <h2>Review reported questions.</h2>
            <div className="review-queue-summary">
              <div>
                <strong>{reviewOpenTotal.toLocaleString()}</strong>
                <span> question{reviewOpenTotal === 1 ? "" : "s"} with open reviews</span>
              </div>
              <div className="review-queue-filters">
                <label>
                  Status
                  <select
                    value={reviewStatus}
                    onChange={(event) => {
                      setReviewPage(1);
                      setReviewStatus(event.target.value as "open" | "resolved" | "all");
                    }}
                  >
                    <option value="open">Open</option>
                    <option value="resolved">Resolved</option>
                    <option value="all">All reviews</option>
                  </select>
                </label>
                <label>
                  Course
                  <select
                    value={reviewCourse}
                    onChange={(event) => {
                      setReviewPage(1);
                      setReviewCourse(event.target.value);
                    }}
                  >
                    <option value="">All courses</option>
                    {COURSE_IDS.map((id) => (
                      <option key={id} value={id}>{COURSE_NAMES[id]}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <p className="muted review-filter-count">
              {reviewTotal.toLocaleString()} {reviewStatus === "all" ? "" : reviewStatus} review{reviewTotal === 1 ? "" : "s"} match these filters.
            </p>
            {!reports.length ? (
              <p className="muted">No reviews match these filters.</p>
            ) : (
              <div className="review-list">
                {reports.map((report) => (
                  <article className="review-row" key={report.question_id}>
                    <AdminQuestionQuickEdit
                      questionId={report.question_id}
                      forceAdmin
                      triggerClassName="submitted-review-editor-trigger"
                      onSaved={() => {
                        void load();
                      }}
                      onReviewResolved={() => {
                        setMsg("Review resolved.");
                        void load();
                      }}
                      triggerChildren={
                        <div className="submitted-review-summary">
                          <p className="eyebrow">
                            {report.queue_status} · {report.review_count} review{report.review_count === 1 ? "" : "s"}
                          </p>
                          <p>{report.stem}</p>
                          {report.reviews.map((review) => (
                            <p className="saved-note" key={`${review.review_source}-${review.id}`}>
                              {review.review_source === "admin_flag" ? "Admin flag" : review.category.replaceAll("_", " ")}: {review.details?.trim() || "No additional comment."}
                            </p>
                          ))}
                          <span className="source">Open full question editor</span>
                        </div>
                      }
                    />
                  </article>
                ))}
              </div>
            )}
            {reviewTotal > 0 && (
              <nav className="bank-pagination question-bank-pages" aria-label="Review pages">
                <button className="secondary" type="button" disabled={reviewPage <= 1} onClick={() => setReviewPage((page) => Math.max(1, page - 1))}>Previous</button>
                <div className="bank-page-numbers" aria-label="Review page numbers">
                  {reviewVisiblePages.map((page, index) => (
                    <span key={page}>
                      {index > 0 && page - reviewVisiblePages[index - 1] > 1 && (
                        <span className="page-ellipsis">…</span>
                      )}
                      <button
                        className={page === reviewPage ? "secondary active-page" : "secondary"}
                        type="button"
                        aria-current={page === reviewPage ? "page" : undefined}
                        onClick={() => setReviewPage(page)}
                      >
                        {page}
                      </button>
                    </span>
                  ))}
                </div>
                <button className="secondary" type="button" disabled={reviewPage >= reviewPageCount} onClick={() => setReviewPage((page) => Math.min(reviewPageCount, page + 1))}>Next</button>
                <label className="page-size-control">
                  Reviews per page
                  <select
                    value={reviewPageSize}
                    onChange={(event) => {
                      setReviewPage(1);
                      setReviewPageSize(Number(event.target.value));
                    }}
                  >
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
              </nav>
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
          {reviewSubTab === "duplicates" && (
            <section className="panel report-queue duplicate-sweep">
              <p className="eyebrow">Duplicate sweep</p>
              <h2>Find and merge duplicate questions.</h2>
              <div className="review-queue-summary">
                <div>
                  <strong>{dupRemovable.toLocaleString()}</strong>
                  <span> duplicate{dupRemovable === 1 ? "" : "s"} across {dupTotal.toLocaleString()} cluster{dupTotal === 1 ? "" : "s"}</span>
                </div>
                <div className="review-queue-filters">
                  <label>
                    Match
                    <select value={dupMode} onChange={(event) => { setDupPage(1); setDupMode(event.target.value as "exact" | "similar"); }}>
                      <option value="exact">Exact (scenario + question + options)</option>
                      <option value="similar">Similar (scenario + question, options differ)</option>
                    </select>
                  </label>
                  <label>
                    Course
                    <select value={dupCourse} onChange={(event) => { setDupPage(1); setDupCourse(event.target.value); }}>
                      <option value="">All courses</option>
                      {COURSE_IDS.map((id) => <option key={id} value={id}>{COURSE_NAMES[id]}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <p className="muted review-filter-count">
                {dupMode === "exact"
                  ? "Exact matches share the same scenario, question wording, and answer options."
                  : "Similar matches share the scenario and question wording; options or the correct answer may differ, so review carefully."}
              </p>
              {dupLoading ? (
                <p className="muted">Sweeping the question bank…</p>
              ) : !dupClusters.length ? (
                <p className="muted">No duplicate clusters match these filters. 🎉</p>
              ) : (
                <div className="duplicate-cluster-list">
                  {dupClusters.map((cluster) => {
                    const canonicalId = dupCanonical[cluster.key] ?? cluster.questions[0]?.id;
                    const kept = new Set(dupKept[cluster.key] ?? []);
                    const toDelete = cluster.questions.filter((q) => q.id !== canonicalId && !kept.has(q.id)).length;
                    const busy = dupBusyKey === cluster.key;
                    return (
                      <article className="duplicate-cluster" key={cluster.key}>
                        <header className="duplicate-cluster-head">
                          <div>
                            <span className="duplicate-count-badge">{cluster.count} copies</span>
                            <span className="muted"> · {courseLabel(cluster.questions[0]?.course ?? "")}</span>
                          </div>
                          <div className="button-row">
                            <button className="primary-button" type="button" disabled={busy || toDelete === 0} onClick={() => { void mergeDuplicateCluster(cluster); }}>
                              {busy ? "Working…" : `Merge & allowlist (delete ${toDelete})`}
                            </button>
                            <button className="outline-button" type="button" disabled={busy} onClick={() => { void ignoreDuplicateCluster(cluster); }}>Not duplicates</button>
                            <button className="danger-button" type="button" disabled={busy} onClick={() => { void deleteDuplicateCluster(cluster); }}>Delete all {cluster.count}</button>
                          </div>
                        </header>
                        {cluster.questions[0]?.shared_context?.trim() && (
                          <aside className="duplicate-scenario"><p className="case-study-label">Shared scenario</p><p>{cluster.questions[0].shared_context}</p></aside>
                        )}
                        <div className="duplicate-members">
                          {cluster.questions.map((question) => {
                            const isCanonical = question.id === canonicalId;
                            const isKept = kept.has(question.id);
                            return (
                              <div className={`duplicate-member${isCanonical ? " is-canonical" : ""}${!isCanonical && isKept ? " is-kept" : ""}`} key={question.id}>
                                <div className="duplicate-member-choose">
                                  <label className="duplicate-keep-radio">
                                    <input
                                      type="radio"
                                      name={`canonical-${cluster.key}`}
                                      checked={isCanonical}
                                      onChange={() => setDupCanonical((current) => ({ ...current, [cluster.key]: question.id }))}
                                    />
                                    <span>Keep this one</span>
                                  </label>
                                  {!isCanonical && (
                                    <label className="duplicate-keep-check">
                                      <input type="checkbox" checked={isKept} onChange={() => toggleDuplicateKept(cluster.key, question.id)} />
                                      <span>Leave separate</span>
                                    </label>
                                  )}
                                </div>
                                <div className="duplicate-member-body">
                                  <p className="eyebrow">
                                    #{question.id} · {question.topic || "No topic"} · {["material_supported", "staff_corrected"].includes(question.verification_status) ? "live" : "not live"} · {question.attempts} attempt{question.attempts === 1 ? "" : "s"}
                                    {question.allowlisted && " · allowlisted"}
                                  </p>
                                  <p className="duplicate-member-stem">{cleanQuestionStem(question.stem)}</p>
                                  <ul className="duplicate-member-options">
                                    {(question.options ?? []).map((option) => (
                                      <li key={option.key} className={option.key === question.material_supported_key ? "correct-option" : ""}>
                                        <strong>{option.key.toUpperCase()}</strong> {option.text}
                                      </li>
                                    ))}
                                  </ul>
                                  <AdminQuestionQuickEdit
                                    questionId={question.id}
                                    forceAdmin
                                    triggerClassName="text-button"
                                    triggerChildren="Edit this question"
                                    onSaved={() => { void loadDuplicates(dupPage, dupMode, dupCourse); }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {dupTotal > dupPageSize && (
                <nav className="bank-pagination question-bank-pages" aria-label="Duplicate pages">
                  <button className="secondary" type="button" disabled={dupPage <= 1 || dupLoading} onClick={() => void loadDuplicates(dupPage - 1, dupMode, dupCourse)}>Previous</button>
                  <span className="eyebrow">{dupPage} / {dupPageCount}</span>
                  <button className="secondary" type="button" disabled={dupPage >= dupPageCount || dupLoading} onClick={() => void loadDuplicates(dupPage + 1, dupMode, dupCourse)}>Next</button>
                </nav>
              )}
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
              <p className="eyebrow">Expert answer submissions</p>
              <h2>Expert answer queue.</h2>
              {items.map((item) => (
                <div key={item.id} className="review-row">
                  <div className="review-row-top">
                    <p>{cleanQuestionStem(item.stem)}</p>
                    {item.status === "awaiting_reviews" && !item.selected_key && (
                      <Link className="outline-button" href={`/expert?question=${item.id}`}>
                        Review answer
                      </Link>
                    )}
                  </div>
                  <p className="source">
                    {item.review_count} expert submission{item.review_count === 1 ? "" : "s"} · proposed {item.selected_key ?? "answer not selected"}
                  </p>
                  {item.selected_key && (
                    <div className="button-row">
                      <button type="button" onClick={() => { void act(item.id, "approve"); }}>Approve answer</button>
                      <button className="secondary" type="button" onClick={() => { void act(item.id, "reject"); }}>Reject</button>
                    </div>
                  )}
                </div>
              ))}
              {!items.length && <p className="muted">No expert submissions awaiting action.</p>}
            </section>
          </div>
        </>
      )}
      {tab === "team" && (
        <section className="panel admin-access">
          <p className="eyebrow">Team</p>
          <h2>Administrators.</h2>
          <p className="muted">
            Admins can manage users, experts, reviews, and the question bank.
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
