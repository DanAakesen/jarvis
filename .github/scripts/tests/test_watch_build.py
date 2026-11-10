import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class WatchBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(
            ["ruby", "-ryaml", "-rjson", "-e",
             "puts JSON.generate(YAML.safe_load_file(ARGV[0]))",
             str(ROOT / ".github/workflows/watch-build.yml")],
            check=True, capture_output=True, text=True,
        )
        cls.workflow = json.loads(result.stdout)
        cls.steps = cls.workflow["jobs"]["watch"]["steps"]

    def test_existing_builds_remain_and_checkout_is_exact_head(self):
        checkout = next(step for step in self.steps if step.get("uses", "").startswith("actions/checkout@"))
        self.assertEqual(checkout["with"]["ref"], "${{ github.event.pull_request.head.sha }}")
        shell = "\n".join(step.get("run", "") for step in self.steps)
        for destination in ["watchOS Simulator", "generic/platform=watchOS", "iOS Simulator"]:
            self.assertIn(destination, shell)
        self.assertIn("watch-head.txt", shell)
        for step in self.steps:
            if "run" in step:
                subprocess.run(["bash", "-n"], input=step["run"], text=True, check=True)

    def test_captures_reject_stale_processes_and_require_destination_receipts(self):
        capture = next(step["run"] for step in self.steps if step.get("name", "").startswith("Capture intended"))
        self.assertNotIn("--terminate-running-process", capture)
        self.assertIn('simctl terminate "$device" "$BUNDLE"', capture)
        self.assertIn('test "$pid" != "$PREVIOUS_PID"', capture)
        self.assertIn('kill -0 "$PREVIOUS_PID"', capture)
        self.assertIn(".captureID == $id and .screen == $screen and .pid == $pid", capture)
        self.assertLess(capture.index("watch-capture.json"), capture.index('simctl io "$device" screenshot'))
        self.assertIn("return 1", capture)
        for screen in ["task-detail", "task-edit", "personal-new-task-manual", "workouts body-fat tasks notes",
                       "log-lift-complication", "saved missing uncertain deleted", "small-$SCREEN"]:
            self.assertIn(screen, capture)
        self.assertIn('"dashboard-$SECTION" "--watch-dashboard-section=$SECTION"', capture)

    def test_url_delivery_failure_is_not_replaced_by_fixture_navigation(self):
        step = next(step for step in self.steps if step.get("name", "").startswith("Verify external URL"))
        self.assertEqual(step["if"], "${{ !cancelled() && env.WATCH_ID != '' }}")
        delivery = step["run"]
        self.assertIn("set -euo pipefail", delivery)
        self.assertIn('simctl openurl "$WATCH_ID" "jarvis-watch://$ROUTE"', delivery)
        self.assertNotIn("--watch-screen=", delivery)
        self.assertNotIn("|| true", delivery)
        self.assertIn("watch-open-url.json", delivery)
        self.assertIn("watch-capture.json", delivery)
        self.assertIn("tasks log-lift", delivery)
        self.assertLess(delivery.index('test "$READY" = true'), delivery.index('simctl openurl'))

    def test_fixture_destinations_are_initial_state_not_launch_time_push_and_sheet_chains(self):
        app = (ROOT / "apps/ios/Watch/JarvisWatchApp.swift").read_text()
        start = app.index("struct WatchRoot")
        initializer = app[app.index("init()", start):app.index("var body:", start)]
        self.assertIn('guard arguments.contains("--watch-fixture")', initializer)
        self.assertIn("_path = State(initialValue: path)", initializer)
        self.assertIn('arguments.contains("--watch-screen=task-edit") { path = [.taskEdit] }', initializer)
        self.assertIn('case .taskEdit: WatchPersonalTaskEditor(task: WatchPreview.captureTask())', app)
        self.assertIn('case .personalNewTask: WatchPersonalTaskEditor', app)
        self.assertIn('arguments.contains("--watch-screen=project") { path = [.project] }', initializer)
        self.assertIn('case .project:', app)
        capture = next(step["run"] for step in self.steps if step.get("name", "").startswith("Capture intended"))
        self.assertIn('$name-failed.png', capture)

    def test_receipt_alone_cannot_publish_a_screenshot(self):
        capture = next(step["run"] for step in self.steps if step.get("name", "").startswith("Capture intended"))
        self.assertIn('verify-watch-capture" "$name"', capture)
        self.assertLess(capture.index('verify-watch-capture" "$name"'), capture.index('mv "$RUNNER_TEMP/watch-screenshots/$name-pending.png"'))
        delivery = next(step["run"] for step in self.steps if step.get("name", "").startswith("Verify external URL"))
        self.assertIn('verify-watch-capture" "$ROUTE-deep-link"', delivery)
        self.assertIn('.captureID == $id and .pid == $pid and .url == $url', delivery)

    @unittest.skipUnless(shutil.which("swiftc"), "Swift compiler required for screenshot content matcher")
    def test_destination_content_rejects_startup_wrong_scene_and_wrapped_tabs(self):
        with tempfile.TemporaryDirectory() as directory:
            verifier = str(Path(directory) / "verify-watch-capture")
            subprocess.run(["swiftc", str(ROOT / ".github/scripts/verify_watch_capture.swift"), "-o", verifier], check=True)
            for name, text, accepted in [
                ("task-detail", "Jarvis", False),
                ("project", "Jarvis", False),
                ("task-edit", "Today Upcoming Call dentist", False),
                ("tasks", "Today Upcom- ing Call dentist", False),
                ("task-detail", "Task Edit Call dentist Due Today 17:00 Priority Low", True),
                ("task-detail", "7:47\nTask\nEdit\nCall dentist\nDue\nToday, 17:00", True),
                ("task-detail", "Task Edit Call dentist", False),
                ("task-detail", "Today Upcoming Call dentist Due Today 17:00", False),
                ("task-edit", "Edit task Title Call dentist", True),
                ("project", "Fixture project No tasks", True),
                ("tasks", "Today Upcoming Pay phone bill", True),
                ("unknown-scene", "Jarvis", False),
            ]:
                result = subprocess.run([verifier, "--recognized-text", name, text], capture_output=True)
                self.assertEqual(result.returncode == 0, accepted, (name, text))

    def test_actual_watch_target_registers_the_same_url_scheme(self):
        with (ROOT / "apps/ios/Watch/Info.plist").open("rb") as file:
            info = plistlib.load(file)
        self.assertTrue(info["WKApplication"])
        self.assertIn("jarvis-watch", [
            scheme for entry in info["CFBundleURLTypes"] for scheme in entry["CFBundleURLSchemes"]
        ])
        self.assertEqual(info["CFBundleURLTypes"][0]["CFBundleTypeRole"], "Editor")
        boot = next(step["run"] for step in self.steps if step.get("name", "").startswith("Boot and inspect"))
        self.assertIn("built-info.json", boot)
        self.assertIn("installed-info.json", boot)

    def test_widget_kinds_and_dashboard_shortcut_both_survive_integration(self):
        widgets = (ROOT / "apps/ios/WatchWidgets/JarvisWatchWidgets.swift").read_text()
        for kind in ["health", "tasks", "dictate", "voice", "nutrition", "home", "task-list", "body-fat", "logLift"]:
            self.assertIn(f'kind: "jarvis.watch.{kind}"', widgets)
        self.assertIn(".widgetURL(WatchAppLink.logLift.url)", widgets)
        dashboard = (ROOT / "apps/ios/Watch/WatchDashboardViews.swift").read_text()
        self.assertIn('WatchDashboardSection(title: "Workouts", route: .workouts)', dashboard)
        self.assertIn("WatchLogLiftShortcut()", dashboard)
        self.assertNotIn("WatchLiftHomeSummary", (ROOT / "apps/ios/Watch/JarvisWatchApp.swift").read_text())
