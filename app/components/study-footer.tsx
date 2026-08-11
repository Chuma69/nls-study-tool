import Link from "next/link";

export function StudyFooter() {
  return (
    <footer>
      <span>Call Ready is a free, non-commercial hobby project. This beta-phase tool is exam-study support, not legal advice, and mistakes can happen — please report anything you spot. Answers draw on loaded study materials and reviews by legal experts.</span>
      <nav className="footer-links" aria-label="Legal">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/disclaimer">Disclaimer</Link>
        <Link href="/copyright">Copyright</Link>
      </nav>
      {/* <span className="built-for">Built for <span className="yienor">Yienor</span><span className="outline-heart" aria-label="love">♡</span></span> */}
    </footer>
  );
}
