"""Build the admin and install manuals (HTML + PDF) from the Markdown docs.

    python docs/anleitung/build-anleitungen.py          # HTML + PDF
    python docs/anleitung/build-anleitungen.py --no-pdf # HTML only

Sources: docs/ROTATION_AND_SWAPS.md (without section 8) becomes
verwaltung-anleitung.html; section 8 "Betrieb" plus docs/OUTLOOK_SETUP.md
becomes installation-anleitung.html. The staff manual
tauschboerse-anleitung.html is hand-written; the script only prints its PDF.
PDFs are printed with headless Microsoft Edge.
"""

import html
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent
ADMIN_FILE = "verwaltung-anleitung.html"
INSTALL_FILE = "installation-anleitung.html"
STAFF_FILE = "tauschboerse-anleitung.html"
OUTLOOK_ID = "outlook-anbindung-einrichten-microsoft-365"
STAND = "Oktober 2026"

# Same look as the hand-written staff manual, plus code blocks.
CSS = """
  @page { size: A4; margin: 16mm 15mm 18mm 15mm; }
  :root {
    --text: #1c2430; --muted: #5b6575; --line: #dfe3ea; --accent: #2563eb;
    --accent-soft: #eef3fe; --warn-soft: #fff7e6; --warn-line: #f3d79b; --page: #ffffff;
    --code-bg: #f4f6f9;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; background: var(--page); color: var(--text);
    font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 15px; line-height: 1.55;
  }
  main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; }
  h2 { font-size: 21px; margin: 40px 0 12px; padding-top: 10px; border-top: 2px solid var(--line); break-after: avoid; }
  h3 { font-size: 17px; margin: 24px 0 8px; break-after: avoid; }
  h4 { font-size: 15px; margin: 18px 0 6px; break-after: avoid; }
  p, ul, ol { margin: 0 0 12px; }
  li { margin-bottom: 4px; }
  li > ul, li > ol { margin: 4px 0 0; }
  a { color: var(--accent); }
  .subtitle { color: var(--muted); font-size: 16px; margin-bottom: 20px; }
  .box { border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 14px 0; break-inside: avoid; }
  .box > :last-child { margin-bottom: 0; }
  .box.tip { background: var(--accent-soft); border-color: #c9d8fb; }
  .box strong.label { display: block; margin-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0 16px; font-size: 14px; }
  th, td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f6f9; }
  code { font-family: Consolas, "Cascadia Mono", Menlo, monospace; font-size: 0.9em; background: var(--code-bg); border-radius: 4px; padding: 0 4px; overflow-wrap: anywhere; }
  pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; overflow-x: auto; font-size: 13px; line-height: 1.45; break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: inherit; overflow-wrap: normal; }
  nav.toc { columns: 2; column-gap: 32px; font-size: 14px; }
  nav.toc ul { margin: 0; padding-left: 0; list-style: none; }
  nav.toc ul ul { padding-left: 16px; }
  nav.toc a { text-decoration: none; }
  footer { color: var(--muted); font-size: 12px; margin-top: 40px; border-top: 1px solid var(--line); padding-top: 10px; }
  @media print {
    main { max-width: none; padding: 0; }
    body { font-size: 13.5px; }
    tr { break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
    pre { white-space: pre-wrap; }
  }
  @media (max-width: 600px) {
    nav.toc { columns: 1; }
    h1 { font-size: 25px; }
  }
"""


def slugify(text: str) -> str:
    """GitHub-style heading anchor, so links written for the Markdown keep working."""
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[`*_]", "", text).strip().lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


class Renderer:
    """Converts the Markdown subset used by the docs: headings, paragraphs,
    nested lists, pipe tables, fenced code, inline code, bold, italic, links."""

    def __init__(self):
        self.headings = []  # (level, id, html text)
        self.ids = set()
        self.links = []  # placeholders resolved after both documents are known

    # ---- inline ----

    def inline(self, text: str) -> str:
        codes = []

        def keep_code(m):
            codes.append("<code>" + html.escape(m.group(1), quote=False) + "</code>")
            return f"\x00{len(codes) - 1}\x00"

        text = re.sub(r"`([^`]+)`", keep_code, text)
        text = html.escape(text, quote=False)

        def link(m):
            self.links.append(m.group(2))
            return f"\x01{len(self.links) - 1}\x02{m.group(1)}\x03"

        text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
        text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", text)
        return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], text)

    # ---- blocks ----

    LIST_RE = re.compile(r"^( *)([-*]|\d+\.) +(.*)$")

    def blocks(self, lines):
        out = []
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()
            if not stripped:
                i += 1
                continue
            if stripped.startswith("```"):
                indent = len(line) - len(line.lstrip())
                lang = stripped[3:].strip()
                body = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    body.append(lines[i][indent:] if lines[i][:indent].strip() == "" else lines[i])
                    i += 1
                i += 1
                cls = f' class="language-{lang}"' if lang else ""
                out.append(f"<pre><code{cls}>" + html.escape("\n".join(body), quote=False) + "</code></pre>")
                continue
            m = re.match(r"^(#{1,6}) +(.*)$", line)
            if m:
                out.append(self.heading(len(m.group(1)), m.group(2)))
                i += 1
                continue
            if re.match(r"^-{3,}$", stripped):
                i += 1
                continue
            if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
                rows = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    rows.append(lines[i].strip())
                    i += 1
                out.append(self.table(rows))
                continue
            if self.LIST_RE.match(line):
                html_list, i = self.list_block(lines, i)
                out.append(html_list)
                continue
            para = []
            while i < len(lines) and lines[i].strip() and not self.starts_block(lines, i):
                para.append(lines[i].strip())
                i += 1
            out.append("<p>" + self.inline(" ".join(para)) + "</p>")
        return "\n".join(out)

    def starts_block(self, lines, i):
        s = lines[i].strip()
        return (
            s.startswith("```")
            or re.match(r"^#{1,6} ", lines[i]) is not None
            or self.LIST_RE.match(lines[i]) is not None
            or (s.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]) is not None)
        )

    def list_block(self, lines, i):
        first = self.LIST_RE.match(lines[i])
        base = len(first.group(1))
        ordered = first.group(2)[0].isdigit()
        items = []
        loose = False
        while i < len(lines):
            m = self.LIST_RE.match(lines[i])
            if not m or len(m.group(1)) != base or m.group(2)[0].isdigit() != ordered:
                break
            content_indent = base + len(m.group(2)) + 1
            body = [m.group(3)]
            i += 1
            while i < len(lines):
                line = lines[i]
                if not line.strip():
                    # a blank line continues the item only if indented content follows
                    j = i
                    while j < len(lines) and not lines[j].strip():
                        j += 1
                    if j < len(lines) and len(lines[j]) - len(lines[j].lstrip()) >= content_indent:
                        body.extend([""] * (j - i))
                        loose = True
                        i = j
                        continue
                    break
                indent = len(line) - len(line.lstrip())
                if indent >= content_indent or (indent > base and self.LIST_RE.match(line)):
                    body.append(line[min(indent, content_indent):])
                elif indent <= base and (self.LIST_RE.match(line) or self.starts_block(lines, i)):
                    break
                else:
                    body.append(line.strip())  # lazy continuation
                i += 1
            items.append(body)
            # blank line between items of the same list
            j = i
            while j < len(lines) and not lines[j].strip():
                j += 1
            nxt = self.LIST_RE.match(lines[j]) if j < len(lines) else None
            if nxt and len(nxt.group(1)) == base and j > i:
                loose = True
                i = j
        parts = []
        for body in items:
            inner = self.blocks(body)
            if not loose and inner.startswith("<p>") and inner.count("<p>") == 1:
                inner = inner[3:].replace("</p>", "", 1)
            parts.append(f"<li>{inner}</li>")
        tag = "ol" if ordered else "ul"
        return f"<{tag}>" + "\n".join(parts) + f"</{tag}>", i

    def table(self, rows):
        def cells(row):
            return [c.strip() for c in row.strip("|").split("|")]

        head = "".join(f"<th>{self.inline(c)}</th>" for c in cells(rows[0]))
        body = "".join("<tr>" + "".join(f"<td>{self.inline(c)}</td>" for c in cells(r)) + "</tr>" for r in rows[2:])
        return f"<table><tr>{head}</tr>{body}</table>"

    def heading(self, level, text, anchor=None):
        anchor = anchor or slugify(text)
        base, n = anchor, 1
        while anchor in self.ids:
            anchor = f"{base}-{n}"
            n += 1
        self.ids.add(anchor)
        inner = self.inline(text)
        self.headings.append((level, anchor, inner))
        return f'<h{level} id="{anchor}">{inner}</h{level}>'


def section(lines, start_pattern, end_pattern):
    """Index range from the heading matching start_pattern up to (not including) end_pattern."""
    start = next(i for i, l in enumerate(lines) if re.match(start_pattern, l))
    end = next((i for i in range(start + 1, len(lines)) if re.match(end_pattern, lines[i])), len(lines))
    return start, end


def drop_toc(lines):
    """Remove the '## Inhalt' block of a Markdown doc (it is regenerated)."""
    out, skip = [], False
    for l in lines:
        if re.match(r"^## Inhalt\s*$", l):
            skip = True
            continue
        if skip and re.match(r"^(## |---)", l):
            skip = False
            if l.startswith("---"):
                continue
        if not skip:
            out.append(l)
    return out


def shift_headings(lines, by):
    out, fence = [], False
    for l in lines:
        if l.strip().startswith("```"):
            fence = not fence
        if not fence and re.match(r"^#{1,5} ", l):
            l = "#" * by + l if by > 0 else l[-by:]
        out.append(l)
    return out


def toc(headings):
    items, open_sub = [], False
    for level, anchor, text in headings:
        if level == 2:
            if open_sub:
                items.append("</ul></li>")
                open_sub = False
            elif items:
                items.append("</li>")
            items.append(f'<li><a href="#{anchor}">{text}</a>')
        elif level == 3 and items:
            if not open_sub:
                items.append("<ul>")
                open_sub = True
            items.append(f'<li><a href="#{anchor}">{text}</a></li>')
    items.append("</ul></li>" if open_sub else "</li>")
    return '<nav class="toc"><strong>Inhalt</strong><ul>' + "".join(items) + "</ul></nav>"


def page(title, subtitle, intro_html, body_html, renderer, footer):
    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{CSS}</style>
</head>
<body>
<main>
<h1>{title}</h1>
<div class="subtitle">{subtitle}</div>
{intro_html}
{toc(renderer.headings)}
{body_html}
<footer>{footer}</footer>
</main>
</body>
</html>
"""


def resolve_links(text, renderer, own_file, other_ids, other_file):
    def target(url):
        if url.startswith(("http://", "https://", "mailto:")):
            return url
        if url.startswith("#"):
            anchor = url[1:]
            if anchor in renderer.ids:
                return url
            if anchor in other_ids:
                return f"{other_file}#{anchor}"
            raise SystemExit(f"{own_file}: unbekannter Anker {url}")
        name = url.split("#")[0].rsplit("/", 1)[-1]
        if name == "OUTLOOK_SETUP.md":
            return f"#{OUTLOOK_ID}" if own_file == INSTALL_FILE else f"{INSTALL_FILE}#{OUTLOOK_ID}"
        if name == "ROTATION_AND_SWAPS.md":
            return ADMIN_FILE if own_file == INSTALL_FILE else "#"
        return None  # other repo docs: keep the label, no link

    def sub(m):
        url = target(renderer.links[int(m.group(1))])
        return m.group(2) if url is None else f'<a href="{html.escape(url)}">{m.group(2)}</a>'

    return re.sub(r"\x01(\d+)\x02(.*?)\x03", sub, text, flags=re.S)


def build():
    rot = (DOCS / "ROTATION_AND_SWAPS.md").read_text(encoding="utf-8").splitlines()
    outlook = (DOCS / "OUTLOOK_SETUP.md").read_text(encoding="utf-8").splitlines()

    # --- admin manual: everything except section 8, section 9 renumbered to 8
    admin_src = drop_toc(rot)[1:]  # without the H1
    start, end = section(admin_src, r"^## 8\. ", r"^## 9\. ")
    betrieb = admin_src[start:end]
    admin_src = admin_src[:start] + [re.sub(r"^## 9\. ", "## 8. ", l) for l in admin_src[end:]]
    admin = Renderer()
    admin_body = admin.blocks(admin_src)

    # --- install manual: section 8 + Outlook setup
    install = Renderer()
    betrieb_body = shift_headings(betrieb[1:], -1)  # ### → ##
    install_body = install.blocks(betrieb_body)
    install_body += "\n" + install.heading(2, "Outlook-Anbindung einrichten (Microsoft 365)", OUTLOOK_ID)
    install_body += "\n" + install.blocks(shift_headings(drop_toc(outlook)[1:], 1))  # ## → ###

    admin_html = resolve_links(admin_body, admin, ADMIN_FILE, install.ids, INSTALL_FILE)
    install_html = resolve_links(install_body, install, INSTALL_FILE, admin.ids, ADMIN_FILE)

    admin_intro = (
        '<div class="box tip"><strong class="label">Für wen?</strong>'
        "Für alle, die Rotationen anlegen und verwalten, Tausche erzwingen, Dienstfrei und Urlaub "
        f'verwalten. Installation, Update, Datensicherung und Outlook stehen in der <a href="{INSTALL_FILE}">Installationsanleitung</a>, '
        f'die Anleitung für Mitarbeiter in der <a href="{STAFF_FILE}">Anleitung zur Tauschbörse</a>.</div>'
    )
    install_intro = (
        '<div class="box tip"><strong class="label">Für wen?</strong>'
        "Für den Betreiber des Servers: Container einrichten, sichern, aktualisieren, in Betrieb nehmen und Outlook anbinden. "
        f'Die Bedienung steht in der <a href="{ADMIN_FILE}">Verwaltungsanleitung</a>.</div>'
    )
    (HERE / ADMIN_FILE).write_text(
        page(
            "Rotationen und Tauschbörse verwalten",
            "Anleitung für die Verwaltung: Rotationen, Tauschbörse, Dienstfrei, Urlaub und Mindestbesetzung",
            admin_intro,
            admin_html,
            admin,
            f"BetterShift · Verwaltungsanleitung · Stand: {STAND} · erzeugt aus docs/ROTATION_AND_SWAPS.md",
        ),
        encoding="utf-8",
        newline="\n",
    )
    (HERE / INSTALL_FILE).write_text(
        page(
            "Installation und Betrieb",
            "Anleitung für den Betreiber: Docker, Datensicherung, Updates, Erstinbetriebnahme und Outlook",
            install_intro,
            install_html,
            install,
            f"BetterShift · Installationsanleitung · Stand: {STAND} · erzeugt aus docs/ROTATION_AND_SWAPS.md (Abschnitt 8) und docs/OUTLOOK_SETUP.md",
        ),
        encoding="utf-8",
        newline="\n",
    )
    print(f"geschrieben: {ADMIN_FILE}, {INSTALL_FILE}")


def find_edge():
    for p in (
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ):
        if Path(p).exists():
            return p
    return shutil.which("msedge") or shutil.which("microsoft-edge")


def print_pdfs():
    edge = find_edge()
    if not edge:
        raise SystemExit("Microsoft Edge nicht gefunden – PDFs nicht erzeugt.")
    for name in (STAFF_FILE, ADMIN_FILE, INSTALL_FILE):
        src = HERE / name
        pdf = src.with_suffix(".pdf")
        pdf.unlink(missing_ok=True)
        # a fresh profile per file: with a shared one Edge may hand off and return early
        with tempfile.TemporaryDirectory() as profile:
            subprocess.run(
                [edge, "--headless=new", "--disable-gpu", f"--user-data-dir={profile}",
                 "--no-pdf-header-footer", f"--print-to-pdf={pdf}", src.as_uri()],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            for _ in range(60):
                if pdf.exists() and pdf.stat().st_size > 0:
                    break
                time.sleep(0.5)
            else:
                raise SystemExit(f"PDF nicht erzeugt: {pdf.name}")
            time.sleep(1)  # let Edge release the profile before it is removed
        print(f"PDF: {pdf.name} ({pdf.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
    if "--no-pdf" not in sys.argv:
        print_pdfs()
