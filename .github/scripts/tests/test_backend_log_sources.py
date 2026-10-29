import json
import unittest

from backend_log_preflight import PreflightBlocked, inspect
from backend_log_sources import catalogue
from pipeline_impact import deploy_parts
from test_backend_log_preflight import EXPECTED, FOUNDRY, FakeAzure


class SourceOwnershipTests(unittest.TestCase):
    def test_requires_both_an_exact_expected_id_and_a_jarvis_ownership_tag(self):
        rows = [{"id": EXPECTED["app_id"], "tags": {"project": "jarvis"}},
                {"id": FOUNDRY, "tags": {"project": "unrelated"}},
                {"id": EXPECTED["group"] + "/providers/Microsoft.App/containerApps/unrelated", "tags": {"project": "jarvis"}}]
        report = catalogue(EXPECTED, FOUNDRY, rows, [])
        self.assertEqual(report["owned_resources"], {"backend": EXPECTED["app_id"]})
        self.assertEqual(report["sources"]["foundry"], "ownership_unverified")
        self.assertEqual(report["sources"]["storage"], "not_found")
        self.assertIn("whole_jarvis_source_backend_owned", report["findings"])
        self.assertIn("whole_jarvis_source_foundry_ownership_unverified", report["findings"])
        self.assertNotIn(EXPECTED["app_id"], json.dumps(report["findings"]))
        self.assertFalse(report["workspace_entirely_owned"])
        self.assertFalse(report["new_grants_approved"])
        self.assertFalse(report["reader_enabled"])

    def test_missing_reads_are_unavailable_and_duplicate_ids_are_rejected(self):
        report = catalogue(EXPECTED, FOUNDRY, None, None)
        self.assertEqual(set(report["sources"].values()), {"unavailable"})
        self.assertFalse(report["resource_inventory_read"])
        self.assertFalse(report["table_inventory_read"])
        row = {"id": EXPECTED["app_id"], "tags": {"project": "jarvis"}}
        with self.assertRaises(ValueError):
            catalogue(EXPECTED, FOUNDRY, [row, {**row, "id": row["id"].upper()}], [])

    def test_classifies_only_known_table_metadata_without_retaining_rows_or_fields(self):
        table = {"id": EXPECTED["workspace_id"] + "/tables/AppTraces", "properties": {"plan": "Analytics",
                 "schema": {"standardColumns": [{"name": "_ResourceId", "type": "string"}]},
                 "rows": ["synthetic-private-record"]}}
        report = catalogue(EXPECTED, FOUNDRY, [], [table])
        self.assertEqual(report["tables"], {"AppTraces": {"plan": "Analytics", "resource_id_column": True}})
        self.assertIn("whole_jarvis_table_apptraces_analytics", report["findings"])
        self.assertIn("whole_jarvis_table_apptraces_resource_id_present", report["findings"])
        self.assertNotIn("synthetic-private-record", json.dumps(report))
        table["properties"]["schema"] = {}
        self.assertFalse(catalogue(EXPECTED, FOUNDRY, [], [table])["tables"]["AppTraces"]["resource_id_column"])
        table["id"] = EXPECTED["workspace_id"] + "/tables/UnrelatedPrivateTable"
        self.assertEqual(catalogue(EXPECTED, FOUNDRY, [], [table])["tables"], {})

    def test_foreign_workspace_table_metadata_is_rejected(self):
        with self.assertRaises(ValueError):
            catalogue(EXPECTED, FOUNDRY, [], [{"id": "/subscriptions/synthetic-foreign/tables/AppTraces"}])

    def test_preflight_stores_the_catalogue_only_in_the_existing_private_report(self):
        azure = FakeAzure()
        azure.resources = [{"id": EXPECTED["app_id"], "tags": {"project": "jarvis"}}]
        report = inspect(EXPECTED, azure)
        self.assertIn("whole_jarvis_scope_planning_only", report["checks"])
        self.assertIn("whole_jarvis_source_backend_owned", report["checks"])
        self.assertEqual(report["whole_jarvis_sources"]["owned_resources"], {"backend": EXPECTED["app_id"]})
        self.assertNotIn(EXPECTED["app_id"], json.dumps(report["checks"]))
        self.assertFalse(report["grant_applied"])
        self.assertFalse(report["reader_enabled"])
        self.assertEqual(deploy_parts(".github/scripts/backend_log_sources.py"), {"infra"})

    def test_inventory_denial_is_incomplete_without_requesting_more_access(self):
        azure = FakeAzure()
        original = azure.pages
        def pages(resource, version, parameters=None):
            if resource.endswith(("/resources", "/tables")):
                raise PreflightBlocked("azure_read_unavailable")
            return original(resource, version, parameters)
        azure.pages = pages
        report = inspect(EXPECTED, azure)
        self.assertIn("whole_jarvis_resource_inventory_unavailable", report["checks"])
        self.assertIn("whole_jarvis_table_inventory_unavailable", report["checks"])
        self.assertEqual(report["whole_jarvis_sources"]["owned_resources"], {})
        self.assertFalse(report["reader_enabled"])


if __name__ == "__main__":
    unittest.main()
