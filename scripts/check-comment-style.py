"""Enforce the comment rule: inside a function body, one line.

Docstrings are documentation and may be any length. So may a comment at module or class
level, which is doing the same job for a file. What has to stay short is the aside inside a
function body -- if it needs a paragraph, the paragraph belongs in the docstring or in
public/frontend/README.md.
"""

import ast
import pathlib
import re
import sys

ROOT = pathlib.Path("tethysapp/ngiab")


def python_offenders(path):
    source = path.read_text()
    lines = source.splitlines()
    spans = [
        (node.lineno, node.end_lineno)
        for node in ast.walk(ast.parse(source))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    inside = lambda n: any(a <= n <= b for a, b in spans)

    run = 0
    for number, line in enumerate(lines, 1):
        if line.strip().startswith("#"):
            run += 1
            continue
        if run > 1 and inside(number - run):
            yield number - run, f"{run} consecutive # lines inside a function"
        run = 0


# No parser here, so function bodies are approximated by indentation: a comment indented at
# least one level sits inside something. A top-of-file or top-level block comment does not.
def js_offenders(path):
    lines = path.read_text().splitlines()

    run = 0
    for number, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("//") and line.startswith(("  ", "\t")):
            run += 1
            continue
        if run > 1:
            yield number - run, f"{run} consecutive // lines inside a block"
        run = 0

    # A /* */ block inside a function is an aside; /** */ at any level is a doc comment.
    for match in re.finditer(r"/\*(?!\*).*?\*/", path.read_text(), re.S):
        text = match.group(0)
        if "\n" not in text:
            continue
        start = path.read_text()[: match.start()]
        column = match.start() - (start.rfind("\n") + 1)
        if column > 0:
            yield start.count("\n") + 1, "multi-line /* */ inside a block"


def main():
    problems = []
    for path in sorted(ROOT.rglob("*.py")):
        problems += [(path, n, why) for n, why in python_offenders(path)]
    for path in sorted((ROOT / "public/frontend").rglob("*.js")):
        problems += [(path, n, why) for n, why in js_offenders(path)]

    for path, number, why in problems:
        print(f"::error file={path},line={number}::{why}; shorten it or move it to the docstring")
    print(f"checked comment style: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
