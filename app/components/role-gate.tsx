"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { EXPERT_MODE_EVENT, getExpertMode } from "@/lib/expert-mode";

// Pages an expert account is allowed to see while in review mode. Everything else
// redirects to /expert. When the reviewer switches to learner mode, the lock lifts.
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
        if (data?.user?.role === "expert" && getExpertMode() === "review" && !expertAllowed(pathname)) router.replace("/expert");
      })
      .catch(() => {});
    void check();
    // Re-check when a session starts (home sign-in) or the reviewer switches modes.
    window.addEventListener("callready:session", check);
    window.addEventListener(EXPERT_MODE_EVENT, check);
    return () => { cancelled = true; window.removeEventListener("callready:session", check); window.removeEventListener(EXPERT_MODE_EVENT, check); };
  }, [pathname, router]);
  return null;
}
