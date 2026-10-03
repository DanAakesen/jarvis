"""Network-boundary tests; no live requests or agent jobs."""

import io
import json
import unittest
from email.message import Message
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from coordinator_api import TIMEOUT_SECONDS, APIError, GitHub, _NoRedirect


def response(data, headers=None):
    result = MagicMock()
    result.__enter__.return_value = result
    result.read.return_value = json.dumps(data).encode("utf-8")
    result.headers = headers or {}
    return result


class GitHubTests(unittest.TestCase):
    def setUp(self):
        self.opener = MagicMock()
        self.patch = patch("coordinator_api.build_opener", return_value=self.opener)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.api = GitHub("owner/repo", "workflow-secret", "user-secret")

    def test_identity_is_selected_explicitly_and_timeout_is_bounded(self):
        self.opener.open.side_effect = [response({"ok": True}), response({"ok": True})]
        self.api.request("GET", "/repos/owner/repo/pulls")
        self.api.request("POST", "/repos/owner/repo/issues/12/comments",
                         {"body": "@copilot resolve conflicts"}, user_token=True)
        ordinary, user = self.opener.open.call_args_list
        self.assertEqual(ordinary.args[0].get_header("Authorization"), "Bearer workflow-secret")
        self.assertEqual(user.args[0].get_header("Authorization"), "Bearer user-secret")
        self.assertEqual(user.kwargs["timeout"], TIMEOUT_SECONDS)
        self.assertEqual(json.loads(user.args[0].data), {"body": "@copilot resolve conflicts"})

    def test_missing_user_token_never_falls_back_to_workflow_token(self):
        api = GitHub("owner/repo", "workflow-secret")
        with self.assertRaisesRegex(APIError, "Copilot user token not configured"):
            api.repair_comment(12, "@copilot resolve conflicts")
        self.opener.open.assert_not_called()

    def test_pagination_follows_all_links_without_losing_query_parameters(self):
        self.opener.open.side_effect = [
            response([{"number": 1}], {"Link": '<https://api.github.com/repos/owner/repo/issues?state=open&page=2&per_page=100>; rel="next", <https://api.github.com/repos/owner/repo/issues?page=2>; rel="last"'}),
            response([{"number": 2}]),
        ]
        self.assertEqual(self.api.pages("/repos/owner/repo/issues?state=open"), [{"number": 1}, {"number": 2}])
        first = self.opener.open.call_args_list[0].args[0].full_url
        self.assertIn("state=open", first)
        self.assertIn("per_page=100", first)

    def test_enveloped_pagination_and_explicit_page_size(self):
        self.opener.open.return_value = response({"check_runs": [{"id": 1}]})
        self.assertEqual(self.api.pages("/repos/owner/repo/commits/abc/check-runs?per_page=50", key="check_runs"), [{"id": 1}])
        self.assertNotIn("per_page=100", self.opener.open.call_args.args[0].full_url)

    def test_malicious_next_link_cannot_receive_token(self):
        self.opener.open.return_value = response([], {"Link": '<https://attacker.example/?signed=secret>; rel="next"'})
        with self.assertRaisesRegex(APIError, "refused API URL") as caught:
            self.api.pages("/repos/owner/repo/issues")
        self.assertNotIn("signed", str(caught.exception))
        self.opener.open.assert_called_once()

    def test_pagination_cycle_fails_instead_of_looping(self):
        self.opener.open.return_value = response([], {"Link": '<https://api.github.com/items?per_page=100>; rel="next"'})
        with self.assertRaisesRegex(APIError, "pagination cycle"):
            self.api.pages("/items")
        self.opener.open.assert_called_once()

    def test_pagination_limit_is_explicit_not_partial_success(self):
        self.opener.open.side_effect = [response([1], {"Link": '<https://api.github.com/items?page=2>; rel="next"'})]
        with patch("coordinator_api.MAX_PAGES", 1), self.assertRaisesRegex(APIError, "pagination limit"):
            self.api.pages("/items")

    def test_invalid_collection_and_invalid_json_fail_closed(self):
        self.opener.open.return_value = response({"message": "private provider details"})
        with self.assertRaisesRegex(APIError, "invalid collection"):
            self.api.pages("/items")
        self.opener.open.return_value.read.return_value = b"private invalid JSON"
        with self.assertRaisesRegex(APIError, "invalid JSON") as caught:
            self.api.request("GET", "/items")
        self.assertNotIn("private", str(caught.exception))

    def test_response_and_request_limits_are_enforced(self):
        self.opener.open.return_value = response({"lots": "content"})
        with patch("coordinator_api.MAX_RESPONSE_BYTES", 2), self.assertRaisesRegex(APIError, "response size"):
            self.api.request("GET", "/items")
        self.opener.open.reset_mock()
        with patch("coordinator_api.MAX_REQUEST_BYTES", 2), self.assertRaisesRegex(APIError, "request size"):
            self.api.request("POST", "/items", {"lots": "content"})
        self.opener.open.assert_not_called()

    def test_no_content_delete_is_success(self):
        self.opener.open.return_value = response(None)
        self.opener.open.return_value.read.return_value = b""
        self.assertIsNone(self.api.request("DELETE", "/items/1"))

    def test_http_error_messages_never_echo_secrets_and_writes_are_not_retried(self):
        for status, category in [(401, "authentication rejected"), (403, "access denied"),
                                 (404, "resource unavailable"), (409, "conflict"),
                                 (422, "request rejected"), (500, "request failed")]:
            with self.subTest(status=status):
                self.opener.open.reset_mock()
                self.opener.open.side_effect = HTTPError("https://api.github.com/?signed=user-secret", status,
                    "workflow-secret private prompt", {}, io.BytesIO(b"private provider body"))
                with self.assertRaises(APIError) as caught:
                    self.api.request("POST", "/items", {"prompt": "private prompt"})
                self.assertEqual(caught.exception.status, status)
                self.assertEqual(caught.exception.category, category)
                self.assertNotIn("secret", str(caught.exception))
                self.assertNotIn("private", str(caught.exception))
                self.opener.open.assert_called_once()

    def test_primary_and_secondary_rate_limits_are_distinct_from_access_denial(self):
        for status, headers in [(429, {}), (403, {"X-RateLimit-Remaining": "0"}), (403, {"Retry-After": "60"})]:
            with self.subTest(status=status, headers=headers):
                message = Message()
                for key, value in headers.items():
                    message[key] = value
                self.opener.open.side_effect = HTTPError("https://api.github.com/items", status, "ignored", message, io.BytesIO())
                with self.assertRaises(APIError) as caught:
                    self.api.request("GET", "/items")
                self.assertEqual(caught.exception.category, "rate limit reached")

    def test_network_and_graphql_errors_are_sanitized(self):
        self.opener.open.side_effect = URLError("workflow-secret at signed private URL")
        with self.assertRaisesRegex(APIError, "network request failed") as caught:
            self.api.request("GET", "/items")
        self.assertNotIn("secret", str(caught.exception))
        self.opener.open.side_effect = None
        self.opener.open.return_value = response({"data": {"repository": None}, "errors": [{"message": "user-secret private prompt"}]})
        with self.assertRaisesRegex(APIError, "GraphQL request rejected") as caught:
            self.api.graphql("query { viewer { login } }", {})
        self.assertNotIn("secret", str(caught.exception))

    def test_paths_and_repository_cannot_redirect_credentials(self):
        for path in ["https://evil.example/items", "//evil.example/items", "https://api.github.com.evil.example/items",
                     "https://user:pass@api.github.com/items", "/items#signed", "/items\nsecret", "items"]:
            with self.subTest(path=path), self.assertRaises(APIError):
                self.api.request("GET", path)
        with self.assertRaises(APIError):
            GitHub("owner/repo/../../evil", "secret")
        self.opener.open.assert_not_called()

    def test_redirects_are_refused_without_reading_signed_urls(self):
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 302, "ignored", {}, "https://evil.example"))
        self.opener.open.side_effect = HTTPError("https://api.github.com/items", 302, "signed=user-secret", {"Location": "https://evil.example"}, io.BytesIO())
        with self.assertRaises(APIError) as caught:
            self.api.request("GET", "/items")
        self.assertEqual(caught.exception.status, 302)
        self.opener.open.assert_called_once()

    def test_invalid_token_configuration_cannot_leak_in_urllib_header_errors(self):
        with self.assertRaisesRegex(APIError, "invalid credential configuration") as caught:
            GitHub("owner/repo", "workflow-secret\ninvalid")
        self.assertNotIn("workflow-secret", str(caught.exception))
        self.opener.open.assert_not_called()

    def test_copilot_assignment_uses_user_token_and_exact_model_structured_variables(self):
        self.opener.open.side_effect = [
            response({"data": {"repository": {"id": "REPO", "issue": {"id": "ISSUE", "state": "OPEN", "assignees": {"totalCount": 0, "nodes": []}, "labels": {"totalCount": 1, "nodes": [{"name": "Copilot"}]}}, "suggestedActors": {"nodes": [{"id": "BOT", "login": "copilot-swe-agent"}]}}}}),
            response({"data": {"addAssigneesToAssignable": {"assignable": {"id": "ISSUE", "assignees": {"nodes": [{"login": "copilot-swe-agent"}]}}}}}),
        ]
        instructions = 'Read PLAN.md. Preserve literal quotes " and backticks `.'
        self.api.assign_copilot(12, "main", instructions)
        calls = self.opener.open.call_args_list
        for call in calls:
            self.assertEqual(call.args[0].get_header("Authorization"), "Bearer user-secret")
            self.assertIn("coding_agent_model_selection", call.args[0].get_header("Graphql-features"))
        payload = json.loads(calls[-1].args[0].data)
        agent = payload["variables"]["input"]["agentAssignment"]
        self.assertEqual(agent, {"targetRepositoryId": "REPO", "baseRef": "main",
                                 "customInstructions": instructions, "model": "claude-opus-5.5"})
        self.assertNotIn(instructions, payload["query"])
        self.assertIn("addAssigneesToAssignable", payload["query"])

    def test_unavailable_copilot_is_not_silently_assigned(self):
        self.opener.open.return_value = response({"data": {"repository": {"id": "REPO", "issue": {"id": "ISSUE", "state": "OPEN", "assignees": {"totalCount": 0, "nodes": []}, "labels": {"totalCount": 1, "nodes": [{"name": "Copilot"}]}}, "suggestedActors": {"nodes": []}}}})
        with self.assertRaisesRegex(APIError, "Copilot is not assignable"):
            self.api.assign_copilot(12, "main", "instructions")
        self.opener.open.assert_called_once()

    def test_assignment_response_must_confirm_copilot(self):
        self.opener.open.side_effect = [
            response({"data": {"repository": {"id": "REPO", "issue": {"id": "ISSUE", "state": "OPEN", "assignees": {"totalCount": 0, "nodes": []}, "labels": {"totalCount": 1, "nodes": [{"name": "Copilot"}]}}, "suggestedActors": {"nodes": [{"id": "BOT", "login": "copilot-swe-agent"}]}}}}),
            response({"data": {"addAssigneesToAssignable": {"assignable": {"id": "ISSUE", "assignees": {"nodes": []}}}}}),
        ]
        with self.assertRaisesRegex(APIError, "assignment not confirmed"):
            self.api.assign_copilot(12, "main", "instructions")
        self.assertEqual(self.opener.open.call_count, 2)

    def test_assignment_rechecks_open_issue_and_worker_ownership_before_mutation(self):
        for change in [
            {"state": "CLOSED"},
            {"assignees": {"totalCount": 1, "nodes": [{"login": "someone"}]}},
            {"labels": {"totalCount": 1, "nodes": [{"name": "cOdEx"}]}},
            {"labels": {"totalCount": 1, "nodes": [{"name": "Dan"}]}},
            {"labels": {"totalCount": 1, "nodes": [{"name": "Jarvis"}]}},
            {"labels": {"totalCount": 101, "nodes": []}},
        ]:
            with self.subTest(change=change):
                issue = {"id": "ISSUE", "state": "OPEN",
                         "assignees": {"totalCount": 0, "nodes": []},
                         "labels": {"totalCount": 1, "nodes": [{"name": "Copilot"}]}, **change}
                self.opener.open.reset_mock()
                self.opener.open.return_value = response({"data": {"repository": {
                    "id": "REPO", "issue": issue,
                    "suggestedActors": {"nodes": [{"id": "BOT", "login": "copilot-swe-agent"}]},
                }}})
                with self.assertRaises(APIError):
                    self.api.assign_copilot(12, "main", "instructions")
                self.opener.open.assert_called_once()

    def test_assignment_never_falls_back_to_another_model(self):
        with self.assertRaisesRegex(APIError, "unsupported coordinator Copilot model"):
            self.api.assign_copilot(12, "main", "instructions", model="auto")
        self.opener.open.assert_not_called()


if __name__ == "__main__":
    unittest.main()
