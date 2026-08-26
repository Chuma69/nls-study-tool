"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EXPERT_MODE_EVENT, getExpertMode, setExpertMode, type ExpertMode } from "@/lib/expert-mode";

const links = [
  ["Home", "/"],
  ["Sprints", "/sprint"],
  ["Progress", "/progress"],
  ["Saved", "/saved"],
] as const;

type Role = "learner" | "expert" | "admin";

export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [mode, setMode] = useState<ExpertMode>("review");
  useEffect(() => {
    let cancelled = false;
    const check = () => fetch("/api/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled) setRole((data?.user?.role as Role) ?? null); })
      .catch(() => { if (!cancelled) setRole(null); });
    const syncMode = () => setMode(getExpertMode());
    void check();
    syncMode();
    // The home page signs a guest/profile/expert in without navigating, so it fires this
    // event to let the nav update (and reset on sign-out).
    window.addEventListener("callready:session", check);
    window.addEventListener(EXPERT_MODE_EVENT, syncMode);
    return () => { cancelled = true; window.removeEventListener("callready:session", check); window.removeEventListener(EXPERT_MODE_EVENT, syncMode); };
  }, [pathname]);

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" }).catch(() => {});
    setExpertMode("review");
    window.dispatchEvent(new Event("callready:session"));
    window.location.href = "/";
  }
  function enterLearnerMode() { setExpertMode("learner"); router.push("/"); }
  function enterReviewMode() { setExpertMode("review"); router.push("/expert"); }

  // Signed out: keep the branded bar but centre the logo and drop the menu — every
  // destination requires a session.
  if (!role) {
    return <header className="site-nav site-nav-brand-only"><div className="site-nav-inner">
      <Link className="brand" href="/"><span className="brand-name">Call Ready</span><span className="brand-meta">Bar Part II Prep</span></Link>
    </div></header>;
  }

  // Expert accounts default to the review view but can switch into learner mode to study.
  if (role === "expert") {
    if (mode === "learner") {
      return <header className="site-nav"><div className="site-nav-inner">
        <Link className="brand" href="/"><span className="brand-name">Call Ready</span><span className="brand-meta">Learner Mode</span></Link>
        <nav className="nav-links" aria-label="Primary navigation">
          {links.map(([label, href]) => <Link key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}>{label}</Link>)}
          <button type="button" className="nav-link nav-link-button" onClick={enterReviewMode}>Review panel</button>
          <button type="button" className="nav-link nav-link-button" onClick={() => { void signOut(); }}>Sign out</button>
        </nav>
      </div></header>;
    }
    return <header className="site-nav"><div className="site-nav-inner">
      <Link className="brand" href="/expert"><span className="brand-name">Call Ready</span><span className="brand-meta">Expert Review</span></Link>
      <nav className="nav-links" aria-label="Primary navigation">
        <button type="button" className="nav-link nav-link-button" onClick={enterLearnerMode}>Learner mode</button>
        <button type="button" className="nav-link nav-link-button" onClick={() => { void signOut(); }}>Sign out</button>
      </nav>
    </div></header>;
  }

  return <header className="site-nav"><div className="site-nav-inner">
    <Link className="brand" href="/"><span className="brand-name">Call Ready</span><span className="brand-meta">Bar Part II Prep</span></Link>
    <nav className="nav-links" aria-label="Primary navigation">
      {links.map(([label, href]) => <Link key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}>{label}</Link>)}
    </nav>
  </div></header>;
}
