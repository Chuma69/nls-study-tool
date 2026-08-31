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
      <h1 className="legal-title">Privacy Policy</h1>
      <p className="legal-updated">Last updated: 31 August 2026</p>

      <p>
        Call Ready is a <strong>free, non-commercial hobby project</strong> built to help candidates prepare for the Nigerian Law School
        Bar Part II finals. This policy explains what personal data it collects, why, how it is protected, and the choices you have. It is
        written to align with the Nigeria Data Protection Act 2023 (NDPA).
      </p>
      <p>
        For any privacy question or request, contact <a href="mailto:hi@callready.ng">hi@callready.ng</a>.
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
        <li>To communicate with you about Call Ready — for example, asking for feedback to improve it, and sharing study tips and exam-preparation guidance (our legitimate interest in supporting, and hearing from, the people who use this free project). These emails go only to registered users, never guests, and every one includes a one-click unsubscribe so you can opt out at any time.</li>
      </ul>

      <h2>How your data is stored and shared</h2>
      <p>
        We never sell your data, and we never share it with third parties for their own marketing. It is kept only with the infrastructure
        and email providers needed to run the project and to communicate with you, who process it on our behalf:
      </p>
      <ul>
        <li><strong>Vercel</strong> — application hosting (servers located in the United States).</li>
        <li><strong>Neon</strong> — our PostgreSQL database (located in the United States).</li>
        <li><strong>Resend</strong> — delivery of essential service emails, such as reviewer invitations (servers in the United States).</li>
        <li><strong>Zoho Campaigns</strong> — delivery of the feedback requests and study-tip emails described above, sent to registered users (servers in the United States).</li>
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
        <li><strong>Opt out of emails</strong> — unsubscribe from feedback and study-tip emails using the link in any such email, or by emailing <a href="mailto:hi@callready.ng">hi@callready.ng</a>. This never affects essential service messages or your access to the tool.</li>
      </ul>
      <p>
        For corrections or any request you cannot complete in-app, email <a href="mailto:hi@callready.ng">hi@callready.ng</a>. You
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
