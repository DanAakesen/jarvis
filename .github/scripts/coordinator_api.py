"""Bounded GitHub API access for the scheduled coordinator.

The ordinary workflow token never substitutes for the user token required by
Copilot. Provider error bodies, prompts, response URLs and credentials are not
included in diagnostics. Writes are never retried automatically.
"""

from __future__ import annotations

import json
import re
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

API_ORIGIN = "https://api.github.com"
COPILOT_FEATURES = "issues_copilot_assignment_api_support,coding_agent_model_selection"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BYTES = 1024 * 1024
MAX_PAGES = 100
TIMEOUT_SECONDS = 30


class APIError(RuntimeError):
    """A sanitized failure; callers may branch on status and category."""

    def __init__(self, category: str, status: int | None = None, write_outcome_unknown: bool = False):
        self.category = category
        self.status = status
        self.write_outcome_unknown = write_outcome_unknown
        suffix = f" (HTTP {status})" if status is not None else ""
        super().__init__(f"GitHub API: {category}{suffix}")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward Authorization to a redirected or signed URL.
        return None


class GitHub:
    def __init__(self, repo: str, token: str, copilot_token: str = "", projects_token: str = ""):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise APIError("invalid repository")
        if any(not isinstance(value, str) or any(ord(c) < 33 for c in value)
               for value in (token, copilot_token)):
            raise APIError("invalid credential configuration")
        self.repo = repo
        self.token = token
        self.copilot_token = copilot_token
        self.projects_token = projects_token
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
        if urlsplit(url).path == "/graphql":
            headers["GraphQL-Features"] = COPILOT_FEATURES
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

    def project_graphql(self, query: str, variables: dict):
        # Personal Projects are unsupported by fine-grained PATs. Keep the
        # classic project-scope credential separate from repo/Copilot writes.
        if not self.projects_token:
            raise APIError("PROJECTS_TOKEN not configured")
        project_api = GitHub(self.repo, self.projects_token)
        project_api._opener = self._opener
        return project_api.graphql(query, variables)

    def assign_copilot(self, issue_number: int, base_ref: str, instructions: str,
                       model: str = "claude-opus-5.5", ready_check=None):
        """Assign one pre-checked issue, preserving any concurrent assignees."""
        if model != "claude-opus-5.5":
            raise APIError("unsupported coordinator Copilot model")
        owner, name = self.repo.split("/")
        data = self.graphql("""
            query($owner:String!, $name:String!, $number:Int!) {
              repository(owner:$owner, name:$name) {
                id issue(number:$number) {
                  id state
                  assignees(first:100) { totalCount nodes { login } }
                  labels(first:100) { totalCount nodes { name } }
                }
                suggestedActors(capabilities:[CAN_BE_ASSIGNED], first:100) {
                  nodes { login ... on Bot { id } ... on User { id } }
                }
              }
            }
            """, {"owner": owner, "name": name, "number": issue_number}, user_token=True)
        repository = data.get("repository")
        if not isinstance(repository, dict) or not repository.get("id"):
            raise APIError("Copilot repository unavailable")
        issue = repository.get("issue")
        suggested = repository.get("suggestedActors")
        actors = suggested.get("nodes") if isinstance(suggested, dict) else None
        if not isinstance(actors, list):
            raise APIError("Copilot actors unavailable")
        bot = next((actor for actor in actors if isinstance(actor, dict)
                    and actor.get("login") in {"copilot-swe-agent", "copilot-swe-agent[bot]"}), None)
        if not bot or not bot.get("id"):
            raise APIError("Copilot is not assignable")
        if not isinstance(issue, dict) or not issue.get("id"):
            raise APIError("issue unavailable")
        assignees = issue.get("assignees")
        labels = issue.get("labels")
        if (issue.get("state") != "OPEN" or not isinstance(assignees, dict)
                or assignees.get("totalCount") != 0 or assignees.get("nodes") != []):
            raise APIError("issue no longer unclaimed and open")
        if (not isinstance(labels, dict) or not isinstance(labels.get("nodes"), list)
                or labels.get("totalCount") != len(labels["nodes"])):
            raise APIError("issue labels unavailable")
        for label in labels["nodes"]:
            if not isinstance(label, dict) or not isinstance(label.get("name"), str):
                raise APIError("issue labels unavailable")
            if label["name"].casefold() in {"codex", "dan", "jarvis"}:
                raise APIError("issue claimed by another worker")
        if ready_check is not None and not ready_check():
            raise APIError("project Ready eligibility changed")
        try:
            result = self.graphql("""
                mutation($input:AddAssigneesToAssignableInput!) {
                  addAssigneesToAssignable(input:$input) {
                    assignable { ... on Issue { id assignees(first:100) { nodes { id login } } } }
                  }
                }
                """, {"input": {
                    "assignableId": issue["id"], "assigneeIds": [bot["id"]],
                    "agentAssignment": {"targetRepositoryId": repository["id"],
                                        "baseRef": base_ref, "customInstructions": instructions,
                                        "model": model},
                }}, user_token=True)
        except APIError as error:
            # GraphQL may report partial mutation failure. Without a definitive
            # HTTP rejection, don't release ownership and risk another job.
            error.write_outcome_unknown = (error.status is None or error.status == 408
                                           or error.status >= 500)
            raise
        assignment = result.get("addAssigneesToAssignable")
        assignable = assignment.get("assignable") if isinstance(assignment, dict) else None
        assignees = assignable.get("assignees") if isinstance(assignable, dict) else None
        nodes = assignees.get("nodes") if isinstance(assignees, dict) else None
        # GitHub's assignment preview returns the same Bot as "Copilot" here,
        # although suggestedActors uses "copilot-swe-agent". Confirm identity
        # with the selected immutable actor id, rather than its display login.
        if not isinstance(assignable, dict) or assignable.get("id") != issue["id"] or not isinstance(nodes, list) or not any(
            isinstance(node, dict) and node.get("id") == bot["id"]
            for node in nodes
        ):
            raise APIError("Copilot assignment not confirmed", write_outcome_unknown=True)
        return result

    def repair_comment(self, pr_number: int, body: str):
        """Mention @copilot on the existing PR with a user identity.

        The documented comment API cannot select a model; GitHub continues the
        original PR model. The policy layer owns deduplication and eligibility.
        Documentation: https://docs.github.com/en/copilot/how-tos/
        use-copilot-agents/cloud-agent/use-cloud-agent-on-github
        """
        return self.request("POST", f"/repos/{self.repo}/issues/{pr_number}/comments",
                            {"body": body}, user_token=True)
