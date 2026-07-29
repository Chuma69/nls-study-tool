"use client";

import { useEffect } from "react";

export function CaseStudy({ text, modal = false, onClose }: { text: string; modal?: boolean; onClose?: () => void }) {
  useEffect(() => {
    if (!modal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [modal]);

  const content = <div className="shared-context student-scenario"><p className="case-study-label">Case study</p><p>{text}</p></div>;
  if (!modal) return content;
  return <div className="case-study-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
    <section className="case-study-dialog" role="dialog" aria-modal="true" aria-labelledby="case-study-title">
      <button type="button" className="modal-close" aria-label="Close case study" onClick={onClose}>×</button>
      <p className="eyebrow" id="case-study-title">Case study</p>
      <div className="case-study-copy">{text}</div>
    </section>
  </div>;
}
