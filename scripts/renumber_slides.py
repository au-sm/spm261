#!/usr/bin/env python3
"""
Renumber slide-count badges and nav-dot total in a SPM261_26/SPM381_26 deck.

Run this after adding, removing, or reordering <section class="slide ..."> blocks
by hand. It walks the sections in their actual document order (not by trusting
any existing numbers) and rewrites every "<cur> / <tot>" badge to match, so you
never have to hand-calculate offsets after an insert/delete/reorder again.

It does NOT touch the deck's NOTES / SLIDE_POLLS JS objects (those are keyed by
0-based slide index and must still be fixed by hand if slides were inserted
before an indexed entry) -- it prints a reminder listing those keys so you don't
forget.

Usage:
    python3 scripts/renumber_slides.py path/to/week-X/index.html [--write]

Without --write, it only reports what would change (dry run).
"""
import argparse
import re
import sys


SLIDE_OPEN_RE = re.compile(r'<section class="slide\b[^"]*"[^>]*>')
COUNT_RE = re.compile(
    r'(<div class="slide-count"><span class="cur">)(\d+)(</span> / <span class="tot">)(\d+)(</span></div>)'
)
NOTES_KEY_RE = re.compile(r'var\s+NOTES\s*=\s*\{')


def renumber(html: str):
    lines = html.split("\n")
    # Find every slide section's start line, in document order.
    slide_line_idxs = [i for i, line in enumerate(lines) if SLIDE_OPEN_RE.search(line)]
    total = len(slide_line_idxs)
    if total == 0:
        print("No <section class=\"slide ...\"> blocks found -- is this the right file?", file=sys.stderr)
        sys.exit(1)

    changes = []
    slide_num = 0
    for i, line in enumerate(lines):
        if i in slide_line_idxs:
            slide_num += 1
        # The slide-count badge for a given slide appears a few lines after its
        # <section> open tag, before the next one -- just rewrite every badge
        # we see using the slide_num of the most recently opened section.
        m = COUNT_RE.search(line)
        if m:
            old_cur, old_tot = m.group(2), m.group(4)
            new_cur = f"{slide_num:02d}"
            new_tot = str(total)
            if old_cur != new_cur or old_tot != new_tot:
                changes.append((i + 1, f"{old_cur}/{old_tot}", f"{new_cur}/{new_tot}"))
            lines[i] = COUNT_RE.sub(rf"\g<1>{new_cur}\g<3>{new_tot}\g<5>", line)

    new_html = "\n".join(lines)
    return new_html, total, changes


def find_notes_keys(html: str):
    m = NOTES_KEY_RE.search(html)
    if not m:
        return []
    start = m.end()
    end = html.find("};", start)
    block = html[start:end]
    return re.findall(r"(\d+)\s*:", block)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--write", action="store_true", help="Apply changes in place (default: dry run)")
    args = ap.parse_args()

    with open(args.file) as f:
        html = f.read()

    new_html, total, changes = renumber(html)

    if not changes:
        print(f"Already correctly numbered: {total} slides, all badges match.")
    else:
        print(f"{total} slides total. {len(changes)} badge(s) need updating:")
        for line_no, old, new in changes:
            print(f"  line {line_no}: {old} -> {new}")

    notes_keys = find_notes_keys(html)
    if notes_keys:
        print(
            f"\nREMINDER: this deck has a NOTES object with keys {sorted(set(int(k) for k in notes_keys))} "
            "(0-based slide index). If you inserted/removed/reordered slides at or before any of these "
            "positions, fix those keys by hand -- this script does not touch them."
        )

    if args.write and changes:
        with open(args.file, "w") as f:
            f.write(new_html)
        print(f"\nWrote {len(changes)} change(s) to {args.file}")
    elif changes:
        print("\nDry run only -- re-run with --write to apply.")


if __name__ == "__main__":
    main()
