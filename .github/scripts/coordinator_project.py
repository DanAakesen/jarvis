"""Read the selected personal Projects board and update confirmed assignments.

Project membership supplements PLAN, dependencies and issue worker ownership;
the coordinator still owns those checks and confirms assignment before moving
an item. No project prose is logged and no mutation is retried.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

from coordinator_api import APIError

DEFAULT_PROJECT_URL = "https://github.com/users/DanAakesen/projects/2"
MAX_PROJECT_PAGES = 50
ITEM_FRAGMENT = """
fragment CoordinatorProjectItem on ProjectV2Item {
  id isArchived project { id }
  content {
    __typename
    ... on Issue { number state repository { nameWithOwner } }
  }
  fieldValueByName(name:$status) {
    __typename
    ... on ProjectV2ItemFieldSingleSelectValue {
      optionId field { ... on ProjectV2SingleSelectField { id } }
    }
  }
}
"""


def _next_cursor(connection, seen):
    page = connection.get("pageInfo")
    if not isinstance(page, dict) or not isinstance(page.get("hasNextPage"), bool):
        raise APIError("project pagination unavailable")
    if not page["hasNextPage"]:
        return None
    cursor = page.get("endCursor")
    if not isinstance(cursor, str) or not cursor or cursor in seen:
        raise APIError("project pagination cursor invalid")
    seen.add(cursor)
    return cursor


class ProjectBoard:
    def __init__(self, api, project_url=DEFAULT_PROJECT_URL):
        parsed = urlsplit(project_url)
        match = re.fullmatch(r"/users/([A-Za-z0-9][A-Za-z0-9-]{0,38})/projects/([1-9][0-9]{0,9})(?:/views/[1-9][0-9]{0,9})?/?", parsed.path)
        if (parsed.scheme != "https" or parsed.netloc != "github.com" or parsed.query
                or parsed.fragment or not match):
            raise APIError("invalid personal project URL")
        self.api = api
        self.owner = match[1]
        self.number = int(match[2])
        if self.number > 2147483647:
            raise APIError("invalid personal project number")
        self.project_id = None
        self.status_id = None
        self.status_name = None
        self.ready_id = None
        self.progress_id = None

    def _project(self, data):
        user = data.get("user") if isinstance(data, dict) else None
        project = user.get("projectV2") if isinstance(user, dict) else None
        if (not isinstance(project, dict) or not isinstance(project.get("id"), str)
                or not project["id"] or project.get("closed") is not False):
            raise APIError("personal project unavailable or closed")
        if project.get("viewerCanUpdate") is not True:
            raise APIError("personal project is not writable")
        return project

    def _metadata(self):
        fields = []
        cursor = None
        seen = set()
        project_id = None
        for _ in range(MAX_PROJECT_PAGES):
            data = self.api.project_graphql("""
                query($owner:String!, $number:Int!, $cursor:String) {
                  user(login:$owner) {
                    projectV2(number:$number) {
                      id closed viewerCanUpdate
                      fields(first:100,after:$cursor) {
                        nodes {
                          __typename
                          ... on ProjectV2FieldCommon { id name }
                          ... on ProjectV2SingleSelectField { options { id name } }
                        }
                        pageInfo { hasNextPage endCursor }
                      }
                    }
                  }
                }
                """, {"owner": self.owner, "number": self.number, "cursor": cursor})
            project = self._project(data)
            if project_id is not None and project_id != project["id"]:
                raise APIError("project changed during pagination")
            project_id = project["id"]
            connection = project.get("fields")
            if not isinstance(connection, dict) or not isinstance(connection.get("nodes"), list):
                raise APIError("project fields unavailable")
            fields.extend(connection["nodes"])
            cursor = _next_cursor(connection, seen)
            if cursor is None:
                break
        else:
            raise APIError("project field pagination limit exceeded")
        if any(not isinstance(field, dict) or not isinstance(field.get("name"), str) for field in fields):
            raise APIError("project field metadata unavailable")
        statuses = [field for field in fields if field["name"].casefold() == "status"]
        if len(statuses) != 1 or statuses[0].get("__typename") != "ProjectV2SingleSelectField":
            raise APIError("project needs one Status single-select field")
        status = statuses[0]
        options = status.get("options")
        if (not isinstance(status.get("id"), str) or not status["id"] or not isinstance(options, list)
                or any(not isinstance(option, dict) or not isinstance(option.get("name"), str)
                       or not isinstance(option.get("id"), str) or not option["id"] for option in options)):
            raise APIError("project status options unavailable")
        ready = [option for option in options if option["name"].casefold() == "ready"]
        progress = [option for option in options if option["name"].casefold() == "in progress"]
        if len(ready) != 1 or len(progress) != 1 or ready[0]["id"] == progress[0]["id"]:
            raise APIError("project needs unique Ready and In progress options")
        self.project_id = project_id
        self.status_id = status["id"]
        self.status_name = status["name"]
        self.ready_id = ready[0]["id"]
        self.progress_id = progress[0]["id"]

    def _issue_number(self, item):
        if (not isinstance(item, dict) or item.get("isArchived") is not False
                or not isinstance(item.get("id"), str) or not item["id"]
                or not isinstance(item.get("project"), dict) or item["project"].get("id") != self.project_id):
            return None
        content = item.get("content")
        if not isinstance(content, dict) or content.get("__typename") != "Issue" or content.get("state") != "OPEN":
            return None
        repository = content.get("repository")
        if (not isinstance(repository, dict) or not isinstance(repository.get("nameWithOwner"), str)
                or repository["nameWithOwner"].casefold() != self.api.repo.casefold()):
            return None
        number = content.get("number")
        return number if type(number) is int and number > 0 else None

    def _option(self, item):
        value = item.get("fieldValueByName")
        if (not isinstance(value, dict) or value.get("__typename") != "ProjectV2ItemFieldSingleSelectValue"
                or not isinstance(value.get("field"), dict) or value["field"].get("id") != self.status_id):
            return None
        return value.get("optionId")

    def ready_items(self):
        self._metadata()
        result = {}
        cursor = None
        seen = set()
        for _ in range(MAX_PROJECT_PAGES):
            data = self.api.project_graphql("""
                query($owner:String!, $number:Int!, $cursor:String, $status:String!) {
                  user(login:$owner) {
                    projectV2(number:$number) {
                      id closed viewerCanUpdate
                      items(first:100,after:$cursor) {
                        nodes { ...CoordinatorProjectItem }
                        pageInfo { hasNextPage endCursor }
                      }
                    }
                  }
                }
                """ + ITEM_FRAGMENT, {"owner": self.owner, "number": self.number,
                                        "cursor": cursor, "status": self.status_name})
            project = self._project(data)
            if project["id"] != self.project_id:
                raise APIError("project changed during item pagination")
            connection = project.get("items")
            if not isinstance(connection, dict) or not isinstance(connection.get("nodes"), list):
                raise APIError("project items unavailable")
            for item in connection["nodes"]:
                number = self._issue_number(item)
                if number is None or self._option(item) != self.ready_id:
                    continue
                if number in result:
                    raise APIError("duplicate Ready project issue")
                result[number] = item["id"]
            cursor = _next_cursor(connection, seen)
            if cursor is None:
                return result
        raise APIError("project item pagination limit exceeded")

    def _item(self, item_id):
        data = self.api.project_graphql("""
            query($item:ID!, $status:String!) {
              node(id:$item) {
                __typename
                ... on ProjectV2Item { ...CoordinatorProjectItem }
              }
            }
            """ + ITEM_FRAGMENT, {"item": item_id, "status": self.status_name})
        node = data.get("node") if isinstance(data, dict) else None
        return node if isinstance(node, dict) and node.get("__typename") == "ProjectV2Item" else None

    def is_ready(self, item_id, issue_number):
        self._metadata()
        item = self._item(item_id)
        return (item is not None and item.get("id") == item_id
                and self._issue_number(item) == issue_number and self._option(item) == self.ready_id)

    def move_in_progress(self, item_id, issue_number):
        """Call only after assignment confirmation; preserve intervening moves."""
        self._metadata()
        item = self._item(item_id)
        if item is None or item.get("id") != item_id or self._issue_number(item) != issue_number:
            return False
        if self._option(item) == self.progress_id:
            return True
        if self._option(item) != self.ready_id:
            return False
        data = self.api.project_graphql("""
            mutation($input:UpdateProjectV2ItemFieldValueInput!, $status:String!) {
              updateProjectV2ItemFieldValue(input:$input) {
                projectV2Item { ...CoordinatorProjectItem }
              }
            }
            """ + ITEM_FRAGMENT, {"input": {"projectId": self.project_id, "itemId": item_id,
                                          "fieldId": self.status_id,
                                          "value": {"singleSelectOptionId": self.progress_id}},
                                   "status": self.status_name})
        mutation = data.get("updateProjectV2ItemFieldValue") if isinstance(data, dict) else None
        updated = mutation.get("projectV2Item") if isinstance(mutation, dict) else None
        if (not isinstance(updated, dict) or updated.get("id") != item_id or self._issue_number(updated) != issue_number
                or self._option(updated) != self.progress_id):
            raise APIError("project status update not confirmed")
        return True
