import Link from "next/link";
import type { Metadata } from "next";
import { StudyFooter } from "@/components/study-footer";

export const metadata: Metadata = {
  title: "Copyright & Takedown · Call Ready",
  description: "Source acknowledgements and how to request a takedown.",
};

export default function CopyrightPage() {
  return (
    <main className="narrow legal-page">
      <Link className="back-link" href="/">← Back to home</Link>
      <p className="eyebrow">Copyright &amp; takedown</p>
      <h1>Sources and how to raise a concern.</h1>
      <p className="legal-updated">Last updated: 11 August 2026</p>

      <h2>Purpose and acknowledgements</h2>
      <p>
        Call Ready is a free, non-commercial hobby project for candidates preparing for the Nigerian Law School Bar Part II finals. Its practice questions are drawn from, and adapted from, past examination questions and publicly
        circulated study materials. We acknowledge the Council of Legal Education, the Nigerian Law School, and the original authors and
        publishers of those materials as the source of the underlying content. Call Ready claims no ownership over that underlying material,
        and no affiliation with or endorsement by the Council of Legal Education or the Nigerian Law School is implied.
      </p>

      <h2>What we own</h2>
      <p>
        The Call Ready name, design, software, structure, topic taxonomy, and original explanations and editorial notes written by our team
        are our intellectual property or that of our licensors.
      </p>

      <h2>For personal study only</h2>
      <p>
        Access to the material through Call Ready is for your own exam preparation. You may not copy, scrape, republish, redistribute, or
        sell the questions, explanations, or other content. See our <Link href="/terms">Terms of Use</Link>.
      </p>

      <h2>Copyright concerns &amp; takedown requests</h2>
      <p>
        We respect intellectual-property rights. If you are a rights holder and believe material on Call Ready infringes your copyright, or
        should not be included, tell us and we will review and, where appropriate, promptly remove it. Please email
        <a href="mailto:hi@raymondchuma.com"> hi@raymondchuma.com</a> with:
      </p>
      <ul>
        <li>your name and contact details;</li>
        <li>identification of the work concerned and where it appears in Call Ready (a link or screenshot helps);</li>
        <li>a statement of the basis of your concern; and</li>
        <li>confirmation that you are the rights holder or authorised to act on their behalf.</li>
      </ul>
      <p>As this is a one-person hobby project, we will acknowledge and act on takedown requests as soon as we reasonably can.</p>

      <p className="legal-disclaimer-note">
        See also our <Link href="/privacy">Privacy Policy</Link>, <Link href="/terms">Terms of Use</Link>, and <Link href="/disclaimer">Disclaimer</Link> pages.
      </p>
      <StudyFooter />
    </main>
  );
}
