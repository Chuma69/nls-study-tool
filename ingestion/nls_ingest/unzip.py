"""Recursive unzip: expands raw_zips/ into raw_materials/, descending into
nested zips, skipping junk, and never overwriting on duplicate names."""

from __future__ import annotations

import zipfile
from pathlib import Path

from . import config, fsutil


def _dedup_dest(dest: Path) -> Path:
    """Return a non-colliding path by suffixing __2, __3, ... if needed."""
    if not dest.exists():
        return dest
    stem, suffix, parent = dest.stem, dest.suffix, dest.parent
    n = 2
    while True:
        cand = parent / f"{stem}__{n}{suffix}"
        if not cand.exists():
            return cand
        n += 1


def _safe_extract(zf: zipfile.ZipFile, member: zipfile.ZipInfo, out_dir: Path) -> Path | None:
    """Extract one member into out_dir, guarding against path traversal and
    junk, without overwriting existing files. Returns the written path."""
    rel = Path(member.filename)
    if member.is_dir():
        return None
    if fsutil.is_junk(rel):
        return None
    # Guard against zip-slip.
    target = (out_dir / rel).resolve()
    if not str(target).startswith(str(out_dir.resolve())):
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    target = _dedup_dest(target)
    with zf.open(member) as src, target.open("wb") as dst:
        while chunk := src.read(1 << 20):
            dst.write(chunk)
    return target


def expand_all(src_zip_dir: Path = config.RAW_ZIPS_DIR,
               out_dir: Path = config.RAW_MATERIALS_DIR) -> dict[str, int]:
    """Expand every top-level zip in src_zip_dir into out_dir, recursively
    unpacking nested zips. Idempotent-ish: extracted nested zips are deleted
    after expansion, so a re-run over an already-expanded tree is cheap."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stats = {"archives": 0, "files": 0, "nested_zips": 0}

    # Seed the work queue with top-level archives.
    queue: list[Path] = sorted(src_zip_dir.glob("*.zip"))

    while queue:
        archive = queue.pop(0)
        if fsutil.is_junk(archive):
            archive.unlink(missing_ok=True) if archive.parent == out_dir else None
            continue
        try:
            with zipfile.ZipFile(archive) as zf:
                stats["archives"] += 1
                for member in zf.infolist():
                    written = _safe_extract(zf, member, out_dir)
                    if written is None:
                        continue
                    if written.suffix.lower() == ".zip":
                        stats["nested_zips"] += 1
                        queue.append(written)
                    else:
                        stats["files"] += 1
        except zipfile.BadZipFile:
            print(f"  ! skipping corrupt zip: {archive.name}")
            continue

        # Delete nested archives after expansion (keep top-level source zips).
        if archive.parent.resolve() == out_dir.resolve():
            archive.unlink(missing_ok=True)

    return stats
