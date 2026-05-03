#!/usr/bin/env python3
"""
download_pyqs.py — Download PYQ papers from Hyrank as organised JSON files.

Each paper is written to:
    <output_dir>/<exam_slug>/<year>/<paper_slug>.json

Each JSON file contains the full clone-ready + re-ingest-ready paper:
    - paper_meta (exam, year, paper_session_id, paper_date, tier, shift, ...)
    - coverage   (totals: questions, with_hi, with_solution, with_images, verified)
    - sections[].questions[]
        - position, subtype, difficulty, correct_option, group
        - raw.en / raw.hi  — every *_json column verbatim (for re-ingest)
        - clone.en / clone.hi — extracted text per language (for AI cloning)

Usage:
    # Find an exam_id (e.g. via /admin browser network tab or DB) then:
    python scripts/download_pyqs.py \
        --exam-id <uuid> \
        --year 2023 \
        --count 5 \
        --base-url https://hyrank.example.com \
        --session-cookie "<paste from browser>" \
        --output ./pyq_exports

Auth:
    The endpoint requires an admin session. Two ways to authenticate:
      1) --session-cookie "<value of the `session` cookie from your browser>"
      2) Set HYRANK_SESSION_COOKIE in the environment.
    Cookie is valid for 7 days from login; refresh by logging in again
    in the browser and copying the new cookie.

Base URL:
    Defaults to http://localhost:3000. Override via --base-url or HYRANK_BASE_URL.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path


def slugify(s: str) -> str:
    if not s:
        return "unknown"
    s = re.sub(r"[^a-zA-Z0-9]+", "-", str(s)).strip("-").lower()
    return s or "unknown"


def http_get(url: str, cookie: str, timeout: int = 90) -> dict:
    req = urllib.request.Request(url, headers={
        "Cookie": f"session={cookie}",
        "Accept": "application/json",
        "User-Agent": "hyrank-pyq-downloader/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {e.code} from {url}\n{body}")
    except urllib.error.URLError as e:
        raise SystemExit(f"Network error fetching {url}: {e}")


def http_download(url: str, cookie: str, dest: Path, timeout: int = 180) -> bool:
    """Stream a binary URL (PDF) to `dest`. Returns True on success, False otherwise."""
    req = urllib.request.Request(url, headers={
        "Cookie": f"session={cookie}",
        "User-Agent": "hyrank-pyq-downloader/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ct = resp.headers.get("Content-Type", "")
            if "pdf" not in ct.lower() and "octet-stream" not in ct.lower():
                # PDF route may redirect to Cloudinary directly; urllib follows redirects by default.
                # If the body isn't a PDF, treat as failure rather than save garbage.
                sys.stderr.write(f"  ! skip PDF (unexpected content-type {ct}): {url}\n")
                return False
            with dest.open("wb") as f:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
        return True
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"  ! PDF HTTP {e.code} for {url}\n")
        return False
    except urllib.error.URLError as e:
        sys.stderr.write(f"  ! PDF network error: {e}\n")
        return False


def write_paper_file(paper: dict, exam_slug: str, year: int, output_dir: Path) -> Path:
    paper_dir = output_dir / exam_slug / str(year)
    paper_dir.mkdir(parents=True, exist_ok=True)

    meta = paper.get("paper_meta", {})
    label = meta.get("session_label") or meta.get("paper_session_id", "paper")
    date = meta.get("paper_date") or ""
    date_part = date[:10] if isinstance(date, str) else ""
    base = f"{date_part}_{slugify(label)}" if date_part else slugify(label)

    out_path = paper_dir / f"{base}.json"
    # Ensure uniqueness if same label appears twice
    if out_path.exists():
        suffix = 1
        while True:
            candidate = paper_dir / f"{base}__{suffix}.json"
            if not candidate.exists():
                out_path = candidate
                break
            suffix += 1

    with out_path.open("w", encoding="utf-8") as f:
        json.dump(paper, f, ensure_ascii=False, indent=2)
    return out_path


def main():
    parser = argparse.ArgumentParser(
        description="Download PYQ papers from Hyrank as organised JSON files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--exam-id", required=True, help="UUID of the exam")
    parser.add_argument("--year", required=True, type=int, help="Year, e.g. 2023")
    parser.add_argument("--count", type=int, default=5,
                        help="Number of papers to download (max 50, default 5)")
    parser.add_argument("--base-url",
                        default=os.environ.get("HYRANK_BASE_URL", "http://localhost:3000"),
                        help="Hyrank base URL (default: $HYRANK_BASE_URL or http://localhost:3000)")
    parser.add_argument("--session-cookie",
                        default=os.environ.get("HYRANK_SESSION_COOKIE", ""),
                        help="Value of the `session` cookie (or set $HYRANK_SESSION_COOKIE)")
    parser.add_argument("--output", default="./pyq_exports",
                        help="Output directory (default: ./pyq_exports)")
    parser.add_argument("--download-pdfs", action="store_true",
                        help="Also download the source PDF for each paper next to its JSON.")
    args = parser.parse_args()

    if not args.session_cookie:
        sys.stderr.write(
            "ERROR: session cookie required. Pass --session-cookie or set HYRANK_SESSION_COOKIE.\n"
            "Get it from your browser DevTools after logging into Hyrank as admin.\n"
        )
        sys.exit(2)

    qs = urllib.parse.urlencode({
        "exam_id": args.exam_id,
        "year": str(args.year),
        "limit": str(min(max(args.count, 1), 50)),
    })
    url = f"{args.base_url.rstrip('/')}/api/pyq/export?{qs}"

    print(f"[{datetime.now().strftime('%H:%M:%S')}] GET {url}")
    payload = http_get(url, args.session_cookie)

    if payload.get("error"):
        sys.exit(f"API error: {payload['error']}")

    meta = payload.get("export_meta", {})
    papers = payload.get("papers", [])
    exam_name = meta.get("exam_name") or args.exam_id
    exam_slug = slugify(exam_name)

    print(f"  exam: {exam_name}  year: {meta.get('year')}  "
          f"requested: {meta.get('requested_papers')}  returned: {meta.get('returned_papers')}")

    if not papers:
        print("No papers returned. Nothing to write.")
        return

    output_dir = Path(args.output).expanduser().resolve()
    base = args.base_url.rstrip("/")
    written = []
    pdf_count = 0
    for paper in papers:
        path = write_paper_file(paper, exam_slug, args.year, output_dir)
        cov = paper.get("coverage", {})
        print(
            f"  wrote {path.relative_to(output_dir.parent) if output_dir.parent in path.parents else path}"
            f"   ({cov.get('questions_total', 0)} q, "
            f"hi={cov.get('with_hi', 0)}, ver={cov.get('verified', 0)})"
        )
        written.append(str(path))

        if args.download_pdfs:
            pdf_url = (paper.get("paper_meta") or {}).get("pdf_url")
            if pdf_url:
                pdf_dest = path.with_suffix(".pdf")
                full_url = pdf_url if pdf_url.startswith("http") else f"{base}{pdf_url}"
                if http_download(full_url, args.session_cookie, pdf_dest):
                    print(f"     + pdf {pdf_dest.name}")
                    pdf_count += 1
            else:
                print("     - no source_pdf_path on this paper")

    # Manifest of what was written
    manifest_path = output_dir / exam_slug / str(args.year) / "_manifest.json"
    manifest = {
        "export_meta": meta,
        "files": [os.path.basename(p) for p in written],
        "downloaded_at": datetime.now().isoformat(),
    }
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\nDone. {len(written)} papers written under {output_dir / exam_slug / str(args.year)}", end="")
    if args.download_pdfs:
        print(f"  ({pdf_count} PDFs)", end="")
    print()


if __name__ == "__main__":
    main()
