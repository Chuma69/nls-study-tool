"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  ["Home", "/"],
  ["Sprints", "/sprint"],
  ["Progress", "/progress"],
  ["Saved", "/saved"],
] as const;

type Role = "learner" | "expert" | "admin";

export function SiteNav() {
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () => fetch("/api/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled) setRole((data?.user?.role as Role) ?? null); })
      .catch(() => { if (!cancelled) setRole(null); });
    void check();
    // The home page signs a guest/profile/expert in without navigating, so it fires this
    // event to let the nav update (and reset on sign-out).
    window.addEventListener("callready:session", check);
    return () => { cancelled = true; window.removeEventListener("callready:session", check); };
  }, [pathname]);

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" }).catch(() => {});
    window.dispatchEvent(new Event("callready:session"));
    window.location.href = "/";
  }

  // Signed out: keep the branded bar but centre the logo and drop the menu — every
  // destination requires a session.
  if (!role) {
    return <header className="site-nav site-nav-brand-only"><div className="site-nav-inner">
      <Link className="brand" href="/"><span className="brand-name">Call Ready</span><span className="brand-meta">Bar Part II Prep</span></Link>
    </div></header>;
  }

  // Experts only ever use the review view, so they get the brand plus a sign-out — no learner menu.
  if (role === "expert") {
    return <header className="site-nav"><div className="site-nav-inner">
      <Link className="brand" href="/expert"><span className="brand-name">Call Ready</span><span className="brand-meta">Expert Review</span></Link>
      <nav className="nav-links" aria-label="Primary navigation">
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
