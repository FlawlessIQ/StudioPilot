#!/usr/bin/env python3
"""
Find CSS rules whose selectors cannot match anything the app renders.

A rule is kept unless EVERY class in its selector is (a) absent from every
.tsx/.ts source file as a bare token, and (b) not covered by a prefix used to
build class names dynamically (`className={`is-${tone}`}` and friends).

The second condition is the important one: a purely grep-based sweep would
delete rules for classes that only ever exist at runtime.

Usage:  python3 scripts/audit/dead-css.py            # report
        python3 scripts/audit/dead-css.py --apply    # rewrite the files
"""
import re, sys, pathlib, subprocess

FILES = ["app/globals.css", "app/studiocue-reimagined.css"]
APPLY = "--apply" in sys.argv

src_tokens = set(
    subprocess.run(
        ["grep", "-rhoE", r"[a-zA-Z][a-zA-Z0-9_-]{2,}",
         "--include=*.tsx", "--include=*.ts", "--include=*.js", "--include=*.mjs",
         "app", "components", "lib", "features", "server", "e2e", "config", "scripts"],
        capture_output=True, text=True).stdout.split())

dyn_prefixes = set()
for p in list(pathlib.Path(".").glob("app/**/*.tsx")) + list(pathlib.Path(".").glob("components/**/*.tsx")):
    text = p.read_text()
    for m in re.finditer(r"className=\{`([^`]*)`\}", text):
        tpl = m.group(1)
        dyn_prefixes.update(re.findall(r"([a-zA-Z][a-zA-Z0-9_-]*)-?\$\{", tpl))
        dyn_prefixes.update(re.findall(r"(?<![\w${-])([a-z][a-z0-9-]{2,})(?![\w}-])", tpl))
    dyn_prefixes.update(re.findall(r"`(is|has|tone|lane|kind|status|state)-\$\{", text))

# Classes the e2e suite selects on: deleting a rule that supplies their
# padding or layout would break an assertion, so treat them as live.
e2e_selected = set()
for spec in pathlib.Path("e2e").glob("*.spec.ts"):
    e2e_selected.update(re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]{2,})", spec.read_text()))

def protected(cls: str) -> bool:
    if cls in src_tokens or cls in e2e_selected:
        return True
    return any(cls == p or cls.startswith(p) for p in dyn_prefixes if p)

rule_re = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)

total_removed = total_bytes = 0
for f in FILES:
    path = pathlib.Path(f)
    css = path.read_text()
    out, cursor, removed, bytes_removed = [], 0, [], 0
    for m in rule_re.finditer(css):
        sel = m.group(1)
        # never touch at-rules, :root, element-only or attribute selectors
        stripped = sel.strip()
        if stripped.startswith("@") or ":root" in stripped:
            continue
        classes = re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]*)", sel)
        if not classes:
            continue
        if any(protected(c) for c in classes):
            continue
        out.append((m.start(), m.end()))
        removed.append(stripped.replace("\n", " ")[:70])
        bytes_removed += m.end() - m.start()
    print(f"  {path.name}: {len(removed)} rules, {bytes_removed // 1024} KB removable")
    for r in removed[:8]:
        print(f"      {r}")
    if len(removed) > 8:
        print(f"      … and {len(removed) - 8} more")
    total_removed += len(removed)
    total_bytes += bytes_removed
    if APPLY and out:
        kept, prev = [], 0
        for s, e in out:
            kept.append(css[prev:s]); prev = e
        kept.append(css[prev:])
        path.write_text("".join(kept))
print(f"  TOTAL: {total_removed} rules, {total_bytes // 1024} KB")
print(f"  protected dynamic prefixes: {len(dyn_prefixes)}")
if APPLY:
    print("  APPLIED")
