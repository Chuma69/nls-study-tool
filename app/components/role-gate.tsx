"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// Pages an expert account is allowed to see. Everything else redirects to /expert,
// so a reviewer's whole experience is the review view.
const EXPERT_ALLOWED = ["/expert", "/privacy", "/terms", "/disclaimer", "/copyright"];

function expertAllowed(pathname: string) {
  return EXPERT_ALLOWED.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function RoleGate() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    const check = () => fetch("/api/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.user?.role === "expert" && !expertAllowed(pathname)) router.replace("/expert");
      })
      .catch(() => {});
    void check();
    // Re-check when the home page signs an invited expert in without navigating.
    window.addEventListener("callready:session", check);
    return () => { cancelled = true; window.removeEventListener("callready:session", check); };
  }, [pathname, router]);
  return null;
}
