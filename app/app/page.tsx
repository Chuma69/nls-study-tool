export default function Home() {
  return (
    <main>
      <h1 style={{ marginBottom: "0.25rem" }}>NLS Study Tool</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Nigerian Law School — Bar Part II Finals
      </p>

      <p>
        Phase 0 scaffold is live. The study features arrive in later phases:
      </p>
      <ul style={{ color: "var(--muted)" }}>
        <li>MCQ trainer (Phase 3)</li>
        <li>Grounded tutor chat with saved history (Phase 4)</li>
        <li>Progress dashboard (Phase 5)</li>
      </ul>

      <p style={{ marginTop: "2rem", fontSize: "0.9rem" }}>
        Database status:{" "}
        <a href="/api/health">/api/health</a>
      </p>

      <footer
        style={{
          marginTop: "3rem",
          fontSize: "0.8rem",
          color: "var(--muted)",
          borderTop: "1px solid var(--line-soft)",
          paddingTop: "1rem",
        }}
      >
        Exam-study support grounded in your own materials. Not legal advice.
      </footer>
    </main>
  );
}
