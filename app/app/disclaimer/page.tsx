import Link from "next/link";
import type { Metadata } from "next";
import { StudyFooter } from "@/components/study-footer";

export const metadata: Metadata = {
  title: "Disclaimer · Call Ready",
  description: "Important limits on how to rely on Call Ready.",
};

export default function DisclaimerPage() {
  return (
    <main className="narrow legal-page">
      <Link className="back-link" href="/">← Back to home</Link>
      <p className="eyebrow">Disclaimer</p>
      <h1>Read this before you rely on it.</h1>
      <p className="legal-updated">Last updated: 11 August 2026</p>

      <p>
        Call Ready is a <strong>free, non-commercial hobby project</strong>. It is offered as-is to help with revision, with no guarantees.
      </p>

      <h2>Exam-study support, not legal advice</h2>
      <p>
        Call Ready is a tool to help you revise for the Nigerian Law School Bar Part II finals. Nothing on the Service is legal advice, and
        using it does not create a lawyer-client relationship. Do not rely on it for any real-world legal matter — consult a qualified legal
        practitioner for that.
      </p>

      <h2>Content can be wrong</h2>
      <p>
        This is a beta-phase project and mistakes can happen. Questions, suggested answers, and explanations draw on loaded study materials
        and reviews by legal experts, but they may be incomplete, out of date, or incorrect, and the law changes over time. Always verify
        important points against primary sources — statutes, rules of court, and current Nigerian Law School materials — and your lecturers.
      </p>

      <h2>No guarantee of results</h2>
      <p>
        We do not promise that using Call Ready will improve your marks or that you will pass any examination. Your results depend on many
        factors outside our control.
      </p>

      <h2>Academic integrity</h2>
      <p>
        Use Call Ready only for legitimate revision. You are responsible for following the Nigerian Law School and Council of Legal
        Education rules on examination conduct and academic integrity. Do not use the Service to cheat or in any way a rule forbids.
      </p>

      <h2>Report an issue</h2>
      <p>
        Spotted a wrong answer or a problem? Use the &ldquo;Report a problem with this question&rdquo; link in practice, or email
        <a href="mailto:hi@raymondchuma.com"> hi@raymondchuma.com</a>. Your reports help us fix the bank.
      </p>

      <p className="legal-disclaimer-note">
        See also our <Link href="/privacy">Privacy Policy</Link>, <Link href="/terms">Terms of Use</Link>, and <Link href="/copyright">Copyright &amp; takedown</Link> pages.
      </p>
      <StudyFooter />
    </main>
  );
}
