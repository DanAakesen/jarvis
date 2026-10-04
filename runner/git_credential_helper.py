"""Git credential helper that obtains a fresh installation token per request."""

from __future__ import annotations

import os
import sys
from typing import TextIO

from github_token import get_installation_token


def _read_credentials(stream: TextIO) -> dict[str, str]:
    fields = {}
    for line in stream:
        line = line.rstrip("\r\n")
        if not line:
            break
        key, separator, value = line.partition("=")
        if separator:
            fields[key] = value
    return fields


def _repository_path(value: str) -> str:
    path = value.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return path.casefold()


def main(arguments: list[str] | None = None) -> int:
    operation = (arguments if arguments is not None else sys.argv[1:]) or ["get"]
    if operation[0] != "get":
        return 0
    fields = _read_credentials(sys.stdin)
    if fields.get("protocol") != "https" or fields.get("host", "").casefold() != "github.com":
        return 0

    try:
        if os.environ.get("JARVIS_GITHUB_APP_TOKEN_ENABLED") == "true":
            token, repository = get_installation_token(
                os.environ["JARVIS_BACKEND_URL"],
                os.environ["JARVIS_API_SCOPE"],
                os.environ["JARVIS_TASK_ID"],
                os.environ["JARVIS_SESSION_ID"],
            )
            if _repository_path(fields.get("path", "")) != repository.casefold():
                return 0
        else:
            token = os.environ["GH_TOKEN"]
        if not token:
            return 1
        sys.stdout.write(f"username=x-access-token\npassword={token}\n\n")
        return 0
    except Exception:
        sys.stderr.write("GitHub credential request failed\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
