# -*- coding: utf-8 -*-
"""Split backend/routes/api.py into domain modules without changing route paths."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "backend" / "routes"
SRC = ROOT / "api.py"
BAK = ROOT / "api.py.pre_split_backup"


def domain_for(route_line: str) -> str:
    m = re.search(r'@api\.route\("([^"]+)"', route_line)
    path = m.group(1) if m else ""
    if path.startswith("/marketplus"):
        return "marketplus"
    if (
        path.startswith("/last-work")
        or path.startswith("/recovery")
        or path.startswith("/local-archive")
    ):
        return "archive"
    return "core"


def main() -> None:
    src = SRC.read_text(encoding="utf-8")
    if not BAK.exists():
        BAK.write_text(src, encoding="utf-8")
        print("backup:", BAK)

    lines = src.splitlines(keepends=True)
    route_idxs = [i for i, ln in enumerate(lines) if re.match(r"\s*@api\.route\(", ln)]
    if not route_idxs:
        raise SystemExit("no routes found")

    preamble_end = route_idxs[0]
    blocks = []
    for n, idx in enumerate(route_idxs):
        end = route_idxs[n + 1] if n + 1 < len(route_idxs) else len(lines)
        blocks.append((idx, end, domain_for(lines[idx])))

    refined = []
    cursor = preamble_end
    for idx, end, dom in blocks:
        refined.append((cursor, end, dom))
        cursor = end
    if cursor < len(lines):
        refined.append((cursor, len(lines), "core"))

    merged = []
    for start, end, dom in refined:
        if merged and merged[-1][2] == dom:
            merged[-1] = (merged[-1][0], end, dom)
        else:
            merged.append((start, end, dom))

    segments = {"archive": [], "marketplus": [], "core": []}
    for start, end, dom in merged:
        segments[dom].append("".join(lines[start:end]))
        print(f"{dom}: lines {start + 1}-{end} ({end - start})")

    preamble = "".join(lines[:preamble_end])

    # Shared module: imports + helpers before first route + blueprint
    shared_path = ROOT / "api_shared.py"
    shared_path.write_text(
        '"""Shared Flask blueprint and helpers for API domain modules."""\n'
        + preamble
        + "\n",
        encoding="utf-8",
    )
    print("wrote", shared_path.name, "chars", shared_path.stat().st_size)

    domain_import = (
        "from routes.api_shared import *  # noqa: F401,F403\n"
        "from routes.api_shared import api  # re-export blueprint\n\n"
    )

    for name in ("archive", "marketplus", "core"):
        body = "".join(segments[name])
        path = ROOT / f"api_{name}.py"
        path.write_text(
            f'"""API domain routes: {name}. Auto-split from api.py — behavior unchanged."""\n'
            + domain_import
            + body,
            encoding="utf-8",
        )
        print("wrote", path.name, "chars", path.stat().st_size)

    # Facade api.py — import domains for side-effect route registration
    facade = '''"""
API Routes for the Product Detail Page Generator

Domain modules (behavior-preserving split):
- api_shared.py   : blueprint + shared helpers
- api_archive.py  : last-work, recovery, local-archive
- api_marketplus.py : Cafe24 MarketPlus / Chrome CDP automation
- api_core.py     : projects, gemini, sections, provider, scrapers, etc.

Import `api` from this module as before: `from routes.api import api`
"""
from routes.api_shared import api  # noqa: F401

# Register routes (order matches historical file layout)
from routes import api_archive  # noqa: F401,E402
from routes import api_marketplus  # noqa: F401,E402
from routes import api_core  # noqa: F401,E402

__all__ = ["api"]
'''
    SRC.write_text(facade, encoding="utf-8")
    print("wrote facade api.py")

    # Smoke: import graph
    print("done. Run py_compile / import check next.")


if __name__ == "__main__":
    main()
