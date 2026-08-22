#!/usr/bin/env python3
"""Coffee Atlas document-structure gate.

SCOPE (declared, per ds-quality --invariant):
  Scans   : index.html as a whole document — skeleton, encoding, language, share metadata,
            and the set of external origins it reaches.
  Exempts : nothing. Every check below applies to the single shipped file.
  Blind to: visual rendering, CSS correctness, and the factual content of the page.

Exit: 0 = every structural invariant holds. Non-zero = violations, listed on stdout.
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

TARGET = Path(sys.argv[1] if len(sys.argv) > 1 else "index.html")


class Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tags: dict[str, list[dict[str, str | None]]] = {}
        self.decls: list[str] = []
        self.title = ""
        self._in_title = False

    def handle_decl(self, decl: str) -> None:
        self.decls.append(decl)

    def handle_starttag(self, tag: str, attrs) -> None:
        self.tags.setdefault(tag, []).append(dict(attrs))
        if tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def main() -> int:
    if not TARGET.is_file():
        print(f"H0: {TARGET} does not exist — nothing to check, treating as failure.")
        return 2

    raw = TARGET.read_text(encoding="utf-8")
    doc = Collector()
    doc.feed(raw)

    failures: list[str] = []

    def need(cond: bool, ident: str, msg: str) -> None:
        if not cond:
            failures.append(f"{ident}: {msg}")

    metas = doc.tags.get("meta", [])

    def meta_by(key: str, value: str) -> dict | None:
        return next((m for m in metas if (m.get(key) or "").lower() == value), None)

    # --- skeleton ---
    need(any(d.strip().lower() == "doctype html" for d in doc.decls), "H1",
         "no `<!DOCTYPE html>` — without it the browser renders in quirks mode")
    need("html" in doc.tags, "H2", "no `<html>` element")
    need("head" in doc.tags, "H3", "no `<head>` element")
    need("body" in doc.tags, "H4", "no `<body>` element")

    # --- encoding + language ---
    need(any("charset" in m for m in metas), "H5",
         "no `<meta charset>` — Turkish glyphs then depend entirely on the server's Content-Type header")
    html_attrs = doc.tags.get("html", [{}])[0] if "html" in doc.tags else {}
    need(bool(html_attrs.get("lang")), "H6",
         "the root element declares no `lang` — screen readers get no document language")

    # --- identity + share metadata ---
    need(doc.title.strip() != "", "H7", "no non-empty `<title>`")
    need(meta_by("name", "viewport") is not None, "H8", "no viewport meta")
    need(meta_by("name", "description") is not None, "H9",
         "no meta description — a shared link has nothing to show")
    for prop in ("og:title", "og:description", "og:type", "og:url", "og:image"):
        need(meta_by("property", prop) is not None, "H10", f"no `{prop}` — shared links render a blank preview")
    need(meta_by("name", "twitter:card") is not None, "H11", "no `twitter:card`")
    need(any((l.get("rel") or "") == "canonical" for l in doc.tags.get("link", [])), "H12",
         "no canonical link")
    need(any("icon" in (l.get("rel") or "") for l in doc.tags.get("link", [])), "H13",
         "no favicon")

    # --- self-containment: the page must LOAD no third-party subresource ---
    # Only loading contexts count. `<link rel=canonical>` and og:url are metadata: they name the
    # page's own address and fetch nothing, so they are not origins the visitor's browser contacts.
    loading = re.findall(r'<(?:script|img|iframe|source|audio|video|embed)\b[^>]*\bsrc="(https?://[^/"]+)', raw)
    LOADING_RELS = {"stylesheet", "preload", "preconnect", "dns-prefetch", "prefetch", "modulepreload"}
    for link in doc.tags.get("link", []):
        rels = set((link.get("rel") or "").lower().split())
        href = link.get("href") or ""
        if rels & LOADING_RELS and href.startswith(("http://", "https://")):
            loading.append(re.match(r'(https?://[^/]+)', href).group(1))
    loading += re.findall(r'url\(\s*[\'"]?(https?://[^/\'")]+)', raw)  # CSS-referenced fonts/images

    origins = sorted(set(loading))
    need(not origins, "H14",
         "the page loads subresources from external origin(s): " + ", ".join(origins) +
         " — every visitor's IP and User-Agent reach them on each page load")

    # --- secrets ---
    secret_patterns = {
        "AWS access key": r"AKIA[0-9A-Z]{16}",
        "GitHub token": r"gh[pousr]_[A-Za-z0-9]{36,}",
        "private key block": r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        "generic api key assignment": r'(?i)(api[_-]?key|secret|password)\s*[:=]\s*["\'][A-Za-z0-9/+=_-]{16,}["\']',
    }
    for label, pattern in secret_patterns.items():
        need(re.search(pattern, raw) is None, "H15", f"possible {label} committed in {TARGET}")

    print(f"checked {TARGET} · {len(raw)} bytes · {len(metas)} meta tags · {len(origins)} external origin(s)")
    if failures:
        print(f"\n{len(failures)} structural violation(s):", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("all structural invariants hold")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
