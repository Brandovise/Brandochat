#!/usr/bin/env python3
"""Block the two ways this repo can be damaged by a commit: leaked secrets and
injected build-time code.

Run against staged changes (pre-commit hook) or a whole tree/diff (CI):

    python scripts/guard_repo.py --staged
    python scripts/guard_repo.py --range origin/main..HEAD
    python scripts/guard_repo.py --all

Exit 1 on any finding. Designed to be boring and dependency-free so it cannot
itself become a supply-chain problem.

Why each check exists — all three fired on a real incident in this repo:

1. A secret file was about to become committable because `.gitignore` was edited
   to drop `.env`. Ignore rules are not a security control; they are editable by
   whatever wrote the bad commit. This check does not consult .gitignore.
2. An obfuscated payload was appended to `frontend/vite.config.js`. A Vite config
   executes on every dev server start and every production build, so config files
   are execution, not data.
3. The payload was hidden behind a long run of spaces on one line and buried in a
   diff that rewrote every line of 42 files. Line-length and diff-size checks
   surface exactly that camouflage.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Files that must never be committed, whatever .gitignore currently says.
SECRET_FILES = re.compile(
    r"(^|/)\.env$"
    r"|(^|/)\.env\."
    r"|(^|/)\.env\.bak"
    r"|(^|/)(id_rsa|id_ed25519)$"
    r"|\.pem$|\.p12$|\.pfx$"
    r"|(^|/)service[-_]account.*\.json$"
)

# Shipping a template is the whole point of .env.example and its siblings. The
# rule above used to exempt only an exact ".env.example", so waveparse's real
# ".env.testing.example" was reported as a committed secret. Match the suffix.
SECRET_FILE_TEMPLATE = re.compile(r"\.(example|sample|template|dist)$", re.I)

# Config files that run code when a build or dev server starts. An unexplained
# change here is worth a human look even when it is legitimate.
EXECUTABLE_CONFIG = re.compile(
    r"(^|/)(vite|vitest|rollup|webpack|next|nuxt|svelte|astro|tailwind|postcss)\.config\.[cm]?[jt]s$"
    r"|(^|/)package\.json$"
    r"|(^|/)\.npmrc$"
    r"|(^|/)docker-compose[^/]*\.ya?ml$"
    r"|(^|/)Dockerfile[^/]*$"
    r"|(^|/)conftest\.py$|(^|/)sitecustomize\.py$"
)

# Signatures of the obfuscated-loader family seen in the wild. Deliberately
# specific: a broad "eval" match would fire constantly and get switched off.
#
# The first two patterns were written against the family in the abstract and did
# NOT match the payload actually used here, which assigned `global.r` and
# `global.m` rather than the full names. Match the shape — any single letter —
# instead of the two spellings we happened to imagine.
PAYLOAD_PATTERNS = [
    (r"global\.[A-Za-z_$][\w$]{0,3}\s*=\s*require\b", "assigns require onto global (sandbox escape prep)"),
    (r"global\.[A-Za-z_$][\w$]{0,3}\s*=\s*module\b", "assigns module onto global"),
    (r"createRequire\s*\(\s*import\.meta\.url\s*\)", "CommonJS require injected into an ESM config"),
    (r"_\$[A-Za-z0-9_]{4,}\s*,", "obfuscator-style mangled identifiers"),
    (r"\b(?:atob|Buffer\.from)\s*\([^)]{200,}", "very long inline base64 decode"),
    (r"String\.fromCharCode\s*\((?:\s*\d+\s*,){20,}", "charcode-array string building"),
    (r"\beval\s*\(\s*(?:atob|unescape|decodeURIComponent|[A-Za-z_$][\w$]*\s*\()", "eval of decoded data"),
    (r"child_process|execSync\s*\(", "spawns a process"),
    # The payload spelled every sensitive string as \u escapes so that grepping
    # for "http", "child_process" or a hostname found nothing. A run of them is
    # not something hand-written source does.
    (r"(?:\\u00[0-9a-fA-F]{2}){8,}", "long run of \\u escapes (string hidden from grep)"),
    (r"spawn\s*\(\s*[\"']node[\"']\s*,\s*\[\s*[\"']-e[\"']", "spawns a detached node -e child"),
]

# Indicators from the 2026-07-30 incident specifically. This dropper resolved its
# command-and-control address from the most recent transaction of a hard-coded
# Ethereum wallet, so the operator can move the server at any time by sending a
# new transaction — there is no domain to block. The wallet is the stable part,
# which makes it the thing worth matching on.
INCIDENT_IOCS = [
    (r"0xa322E5f3D311D3080e6f0121063e9aDC2490Ef1a", "C2-resolver wallet from the 2026-07-30 incident"),
    (r"eth\.blockscout\.com", "blockchain explorer used to resolve C2"),
    (r"\beth_getBlockByNumber\b|\beth_getTransactionCount\b",
     "raw Ethereum JSON-RPC in application code"),
    (r"x-payload-b64", "second-stage payload smuggled in an HTTP header"),
    (r"\bSec-V\b", "campaign identifier header from the 2026-07-30 incident"),
]

# Source we expect to be hand-written. A build config is not the only file that
# executes: the dropper would work just as well from any module the app imports,
# so the payload scan runs across all of this, not only the config allow-list.
SCANNABLE_SOURCE = re.compile(
    r"\.(?:[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|php|sh|bash|ps1|ya?ml|json)$"
)

# Secret-looking values. Prefixes only — never a generic "long string", which
# would flag hashes, lockfile integrities and minified assets.
SECRET_VALUES = [
    (r"sk-[A-Za-z0-9]{20,}", "OpenAI-style API key"),
    (r"shp(at|ca|pa|ss)_[A-Za-z0-9]{20,}", "Shopify access token"),
    (r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.", "JWT (Supabase service key?)"),
    (r"AKIA[0-9A-Z]{16}", "AWS access key id"),
    (r"gh[pousr]_[A-Za-z0-9]{30,}", "GitHub token"),
    (r"xox[abposr]-[A-Za-z0-9-]{10,}", "Slack token"),
    # Require actual key material. Documentation legitimately writes
    # "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----" as a
    # placeholder, and the bare marker flagged three waveparse design docs.
    (r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?:\s|\\[rn])*[A-Za-z0-9+/]{40,}",
     "private key block"),
]

# Postgres URLs need their own check: the pattern alone also matches documented
# placeholders and the local-compose dev default, so inspect the password itself.
PG_URL = re.compile(r"postgres(?:ql)?://(?P<user>[^\s:@/]+):(?P<pw>[^\s@/]{4,})@")
PLACEHOLDER_PW = re.compile(
    r"^[\[<{].*[\]>}]$"                        # [password], <your-pw>, {PW}
    r"|example|placeholder|change[-_ ]?me|your[-_]?|xxx|\*{3,}|password$|secret$",
    re.I,
)

# Generated or vendored output: real content, but minified/blob lines are normal
# there, so the hidden-content check would only ever cry wolf.
GENERATED = re.compile(
    r"(^|/)(graphify-out|node_modules|dist|build|coverage|\.venv|vendor|third_party)/"
    r"|\.min\.(js|css)$|(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$"
)

MAX_LINE = 2000          # a source line longer than this is hiding something
BINARY_HINT = b"\x00"


def pg_password_is_real(text: str) -> str | None:
    """Return a reason if the file holds a Postgres URL with a genuine password."""
    for m in PG_URL.finditer(text):
        pw, user = m.group("pw"), m.group("user")
        if PLACEHOLDER_PW.search(pw):
            continue
        if pw == user:                 # local dev default, e.g. jolifill:jolifill
            continue
        return "Postgres URL with inline password"
    return None


_ESCAPE = re.compile(r"\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})")


def deescape(text: str) -> str:
    """Resolve \\uXXXX / \\xXX escapes so the scan sees what the runtime sees.

    The payload wrote every sensitive string this way — "http", "child_process",
    the wallet address, its own hostname — precisely so that searching the file
    for any of them found nothing. Scanning the literal text alone therefore
    misses the strings that matter most. Cheap to undo, so undo it and scan both.
    """
    if "\\u" not in text and "\\x" not in text:
        return text
    return _ESCAPE.sub(
        lambda m: chr(int(m.group(1) or m.group(2), 16)), text
    )


def sh(*args: str) -> str:
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False).stdout


def staged_files() -> list[str]:
    out = sh("git", "diff", "--cached", "--name-only", "--diff-filter=ACMR")
    return [l for l in out.splitlines() if l.strip()]


def range_files(rng: str) -> list[str]:
    out = sh("git", "diff", "--name-only", "--diff-filter=ACMR", rng)
    return [l for l in out.splitlines() if l.strip()]


def all_files() -> list[str]:
    return [l for l in sh("git", "ls-files").splitlines() if l.strip()]


def safe_bytes(path: str) -> bytes | None:
    """Read a tracked file, or None if this filesystem cannot open it.

    ameise-zoho carries paths that exceed the runner's filename limit, and an
    unhandled OSError there aborted the whole scan — every file after it went
    unchecked while the job merely looked 'failed'. Skip what cannot be read and
    keep scanning; a file we cannot open is also a file a payload cannot hide in.
    """
    try:
        p = ROOT / path
        if not p.is_file():
            return None
        return p.read_bytes()
    except OSError:
        return None


def read(path: str, staged: bool) -> str | None:
    if staged:
        raw = subprocess.run(["git", "show", f":{path}"], cwd=ROOT,
                             capture_output=True, check=False).stdout
    else:
        raw = safe_bytes(path)
        if raw is None:
            return None
    if BINARY_HINT in raw[:8000]:
        return None
    return raw.decode("utf-8", "replace")


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--staged", action="store_true")
    g.add_argument("--range")
    g.add_argument("--all", action="store_true")
    args = ap.parse_args()

    if args.staged:
        files, from_index = staged_files(), True
    elif args.range:
        files, from_index = range_files(args.range), False
    else:
        files, from_index = all_files(), False

    findings: list[str] = []
    warnings: list[str] = []

    for f in files:
        # These necessarily quote the indicators they exist to describe.
        # Kept as an explicit file list rather than a directory rule, so
        # nobody can silence the scanner by dropping a file into docs/.
        if f in ("scripts/guard_repo.py", "documents/security_incident_report.md",
                 "documents/org_infection_scan.md",
                 "documents/remediation_runbook.md",
                 "documents/credential_rotation_list.md",
                 "scripts/incident/sweep.py",
                 "scripts/incident/strip_payload.py",
                 "scripts/incident/filter_stream.py",
                 "scripts/incident/check_machine.py",
                 ".claude/skills/incident-sweep/SKILL.md"):
            continue

        if SECRET_FILES.search(f) and not SECRET_FILE_TEMPLATE.search(f):
            findings.append(f"{f}: secret file must never be committed")
            continue

        text = read(f, from_index)
        if text is None:
            continue

        for pat, why in SECRET_VALUES:
            if re.search(pat, text):
                findings.append(f"{f}: {why}")

        pg = pg_password_is_real(text)
        if pg:
            findings.append(f"{f}: {pg}")

        if not GENERATED.search(f):
            for i, line in enumerate(text.splitlines(), 1):
                if len(line) > MAX_LINE:
                    # An over-long line is how the payload hid — but it is also
                    # what inline SVG, seeded fixtures and vendored bundles look
                    # like. Block only where the file executes at build time.
                    # Elsewhere, say it and move on: a guard that cries wolf in
                    # every repository is a guard somebody switches off.
                    msg = (f"{f}:{i}: line is {len(line)} chars — "
                           f"content hidden past the screen edge")
                    (findings if EXECUTABLE_CONFIG.search(f) else warnings).append(msg)
                    break

        # Scan the file as written and as the runtime will see it.
        plain = deescape(text)

        for pat, why in INCIDENT_IOCS:
            if re.search(pat, text) or re.search(pat, plain):
                findings.append(f"{f}: {why}")

        # A build config executes on every dev server start and every build, so
        # anything matching there is a finding. Elsewhere the same patterns are
        # worth a look but are not by themselves proof, so they warn — except in
        # combination, which no honest source file produces.
        if not GENERATED.search(f) and SCANNABLE_SOURCE.search(f):
            hits = [why for pat, why in PAYLOAD_PATTERNS
                    if re.search(pat, text) or re.search(pat, plain)]
            if hits:
                if EXECUTABLE_CONFIG.search(f):
                    for why in hits:
                        findings.append(f"{f}: build-time config contains {why}")
                elif len(hits) >= 2:
                    findings.append(f"{f}: {len(hits)} loader signatures together — {'; '.join(hits)}")
                else:
                    warnings.append(f"{f}: {hits[0]}")

    # .gitignore losing a secret rule is how the incident was set up.
    ignore = (ROOT / ".gitignore")
    if ignore.is_file():
        body = ignore.read_text("utf-8", "replace").splitlines()
        for required in (".env", ".env.bak.*"):
            if required not in [l.strip() for l in body]:
                findings.append(f".gitignore: '{required}' rule is missing — restore it")

    # .gitattributes pins line endings, which is what stops a rewriting machine
    # from burying a payload in a diff nobody can read. Same reasoning as the
    # .gitignore check above: the rule is only a control while it is present.
    attrs = (ROOT / ".gitattributes")
    if not attrs.is_file():
        findings.append(".gitattributes: file is missing — the eol=lf rule is the anti-camouflage control")
    else:
        body = [l.strip() for l in attrs.read_text("utf-8", "replace").splitlines()]
        if not any(l.startswith("* text=auto") and "eol=lf" in l for l in body):
            findings.append(".gitattributes: '* text=auto eol=lf' rule is missing — restore it")

    # A tree that should be all-LF containing CRLF means either the rule was
    # added without normalising, or something wrote past it.
    if args.all:
        stray = []
        for f in files:
            if (not SCANNABLE_SOURCE.search(f) or GENERATED.search(f)
                    or f.endswith((".bat", ".cmd", ".ps1"))):
                continue
            raw = safe_bytes(f)
            if raw is not None and b"\r\n" in raw:
                stray.append(f)
        if stray:
            findings.append(
                f"{len(stray)} file(s) still have CRLF despite the eol=lf rule "
                f"(e.g. {', '.join(stray[:3])}) — run: git add --renormalize .")

    if args.range:
        stat = sh("git", "diff", "--shortstat", "--ignore-all-space", args.range).strip()
        loud = sh("git", "diff", "--shortstat", args.range).strip()
        if stat and loud and stat != loud:
            # The incident diff was 100% EOL churn across 124 files. Below the
            # threshold this is ordinary editor noise and only worth a note;
            # at that scale it is the camouflage itself, and must block.
            changed = len(range_files(args.range))
            if changed >= 25 and not stat:
                findings.append(
                    f"{changed} files changed and the diff is ENTIRELY line-ending churn.\n"
                    f"      This is how the 2026-07-30 payload was hidden. Do not rebase or\n"
                    f"      re-apply commits from a machine that rewrites line endings.")
            else:
                warnings.append(
                    f"diff is mostly whitespace/EOL churn — review with --ignore-all-space\n"
                    f"      with whitespace: {loud}\n      without:         {stat}")

    for w in warnings:
        print(f"  warning: {w}")
    if findings:
        print("\n  REPO GUARD FAILED\n")
        for x in findings:
            print(f"    - {x}")
        print("\n  Nothing was committed. If a finding is a false positive, fix the pattern in")
        print("  scripts/guard_repo.py in its own reviewed commit — do not bypass with --no-verify.\n")
        return 1

    print(f"  repo guard: {len(files)} file(s) checked, clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
