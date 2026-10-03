"""Offline Projects contracts, including races between Ready and assignment."""

import copy
import unittest
from unittest.mock import patch

from coordinator_api import APIError
from coordinator_project import ProjectBoard


def status_field(**overrides):
    return {"id": "STATUS", "name": "Status", "__typename": "ProjectV2SingleSelectField",
            "options": [{"id": "READY", "name": "Ready"},
                        {"id": "PROGRESS", "name": "In progress"},
                        {"id": "DONE", "name": "Done"}], **overrides}


def item(number=7, item_id="ITEM-7", option="READY", **overrides):
    return {"id": item_id, "__typename": "ProjectV2Item", "isArchived": False,
            "project": {"id": "PROJECT"},
            "content": {"__typename": "Issue", "number": number, "state": "OPEN",
                        "repository": {"nameWithOwner": "DanAakesen/jarvis"}},
            "fieldValueByName": {"__typename": "ProjectV2ItemFieldSingleSelectValue", "optionId": option,
                                 "field": {"id": "STATUS"}}, **overrides}


class ProjectAPI:
    repo = "DanAakesen/jarvis"

    def __init__(self):
        self.calls = []
        self.fields = [[status_field()]]
        self.items = [[item()]]
        self.project_id = "PROJECT"
        self.closed = False
        self.writable = True
        self.project_missing = False
        self.mutation_response = None
        self.cursor_override = None

    def project_graphql(self, query, variables):
        self.calls.append((query, copy.deepcopy(variables)))
        if "fields(first:" in query or "items(first:" in query:
            if self.project_missing:
                return {"user": {"projectV2": None}}
            fields = "fields(first:" in query
            pages = self.fields if fields else self.items
            cursor = variables.get("cursor")
            page_index = int(cursor.split("-")[1]) if cursor else 0
            more = page_index < len(pages) - 1
            next_cursor = f"page-{page_index + 1}" if more else None
            connection = {"nodes": copy.deepcopy(pages[page_index]),
                          "pageInfo": {"hasNextPage": more,
                                       "endCursor": self.cursor_override if more and self.cursor_override else next_cursor}}
            return {"user": {"projectV2": {"id": self.project_id, "closed": self.closed,
                                          "viewerCanUpdate": self.writable,
                                          "fields" if fields else "items": connection}}}
        if "node(id:$item)" in query:
            value = next((value for page in self.items for value in page if value["id"] == variables["item"]), None)
            return {"node": copy.deepcopy(value)}
        if "updateProjectV2ItemFieldValue" in query:
            if self.mutation_response is not None:
                return copy.deepcopy(self.mutation_response)
            mutation = variables["input"]
            value = next(value for page in self.items for value in page if value["id"] == mutation["itemId"])
            value["fieldValueByName"]["optionId"] = mutation["value"]["singleSelectOptionId"]
            return {"updateProjectV2ItemFieldValue": {"projectV2Item": copy.deepcopy(value)}}
        raise AssertionError("Unexpected project operation")

    def writes(self):
        return [(query, variables) for query, variables in self.calls if "mutation(" in query]


class ProjectBoardTests(unittest.TestCase):
    def setUp(self):
        self.api = ProjectAPI()
        self.board = ProjectBoard(self.api)

    def test_resolves_default_personal_project_and_ready_status(self):
        self.assertEqual(self.board.ready_items(), {7: "ITEM-7"})
        variables = self.api.calls[0][1]
        self.assertEqual((variables["owner"], variables["number"]), ("DanAakesen", 2))
        self.assertEqual(self.api.writes(), [])

    def test_fields_and_items_paginate_with_separate_bounded_cursors(self):
        self.api.fields = [[{"id": "TITLE", "name": "Title", "__typename": "ProjectV2Field"}],
                           [status_field()]]
        self.api.items = [[item()], [item(8, "ITEM-8")]]
        self.assertEqual(self.board.ready_items(), {7: "ITEM-7", 8: "ITEM-8"})
        self.assertEqual([variables["cursor"] for _, variables in self.api.calls], [None, "page-1", None, "page-1"])

    def test_case_insensitive_status_names_and_options_use_actual_field_name(self):
        self.api.fields = [[status_field(name="STATUS", options=[{"id": "READY", "name": "ready"},
                                                                {"id": "PROGRESS", "name": "IN PROGRESS"}])]]
        self.assertEqual(self.board.ready_items(), {7: "ITEM-7"})
        self.assertEqual(self.api.calls[-1][1]["status"], "STATUS")

    def test_missing_or_ambiguous_status_field_stops_without_writes(self):
        for fields in [[], [status_field(), status_field(id="OTHER")],
                       [status_field(__typename="ProjectV2Field")], [None]]:
            with self.subTest(fields=fields):
                self.api.fields = [fields]
                with self.assertRaises(APIError):
                    self.board.ready_items()
                self.assertEqual(self.api.writes(), [])

    def test_missing_ambiguous_or_aliased_status_options_stop_without_writes(self):
        for options in [[], [{"id": "READY", "name": "Ready"}],
                        [{"id": "READY", "name": "Ready"}, {"id": "READY2", "name": "READY"},
                         {"id": "PROGRESS", "name": "In progress"}],
                        [{"id": "READY", "name": "Ready"}, {"id": "READY", "name": "In progress"}],
                        [None]]:
            with self.subTest(options=options):
                self.api.fields = [[status_field(options=options)]]
                with self.assertRaises(APIError):
                    self.board.ready_items()
                self.assertEqual(self.api.writes(), [])

    def test_archived_foreign_closed_draft_and_pull_request_items_are_ignored(self):
        values = [item(), item(8, "ARCHIVED", isArchived=True)]
        foreign = item(9, "FOREIGN")
        foreign["content"]["repository"]["nameWithOwner"] = "DanAakesen/another-repository"
        values.append(foreign)
        closed = item(10, "CLOSED")
        closed["content"]["state"] = "CLOSED"
        values.append(closed)
        for kind in ["DraftIssue", "PullRequest"]:
            value = item(11, kind)
            value["content"]["__typename"] = kind
            values.append(value)
        values.append(item(12, "OTHER-PROJECT", project={"id": "OTHER"}))
        values.append(item(13, "EMPTY", content=None))
        self.api.items = [values]
        self.assertEqual(self.board.ready_items(), {7: "ITEM-7"})

    def test_non_ready_missing_status_and_wrong_field_are_ignored(self):
        wrong = item(10, "WRONG-FIELD")
        wrong["fieldValueByName"]["field"]["id"] = "OTHER"
        self.api.items = [[item(), item(8, "IN-PROGRESS", option="PROGRESS"),
                           item(9, "NO-STATUS", fieldValueByName=None), wrong]]
        self.assertEqual(self.board.ready_items(), {7: "ITEM-7"})

    def test_duplicate_ready_issue_membership_fails_closed(self):
        self.api.items = [[item(), item(7, "DUPLICATE")]]
        with self.assertRaisesRegex(APIError, "duplicate Ready project issue"):
            self.board.ready_items()

    def test_closed_or_unavailable_project_fails_closed(self):
        self.api.closed = True
        with self.assertRaisesRegex(APIError, "unavailable or closed"):
            self.board.ready_items()
        self.api.closed = False
        self.api.project_missing = True
        with self.assertRaisesRegex(APIError, "unavailable or closed"):
            self.board.ready_items()

    def test_read_only_project_access_fails_before_ready_issue_assignment(self):
        for permission in [False, None]:
            with self.subTest(permission=permission):
                self.api.writable = permission
                with self.assertRaisesRegex(APIError, "not writable"):
                    self.board.ready_items()
                self.assertEqual(self.api.writes(), [])

    def test_pagination_limit_never_returns_partial_ready_results(self):
        self.api.items = [[item()], [item(8, "ITEM-8")]]
        with patch("coordinator_project.MAX_PROJECT_PAGES", 1), self.assertRaisesRegex(APIError, "item pagination limit"):
            self.board.ready_items()
        self.api.items = [[item()]]
        self.api.fields = [[status_field()], [status_field(id="OTHER")]]
        with patch("coordinator_project.MAX_PROJECT_PAGES", 1), self.assertRaisesRegex(APIError, "field pagination limit"):
            self.board.ready_items()

    def test_pagination_cycle_is_rejected(self):
        self.api.items = [[item()], [item(8, "ITEM-8")], [item(9, "ITEM-9")]]
        self.api.cursor_override = "page-1"
        with self.assertRaisesRegex(APIError, "pagination cursor invalid"):
            self.board.ready_items()

    def test_ready_item_is_refreshed_before_claim(self):
        self.assertEqual(self.board.ready_items(), {7: "ITEM-7"})
        self.assertTrue(self.board.is_ready("ITEM-7", 7))
        self.api.items[0][0]["fieldValueByName"]["optionId"] = "DONE"
        self.assertFalse(self.board.is_ready("ITEM-7", 7))
        self.assertEqual(self.api.writes(), [])

    def test_removed_archived_foreign_or_different_issue_cannot_be_claimed(self):
        self.api.items = [[]]
        self.assertFalse(self.board.is_ready("ITEM-7", 7))
        self.api.items = [[item(isArchived=True)]]
        self.assertFalse(self.board.is_ready("ITEM-7", 7))
        self.api.items = [[item()]]
        self.assertFalse(self.board.is_ready("ITEM-7", 8))
        self.api.items[0][0]["content"]["repository"]["nameWithOwner"] = "other/repo"
        self.assertFalse(self.board.is_ready("ITEM-7", 7))

    def test_status_configuration_is_refreshed_before_claim_and_move(self):
        self.board.ready_items()
        self.api.fields[0][0]["options"][0]["name"] = "Backlog"
        for action in [self.board.is_ready, self.board.move_in_progress]:
            with self.subTest(action=action), self.assertRaisesRegex(APIError, "unique Ready and In progress"):
                action("ITEM-7", 7)
        self.assertEqual(self.api.writes(), [])

    def test_successful_move_uses_exact_project_item_field_and_option_ids(self):
        self.assertTrue(self.board.move_in_progress("ITEM-7", 7))
        writes = self.api.writes()
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][1], {"input": {"projectId": "PROJECT", "itemId": "ITEM-7", "fieldId": "STATUS",
                                                "value": {"singleSelectOptionId": "PROGRESS"}}, "status": "Status"})
        self.assertEqual(self.api.items[0][0]["fieldValueByName"]["optionId"], "PROGRESS")

    def test_user_status_change_or_removed_item_before_move_is_preserved(self):
        for values in [[item(option="DONE")], []]:
            with self.subTest(values=values):
                self.api.items = [values]
                self.assertFalse(self.board.move_in_progress("ITEM-7", 7))
                self.assertEqual(self.api.writes(), [])

    def test_already_in_progress_is_idempotent_without_mutation(self):
        self.api.items = [[item(option="PROGRESS")]]
        self.assertTrue(self.board.move_in_progress("ITEM-7", 7))
        self.assertEqual(self.api.writes(), [])

    def test_status_mutation_must_confirm_same_item_issue_and_new_status(self):
        for updated in [item(item_id="WRONG"), item(option="READY"), item(8), None, "invalid"]:
            with self.subTest(updated=updated):
                self.api.mutation_response = {"updateProjectV2ItemFieldValue": {"projectV2Item": updated}}
                with self.assertRaisesRegex(APIError, "status update not confirmed"):
                    self.board.move_in_progress("ITEM-7", 7)

    def test_project_url_accepts_view_suffix_and_rejects_untrusted_shapes(self):
        viewed = ProjectBoard(self.api, "https://github.com/users/DanAakesen/projects/2/views/1")
        self.assertEqual((viewed.owner, viewed.number), ("DanAakesen", 2))
        for url in ["https://evil.example/users/DanAakesen/projects/2",
                    "http://github.com/users/DanAakesen/projects/2", "https://github.com/orgs/DanAakesen/projects/2",
                    "https://github.com/users/DanAakesen/projects/0", "https://github.com/users/DanAakesen/projects/9999999999",
                    "https://user:private@github.com/users/DanAakesen/projects/2",
                    "https://github.com/users/DanAakesen/projects/2?private=secret"]:
            with self.subTest(url=url), self.assertRaises(APIError) as caught:
                ProjectBoard(self.api, url)
            self.assertNotIn("private", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
