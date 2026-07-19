#!/srv/opt/graphify/current/bin/python
"""Keep Graphify's code-only graph fresh without observing its own outputs."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from graphify.detect import CODE_EXTENSIONS, _is_ignored, _load_graphifyignore
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

PROJECT_ROOT = Path("/srv/projects/brai-new").resolve()
OUTPUT_ROOT = PROJECT_ROOT / "graphify-out"
STATUS_PATH = Path("/srv/opt/graphify/state/brai-new/status.json")
DEBOUNCE_SECONDS = 5.0


def write_status(*, phase: str, error: str | None = None) -> None:
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(
        json.dumps(
            {
                "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "phase": phase,
                "ok": error is None,
                "error": error,
                "graph": str(OUTPUT_ROOT / "graph.json"),
            },
        )
        + "\n",
        encoding="utf-8",
    )


def is_relevant(path: Path, ignore_patterns: list[tuple[Path, str]]) -> bool:
    try:
        # Do not resolve symlinks here: watchdog reports the lexical path that
        # changed, and resolving it can erase the `graphify-out` boundary.
        relative = path.absolute().relative_to(PROJECT_ROOT)
    except ValueError:
        return False
    if not relative.parts or relative.parts[0].startswith("graphify-out"):
        return False
    if any(part.startswith(".") for part in relative.parts[:-1]):
        return path.name == ".graphifyignore"
    if _is_ignored(path, PROJECT_ROOT, ignore_patterns):
        return path.name == ".graphifyignore"
    return path.suffix.lower() in CODE_EXTENSIONS or path.name == ".graphifyignore"


class Handler(FileSystemEventHandler):
    def __init__(self, ignore_patterns: list[tuple[Path, str]]) -> None:
        self.ignore_patterns = ignore_patterns
        self.last_change = 0.0
        self.pending = False

    def on_any_event(self, event: object) -> None:
        if getattr(event, "is_directory", False):
            return
        if getattr(event, "event_type", "") not in {"created", "deleted", "modified", "moved"}:
            return
        src_path = Path(os.fsdecode(getattr(event, "src_path")))
        if is_relevant(src_path, self.ignore_patterns):
            self.pending = True
            self.last_change = time.monotonic()


def update_graph() -> bool:
    write_status(phase="updating")
    result = subprocess.run(
        ["/srv/opt/graphify/current/bin/graphify", "update", str(PROJECT_ROOT), "--force"],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        write_status(phase="degraded", error=f"graphify update exited {result.returncode}")
        return False
    write_status(phase="ready")
    return True


def main() -> int:
    ignore_patterns = _load_graphifyignore(PROJECT_ROOT)
    handler = Handler(ignore_patterns)
    observer = Observer()
    observer.schedule(handler, str(PROJECT_ROOT), recursive=True)
    observer.start()
    write_status(phase="ready")
    try:
        while True:
            time.sleep(0.5)
            if handler.pending and time.monotonic() - handler.last_change >= DEBOUNCE_SECONDS:
                handler.pending = False
                if not update_graph():
                    return 1
    finally:
        observer.stop()
        observer.join()


if __name__ == "__main__":
    raise SystemExit(main())
