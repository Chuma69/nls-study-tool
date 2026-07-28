"""Ingestion CLI.

Subcommands:
  check    Verify Neon connectivity + schema (Phase 0).
  unzip    Expand raw_zips/*.zip into raw_materials/ (nested, dedup, junk-skip).
  build    Extract -> tag -> chunk -> de-dup -> build the SQLite FTS index.
  ingest   unzip + build in one go.
  stats    Print current knowledge-base stats + on-disk index size.

Examples:
  python -m nls_ingest.main unzip
  python -m nls_ingest.main build            # text only (fast); flags scanned PDFs
  python -m nls_ingest.main build --ocr      # also OCR scanned PDFs (slow)
  python -m nls_ingest.main build --limit 50 # sample run
  python -m nls_ingest.main stats
"""

from __future__ import annotations

import argparse
import sys

from . import config


def cmd_check(_: argparse.Namespace) -> int:
    from . import db
    try:
        counts = db.check_connection()
    except Exception as exc:  # noqa: BLE001
        print(f"✗ Neon connection failed: {exc}", file=sys.stderr)
        return 1
    print("✓ Connected to Neon and schema present.")
    print(f"  users:     {counts['users']}")
    print(f"  questions: {counts['questions']}")
    return 0


def cmd_unzip(_: argparse.Namespace) -> int:
    from . import unzip
    print(f"Expanding {config.RAW_ZIPS_DIR} -> {config.RAW_MATERIALS_DIR} …")
    stats = unzip.expand_all()
    print(f"✓ Expanded {stats['archives']} archives "
          f"({stats['nested_zips']} nested), {stats['files']} files extracted.")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from . import pipeline
    print(f"Building knowledge base (ocr={args.ocr}, limit={args.limit}) …")
    counts = pipeline.build(ocr=args.ocr, limit=args.limit)
    kb = counts.pop("kb_stats")
    print("\n✓ Build complete.")
    for k, v in counts.items():
        print(f"  {k:20} {v}")
    print("  ── knowledge base ──")
    for k, v in kb.items():
        print(f"  {k:20} {v}")
    _print_size()
    return 0


def cmd_ingest(args: argparse.Namespace) -> int:
    rc = cmd_unzip(args)
    if rc != 0:
        return rc
    return cmd_build(args)


def cmd_chunks(_: argparse.Namespace) -> int:
    from . import build_chunks
    print("Building provider-neutral chunk artifact from the Codex corpus …")
    s = build_chunks.build()
    print("\n✓ Chunk artifact built.")
    for k in ("documents", "past_question_docs", "no_page_docs", "chunks_total",
              "chunks_kept", "chunks_deduped", "dedup_reduction_pct",
              "pages_located", "content_mb_kept", "est_neon_mb"):
        print(f"  {k:22} {s[k]}")
    fit = "FITS free Neon (0.5 GB)" if s["est_neon_mb"] < 500 else "EXCEEDS free Neon 0.5 GB"
    print(f"  {'gate':22} {fit}")
    return 0


def cmd_migrate(_: argparse.Namespace) -> int:
    from . import db
    files = sorted(config.MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("No migration files found.")
        return 1
    with db.connect() as conn:
        with conn.cursor() as cur:
            import re
            for f in files:
                sql = f.read_text(encoding="utf-8")
                # Strip line comments first (they may contain ';'), then split.
                sql = re.sub(r"--[^\n]*", "", sql)
                stmts = [s.strip() for s in sql.split(";") if s.strip()]
                for s in stmts:
                    cur.execute(s)
                print(f"✓ applied {f.name} ({len(stmts)} statements)")
    return 0


def cmd_load(_: argparse.Namespace) -> int:
    from . import load_neon
    print("Loading chunk artifact into Neon (idempotent) …")
    c = load_neon.load()
    print("\n✓ Loaded.")
    print(f"  sources            {c['sources']}")
    print(f"  chunks             {c['chunks']}")
    print(f"  chunks table size  {c['chunks_table_size']} (real gate measurement)")
    print(f"  database size      {c['database_size']} / 512 MB free tier")
    return 0


def cmd_stats(_: argparse.Namespace) -> int:
    from .kbindex import KnowledgeBase
    if not config.KB_INDEX_PATH.exists():
        print("No knowledge base built yet.")
        return 0
    kb = KnowledgeBase()
    for k, v in kb.stats().items():
        print(f"  {k:20} {v}")
    kb.close()
    _print_size()
    return 0


def _print_size() -> None:
    if config.KB_INDEX_PATH.exists():
        mb = config.KB_INDEX_PATH.stat().st_size / (1024 * 1024)
        print(f"  {'index_size_mb':20} {mb:.1f}")
        threshold = "bundle with app (< 50 MB)" if mb < 50 else "serve from Vercel Blob"
        print(f"  {'hosting':20} {threshold}")


def cmd_extract_questions(args: argparse.Namespace) -> int:
    from . import question_extract
    if args.dry_run:
        report = question_extract.dry_run()
        print("✓ Dry-run complete — no OpenAI API calls were made.")
        print(f"  report_id                 {report['report_id']}")
        print(f"  model                     {report['model_id']}")
        print(f"  papers planned            {report['papers_planned']}")
        print(f"  classifications           {report['by_classification']}")
        print(f"  estimated input tokens    {report['estimated_input_tokens']:,}")
        print(f"  estimated output tokens   {report['estimated_output_tokens']:,}")
        print(f"  estimated cost (USD)      ${report['estimated_cost_usd']:.4f}")
        print(f"  recommended hard cap      ${report['recommended_cap_usd']:.2f}")
        print(f"  report                    {config.QUESTION_DRY_RUN_PATH}")
        return 0
    if not args.approve_dry_run or args.max_cost_usd is None:
        print("Paid extraction is blocked. First run --dry-run, then use "
              "--approve-dry-run REPORT_ID --max-cost-usd CAP after owner approval.", file=sys.stderr)
        return 2
    result = question_extract.run(args.approve_dry_run, args.max_cost_usd)
    print("✓ Question extraction run finished.")
    for key, value in result.items():
        print(f"  {key:24} {value}")
    return 0


def cmd_verify_questions(args: argparse.Namespace) -> int:
    from . import question_verify
    if args.dry_run:
        report = question_verify.dry_run()
        print("✓ Verification dry-run complete — no OpenAI API calls were made.")
        for key in ("report_id", "model_id", "questions_planned", "questions_excluded",
                    "estimated_input_tokens", "estimated_output_tokens", "estimated_cost_usd",
                    "recommended_cap_usd"):
            print(f"  {key:26} {report[key]}")
        return 0
    if not args.approve_dry_run or args.max_cost_usd is None:
        print("Paid verification is blocked. First run --dry-run, then approve its report ID and cap.", file=sys.stderr)
        return 2
    result = question_verify.run(args.approve_dry_run, args.max_cost_usd)
    print("✓ Question verification run finished.")
    for key, value in result.items(): print(f"  {key:26} {value}")
    return 0


def cmd_calibrate_reasoning(args: argparse.Namespace) -> int:
    from . import reasoning_calibration
    report = reasoning_calibration.dry_run(args.sample_size)
    print("✓ Reasoning calibration dry-run complete — no OpenAI API calls were made.")
    for key in ("report_id", "model_id", "questions_planned", "estimated_input_tokens", "estimated_output_tokens", "estimated_cost_usd", "recommended_cap_usd"):
        print(f"  {key:26} {report[key]}")
    return 0

def cmd_run_reasoning_calibration(args: argparse.Namespace) -> int:
    from . import reasoning_calibration
    if not args.approve_dry_run or args.max_cost_usd is None:
        print("Reasoning pilot is blocked until its dry-run report and cap are approved.", file=sys.stderr); return 2
    result = reasoning_calibration.run(args.approve_dry_run, args.max_cost_usd, args.sample_size, args.promote)
    print("✓ Reasoning calibration finished.")
    for key, value in result.items(): print(f"  {key:26} {value}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="nls_ingest", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("check", help="Verify Neon connectivity.").set_defaults(func=cmd_check)
    sub.add_parser("unzip", help="Expand raw_zips into raw_materials.").set_defaults(func=cmd_unzip)
    sub.add_parser("stats", help="Show KB stats + index size.").set_defaults(func=cmd_stats)
    sub.add_parser("chunks", help="Build chunk artifact from Codex corpus + measure size.").set_defaults(func=cmd_chunks)
    sub.add_parser("migrate", help="Apply db/migrations/*.sql to Neon.").set_defaults(func=cmd_migrate)
    sub.add_parser("load", help="Load chunk artifact into Neon (needs DATABASE_URL).").set_defaults(func=cmd_load)

    pq = sub.add_parser("extract-questions", help="Extract structured MCQ + theory prompts from past papers.")
    pq.add_argument("--dry-run", action="store_true", help="Estimate cost and write a review report; never calls OpenAI.")
    pq.add_argument("--approve-dry-run", help="Exact report ID approved by the owner for a paid run.")
    pq.add_argument("--max-cost-usd", type=float, help="Hard spend ceiling for the paid run.")
    pq.set_defaults(func=cmd_extract_questions)

    vq = sub.add_parser("verify-questions", help="Verify MCQs only from retrieved study materials.")
    vq.add_argument("--dry-run", action="store_true", help="Estimate cost without calling OpenAI.")
    vq.add_argument("--approve-dry-run", help="Exact verification report ID approved by the owner.")
    vq.add_argument("--max-cost-usd", type=float, help="Hard spend ceiling for verification.")
    vq.set_defaults(func=cmd_verify_questions)

    cp = sub.add_parser("calibrate-reasoning", help="Estimate a stronger materials-only reasoning pilot.")
    cp.add_argument("--sample-size", type=int, default=None, help="Representative MCQs to include (default 150).")
    cp.set_defaults(func=cmd_calibrate_reasoning)
    rp = sub.add_parser("run-reasoning-calibration", help="Run the approved stronger reasoning pilot.")
    rp.add_argument("--approve-dry-run", help="Exact calibration report ID approved by the owner.")
    rp.add_argument("--max-cost-usd", type=float, help="Hard pilot spend ceiling.")
    rp.add_argument("--sample-size", type=int, default=None)
    rp.add_argument("--promote", action="store_true", help="Apply cited materials-only results to the main question pool.")
    rp.set_defaults(func=cmd_run_reasoning_calibration)

    pb = sub.add_parser("build", help="Build the SQLite FTS index.")
    pb.add_argument("--ocr", action="store_true", help="OCR scanned PDFs (slow).")
    pb.add_argument("--limit", type=int, default=None, help="Process at most N docs.")
    pb.set_defaults(func=cmd_build)

    pi = sub.add_parser("ingest", help="unzip + build.")
    pi.add_argument("--ocr", action="store_true")
    pi.add_argument("--limit", type=int, default=None)
    pi.set_defaults(func=cmd_ingest)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
