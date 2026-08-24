import Link from "next/link";
import type { Metadata } from "next";
import { StudyFooter } from "@/components/study-footer";

export const metadata: Metadata = {
  title: "Terms of Use · Call Ready",
  description: "The terms that govern your use of Call Ready.",
};

export default function TermsPage() {
  return (
    <main className="narrow legal-page">
      <Link className="back-link" href="/">← Back to home</Link>
      <h1 className="legal-title">Terms of Use</h1>
      <p className="legal-updated">Last updated: 11 August 2026</p>

      <p>
        These Terms of Use govern your access to and use of Call Ready (the &ldquo;Service&rdquo;), a free, non-commercial hobby project.
        By creating a profile or continuing as a guest, you agree to these terms. If you do not agree, please do not use the Service.
      </p>

      <h2>1. What Call Ready is</h2>
      <p>
        Call Ready is a study aid for the Nigerian Law School Bar Part II finals. It provides practice questions, explanations, rule cards,
        and timed sprints. It is a free, non-commercial hobby project in an ongoing beta phase, maintained by one person in his spare time.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>A private profile is created with your name and email. It is a lightweight profile, not a password-protected account, and is intended for your personal use.</li>
        <li>You are responsible for the activity that takes place under your profile. Do not share access with others or impersonate anyone.</li>
        <li>Guest sessions are anonymous and stored only in the browser you use; guest progress cannot be recovered elsewhere.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>copy, scrape, resell, or redistribute the question bank, explanations, or other content;</li>
        <li>attempt to disrupt, overload, reverse-engineer, or gain unauthorised access to the Service;</li>
        <li>use the Service to break any law or any rule of the Nigerian Law School or the Council of Legal Education, including rules on academic integrity and examination conduct; or</li>
        <li>upload unlawful, infringing, or harmful content through the tutor or feedback tools.</li>
      </ul>

      <h2>4. Not legal advice</h2>
      <p>
        The Service is exam-study support, not legal advice, and does not create a lawyer-client relationship. Content may contain errors.
        See our <Link href="/disclaimer">Disclaimer</Link> for the full detail — it forms part of these terms.
      </p>

      <h2>5. Intellectual property</h2>
      <p>
        The Service, its design, and original content are owned by us or our licensors. Practice questions are drawn from and adapted from
        past examination papers and study materials; see our <Link href="/copyright">Copyright &amp; takedown</Link> page. Your access is a
        personal, non-transferable, revocable licence to use the Service for your own exam preparation only.
      </p>

      <h2>6. Content you submit</h2>
      <p>
        Notes, reported issues, and tutor messages you submit remain yours, but you grant us a licence to store and process them to operate
        and improve the Service. Expert reviewers who contribute corrections agree that those edits may be used within the Service.
      </p>

      <h2>7. Availability and changes</h2>
      <p>
        As a beta service, features may change, break, or be withdrawn, and access may be interrupted. We may modify or discontinue the
        Service, or update these terms, at any time. Continued use after a change means you accept the updated terms.
      </p>

      <h2>8. Disclaimers and liability</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, including as to accuracy,
        fitness for a particular purpose, or that it will help you pass any examination. To the fullest extent permitted by law, we are not
        liable for any indirect or consequential loss, or for any loss arising from reliance on the content or from examination outcomes.
        As a free project, nothing here is intended to exclude any liability that cannot be excluded under Nigerian law.
      </p>

      <h2>9. Termination</h2>
      <p>We may suspend or terminate access that breaches these terms. You may stop using the Service and delete your account at any time from your <Link href="/account">account page</Link>.</p>

      <h2>10. Governing law</h2>
      <p>
        These terms are governed by the laws of the Federal Republic of Nigeria, and disputes are subject to the courts of Nigeria.
      </p>

      <h2>11. Contact</h2>
      <p>Questions about these terms: <a href="mailto:hi@raymondchuma.com">hi@raymondchuma.com</a>.</p>

      <p className="legal-disclaimer-note">
        See also our <Link href="/privacy">Privacy Policy</Link>, <Link href="/disclaimer">Disclaimer</Link>, and <Link href="/copyright">Copyright &amp; takedown</Link> pages.
      </p>
      <StudyFooter />
    </main>
  );
}
