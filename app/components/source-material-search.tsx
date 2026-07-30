"use client";

import { useState } from "react";

type SourceResult = { id: number; content: string; page_locator: string | null; chunk_index: number; document: string; rel_source_path: string | null };

export function SourceMaterialSearch({ questionId, initialQuery, onUseAsScenario }: { questionId: number; initialQuery: string; onUseAsScenario?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setLoading(true); setError(""); setSearched(true);
    const params = new URLSearchParams({ questionId: String(questionId), query: query.trim() });
    const response = await fetch(`/api/admin/source-search?${params}`); const data = await response.json();
    setLoading(false);
    if (!response.ok) { setResults([]); setError(data.error ?? "Could not search the source materials."); return; }
    setResults(data.results ?? []);
  }

  return <div className="source-material-search">
    <button className="secondary source-search-toggle" type="button" onClick={() => setOpen((current) => !current)}>{open ? "Close past-question search" : "Search original past questions"}</button>
    {open && <div className="source-search-panel">
      <p className="muted">Searches only the original past-question papers to recover exact wording, missing context and case studies. It does not search textbooks or use AI credits.</p>
      <div className="source-search-controls"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Paste a distinctive phrase from the question…" /><button type="button" disabled={loading || query.trim().length < 3} onClick={() => { void search(); }}>{loading ? "Searching…" : "Search"}</button></div>
      {error && <p className="error">{error}</p>}
      {!loading && searched && !error && results.length === 0 && <p className="muted">No matching passages found. Try a shorter or more distinctive phrase.</p>}
      {results.length > 0 && <div className="source-search-results">{results.map((result) => <article key={result.id}>
        <div className="source-result-heading"><strong>{result.document}</strong><span className="eyebrow">{result.page_locator || `Chunk ${result.chunk_index + 1}`}</span></div>
        <p className="source-result-path">{result.rel_source_path}</p>
        <p>{result.content}</p>
        <div className="button-row"><button className="secondary" type="button" onClick={() => { void navigator.clipboard.writeText(result.content); }}>Copy passage</button>{onUseAsScenario && <button className="secondary" type="button" onClick={() => onUseAsScenario(result.content)}>Use as case study</button>}</div>
      </article>)}</div>}
    </div>}
  </div>;
}
