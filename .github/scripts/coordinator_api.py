"""Bounded GitHub API access for the scheduled coordinator.

The existing user credential is used for PR writes and Copilot repair comments.
Provider error bodies, prompts, response URLs and credentials are not included
in diagnostics. Writes are never retried automatically.
"""

from __future__ import annotations

import json
import re
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

API_ORIGIN = "https://api.github.com"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BYTES = 1024 * 1024
MAX_PAGES = 100
TIMEOUT_SECONDS = 30


class APIError(RuntimeError):
    """A sanitized failure; callers may branch on status and category."""

    def __init__(self, category: str, status: int | None = None):
        self.category = category
        self.status = status
        suffix = f" (HTTP {status})" if status is not None else ""
        super().__init__(f"GitHub API: {category}{suffix}")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward Authorization to a redirected or signed URL.
        return None


class GitHub:
    def __init__(self, repo: str, token: str, copilot_token: str = ""):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise APIError("invalid repository")
        if any(not isinstance(value, str) or any(ord(c) < 33 for c in value)
               for value in (token, copilot_token)):
            raise APIError("invalid credential configuration")
        self.repo = repo
        self.token = token
        self.copilot_token = copilot_token
        self._opener = build_opener(_NoRedirect())

    @staticmethod
    def _url(path: str) -> str:
        if not isinstance(path, str) or any(ord(c) < 33 for c in path):
            raise APIError("invalid API path")
        parsed = urlsplit(path)
        if parsed.scheme or parsed.netloc:
            if parsed.scheme != "https" or parsed.netloc != "api.github.com":
                raise APIError("refused API URL")
        elif not path.startswith("/") or path.startswith("//"):
            raise APIError("invalid API path")
        if parsed.fragment:
            raise APIError("invalid API path")
        return urlunsplit(("https", "api.github.com", parsed.path, parsed.query, ""))

    def _request(self, method: str, path: str, body=None, user_token: bool = False):
        if method not in {"GET", "POST", "PATCH", "PUT", "DELETE"}:
            raise APIError("invalid API method")
        url = self._url(path)
        token = self.copilot_token if user_token else self.token
        if not token:
            raise APIError("Copilot user token not configured" if user_token else "workflow token not configured")
        data = None
        if body is not None:
            try:
                data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            except (TypeError, ValueError):
                raise APIError("invalid request body") from None
            if len(data) > MAX_REQUEST_BYTES:
                raise APIError("request size limit exceeded")
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "jarvis-scheduled-coordinator",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with self._opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                response_headers = response.headers
        except HTTPError as exc:
            status = exc.code
            rate_limited = status == 429 or (
                status == 403 and (
                    (exc.headers or {}).get("X-RateLimit-Remaining") == "0"
                    or (exc.headers or {}).get("Retry-After") is not None
                )
            )
            category = "rate limit reached" if rate_limited else {
                401: "authentication rejected", 403: "access denied",
                404: "resource unavailable", 409: "conflict",
                422: "request rejected",
            }.get(status, "request failed")
            exc.close()
            raise APIError(category, status) from None
        except (URLError, TimeoutError, OSError, HTTPException):
            raise APIError("network request failed") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise APIError("response size limit exceeded")
        if not raw:
            return None, response_headers
        try:
            return json.loads(raw), response_headers
        except (ValueError, UnicodeError):
            raise APIError("invalid JSON response") from None

    def request(self, method: str, path: str, body=None, user_token: bool = False):
        return self._request(method, path, body, user_token)[0]

    def pages(self, path: str, key: str | None = None, user_token: bool = False) -> list:
        """Read every page, optionally extracting a REST collection envelope."""
        parsed = urlsplit(self._url(path))
        query = parse_qsl(parsed.query, keep_blank_values=True)
        if not any(name == "per_page" for name, _ in query):
            query.append(("per_page", "100"))
        url = urlunsplit(parsed._replace(query=urlencode(query)))
        results = []
        seen = set()
        for _ in range(MAX_PAGES):
            if url in seen:
                raise APIError("pagination cycle detected")
            seen.add(url)
            data, headers = self._request("GET", url, user_token=user_token)
            collection = data.get(key) if key is not None and isinstance(data, dict) else data
            if not isinstance(collection, list):
                raise APIError("invalid collection response")
            results.extend(collection)
            match = re.search(r'<([^>]+)>;\s*rel="next"', headers.get("Link", ""))
            if not match:
                return results
            url = self._url(match.group(1))
        raise APIError("pagination limit exceeded")

    def graphql(self, query: str, variables: dict, user_token: bool = False):
        response = self.request("POST", "/graphql", {"query": query, "variables": variables}, user_token)
        if not isinstance(response, dict) or response.get("errors") or not isinstance(response.get("data"), dict):
            raise APIError("GraphQL request rejected")
        return response["data"]


    def repair_comment(self, pr_number: int, body: str):
        """Mention @copilot on the existing PR with a user identity.

        The documented comment API cannot select a model; GitHub continues the
        original PR model. The policy layer owns deduplication and eligibility.
        Documentation: https://docs.github.com/en/copilot/how-tos/
        use-copilot-agents/cloud-agent/use-cloud-agent-on-github
        """
        return self.request("POST", f"/repos/{self.repo}/issues/{pr_number}/comments",
                            {"body": body}, user_token=True)
