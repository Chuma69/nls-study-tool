import Link from "next/link";
import type { Metadata } from "next";
import { StudyFooter } from "@/components/study-footer";

export const metadata: Metadata = {
  title: "Privacy Policy · Call Ready",
  description: "How Call Ready collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <main className="narrow legal-page">
      <Link className="back-link" href="/">← Back to home</Link>
      <p className="eyebrow">Privacy Policy</p>
      <h1>Your data, plainly.</h1>
      <p className="legal-updated">Last updated: 11 August 2026</p>

      <p>
        Call Ready is a <strong>free, non-commercial hobby project</strong> built to help candidates prepare for the Nigerian Law School
        Bar Part II finals. This policy explains what personal data it collects, why, how it is protected, and the choices you have. It is
        written to align with the Nigeria Data Protection Act 2023 (NDPA).
      </p>
      <p>
        For any privacy question or request, contact <a href="mailto:hi@raymondchuma.com">hi@raymondchuma.com</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Profile details</strong> — if you create a private profile, your name and email address.</li>
        <li><strong>Guest sessions</strong> — if you continue as a guest, no name or email is collected; a temporary anonymous profile holds your study data for that browser only.</li>
        <li><strong>Study activity</strong> — the questions you attempt, the answers you choose, whether they were correct, time spent, saved questions, your personal notes, practice-session timing, and any questions you report.</li>
        <li><strong>Technical data</strong> — a secure, essential session cookie and basic request information (such as a truncated IP address) used to keep you signed in and to rate-limit abuse.</li>
      </ul>
      <p>We do <strong>not</strong> collect payment information, and we do not use advertising or third-party analytics trackers.</p>

      <h2>Why we use it (lawful basis)</h2>
      <ul>
        <li>To provide the service — deliver questions, record your progress, and show your results (performance of the service you request, and your consent).</li>
        <li>To keep the service secure and reliable — authentication and rate-limiting (our legitimate interest).</li>
        <li>To improve question quality — aggregated, de-identified accuracy data helps our reviewers fix weak questions.</li>
      </ul>

      <h2>How your data is stored and shared</h2>
      <p>
        Your data is not sold or shared for marketing. It is kept only with the infrastructure providers needed to run the project, who
        process it on our behalf:
      </p>
      <ul>
        <li><strong>Vercel</strong> — application hosting (servers located in the United States).</li>
        <li><strong>Neon</strong> — our PostgreSQL database (located in the United States).</li>
      </ul>
      <p>
        Because these providers are based in the United States, your data is transferred and processed outside Nigeria. By creating a
        profile or continuing as a guest, you consent to this cross-border processing, which is carried out under the providers&rsquo;
        contractual data-protection commitments.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Registered profiles and their study data are kept until you delete your account. Guest data is tied to an anonymous profile and is
        removed during routine clean-up once it is inactive.
      </p>

      <h2>Your rights</h2>
      <p>Under the NDPA you can access, correct, export, or delete your data, and withdraw consent. Call Ready already lets you do the main ones yourself:</p>
      <ul>
        <li><strong>Export</strong> — download everything tied to your profile from your <Link href="/account">account page</Link>.</li>
        <li><strong>Delete</strong> — permanently delete your account and associated data from your <Link href="/account">account page</Link>. This cannot be undone.</li>
        <li><strong>End a session</strong> — sign out at any time from the home screen.</li>
      </ul>
      <p>
        For corrections or any request you cannot complete in-app, email <a href="mailto:hi@raymondchuma.com">hi@raymondchuma.com</a>. You
        also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC).
      </p>

      <h2>Children</h2>
      <p>Call Ready is intended for law graduates preparing for Bar finals and is not directed at children under 18.</p>

      <h2>Changes</h2>
      <p>This policy may be updated as the project evolves. Material changes will be reflected by the &ldquo;last updated&rdquo; date above.</p>

      <p className="legal-disclaimer-note">
        This is a free, beta-phase hobby project. See also our <Link href="/terms">Terms of Use</Link>, <Link href="/disclaimer">Disclaimer</Link>, and <Link href="/copyright">Copyright &amp; takedown</Link> pages.
      </p>
      <StudyFooter />
    </main>
  );
}
