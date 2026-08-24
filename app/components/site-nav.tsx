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

export function SiteNav() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = () => fetch("/api/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled) setSignedIn(Boolean(data?.user)); })
      .catch(() => { if (!cancelled) setSignedIn(false); });
    void check();
    // The home page signs a guest/profile in without navigating, so it fires this event
    // to let the nav reappear (and disappear again on sign-out).
    window.addEventListener("callready:session", check);
    return () => { cancelled = true; window.removeEventListener("callready:session", check); };
  }, [pathname]);

  // Every nav destination requires a session, so before the user signs in we keep the branded
  // bar but drop the menu and centre the logo.
  return <header className={`site-nav${signedIn ? "" : " site-nav-brand-only"}`}><div className="site-nav-inner">
    <Link className="brand" href="/"><span className="brand-name">Call Ready</span><span className="brand-meta">Bar Part II Prep</span></Link>
    {signedIn && <nav className="nav-links" aria-label="Primary navigation">
      {links.map(([label, href]) => <Link key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}>{label}</Link>)}
    </nav>}
  </div></header>;
}
