"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Home", "/"],
  ["Sprints", "/sprint"],
  ["Progress", "/progress"],
  ["Saved", "/saved"],
] as const;

export function SiteNav() {
  const pathname = usePathname();
  return <header className="site-nav"><div className="site-nav-inner">
    <Link className="brand" href="/"><span className="brand-name">Call Ready</span><span className="brand-meta">Bar Part II Prep</span></Link>
    <nav className="nav-links" aria-label="Primary navigation">
      {links.map(([label, href]) => <Link key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}>{label}</Link>)}
    </nav>
  </div></header>;
}
