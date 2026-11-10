import json
import os
from pathlib import Path
import plistlib
import re
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

    def test_companion_is_built_paired_and_installed_before_watch_registration(self):
        names = [step.get("name", "") for step in self.steps]
        boot_name = "Boot and inspect paired Watch simulator"
        self.assertLess(names.index("Build paired iPhone bridge without signing"), names.index(boot_name))
        boot = self.steps[names.index(boot_name)]["run"]
        self.assertIn('simctl pair "$WATCH_ID" "$PHONE_ID"', boot)
        self.assertIn('simctl bootstatus "$PHONE_ID" -b', boot)
        self.assertLess(boot.index('simctl install "$PHONE_ID"'), boot.index('simctl install "$WATCH_ID"'))
        self.assertIn('simctl get_app_container "$PHONE_ID" com.danaakesen.jarvis app', boot)
        self.assertIn("pairs-before.json", boot)
        self.assertIn("pairs-installed.json", boot)
        self.assertIn("registered-apps.plist", boot)

    @unittest.skipUnless(shutil.which("jq"), "jq required for simulator workflow")
    def test_pair_selection_reuses_available_companion_or_selects_only_unpaired_phone(self):
        boot = next(step["run"] for step in self.steps if step.get("name", "").startswith("Boot and inspect"))
        queries = re.findall(r'PHONE_ID="\$\((jq -r .*)\)"', boot)
        self.assertEqual(len(queries), 2)
        guard_start = boot.index("if jq -e --arg watch")
        unavailable_guard = boot[guard_start:boot.index('PHONE_ID="$(jq', guard_start)]
        with tempfile.TemporaryDirectory() as directory:
            screenshots = Path(directory) / "watch-screenshots"
            screenshots.mkdir()
            (screenshots / "devices.json").write_text(json.dumps({"devices": {"runtime": [
                {"name": "Apple Watch Ultra", "udid": "watch"},
                {"name": "iPhone 17", "udid": "paired-phone"},
                {"name": "iPhone 17 Pro", "udid": "free-phone"},
            ]}}))
            for watch, phone, expected_existing, expected_free in [
                ("watch", "paired-phone", "paired-phone", "free-phone"),
                ("watch", "unavailable-phone", "", "paired-phone"),
                ("other-watch", "paired-phone", "", "free-phone"),
            ]:
                with self.subTest(watch=watch, phone=phone):
                    (screenshots / "pairs-before.json").write_text(json.dumps({"pairs": {
                        "pair": {"watch": {"udid": watch}, "phone": {"udid": phone}},
                    }}))
                    for query, expected in zip(queries, [expected_existing, expected_free]):
                        result = subprocess.run(
                            ["bash", "-c", query], check=True, capture_output=True, text=True,
                            env={**os.environ, "RUNNER_TEMP": directory, "WATCH_ID": "watch"},
                        )
                        self.assertEqual(result.stdout.strip(), expected)
                    result = subprocess.run(
                        ["bash", "-c", unavailable_guard], capture_output=True, text=True,
                        env={**os.environ, "RUNNER_TEMP": directory, "WATCH_ID": "watch"},
                    )
                    self.assertEqual(result.returncode, 1 if watch == "watch" else 0)
                    if watch == "watch":
                        self.assertIn("refusing to replace its pair", result.stdout)

    @unittest.skipUnless(shutil.which("jq"), "jq required for simulator workflow")
    def test_both_real_urls_are_attempted_and_each_failure_still_fails_the_step(self):
        delivery = next(step["run"] for step in self.steps if step.get("name", "").startswith("Verify external URL"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Documents").mkdir()
            (root / "watch-screenshots").mkdir()
            prelude = r'''
swiftc() { :; }
uuidgen() { echo "nonce"; }
sleep() { :; }
xcrun() {
  case "$2" in
    get_app_container) echo "$RUNNER_TEMP" ;;
    launch)
      printf '{"captureID":"nonce","screen":"dashboard","pid":"99999999"}' > "$RUNNER_TEMP/Documents/watch-capture.json"
      if [[ "$MOCK_LAUNCH_FAILURE" == 1 ]]; then return 42; fi
      echo "watch: 99999999" ;;
    openurl)
      echo "$4" >> "$RUNNER_TEMP/attempted-urls.txt"
      [[ "$4" != "jarvis-watch://$MOCK_FAILED_ROUTE" ]] || return 115 ;;
  esac
}
'''
            for failed_route in ["tasks", "log-lift"]:
                with self.subTest(failed_route=failed_route):
                    attempted = root / "attempted-urls.txt"
                    attempted.unlink(missing_ok=True)
                    result = subprocess.run(
                        ["bash", "-c", prelude + delivery], capture_output=True, text=True,
                        env={**os.environ, "RUNNER_TEMP": directory, "WATCH_ID": "watch",
                             "MOCK_FAILED_ROUTE": failed_route, "MOCK_LAUNCH_FAILURE": "0"},
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(attempted.read_text().splitlines(), [
                        "jarvis-watch://tasks", "jarvis-watch://log-lift",
                    ])
                    self.assertEqual((root / "watch-screenshots" / f"{failed_route}-delivery-status.txt").read_text().strip(), "115")
                    other = "log-lift" if failed_route == "tasks" else "tasks"
                    # A zero transport exit without real receipts/rendered content is not success.
                    self.assertEqual((root / "watch-screenshots" / f"{other}-delivery-status.txt").read_text().strip(), "1")
            attempted.unlink()
            result = subprocess.run(
                ["bash", "-c", prelude + delivery], capture_output=True, text=True,
                env={**os.environ, "RUNNER_TEMP": directory, "WATCH_ID": "watch",
                     "MOCK_FAILED_ROUTE": "tasks", "MOCK_LAUNCH_FAILURE": "1"},
            )
            self.assertEqual(result.returncode, 42)
            self.assertFalse(attempted.exists(), "A failed app launch must stop that route before URL dispatch")
            for route in ["tasks", "log-lift"]:
                self.assertEqual((root / "watch-screenshots" / f"{route}-delivery-status.txt").read_text().strip(), "42")
                archived = root / "watch-screenshots" / f"{route}-attempt-watch-capture.json"
                self.assertEqual(json.loads(archived.read_text())["captureID"], "nonce")

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

    def test_external_url_failure_retains_transport_status_and_launchservices_evidence(self):
        delivery = next(step["run"] for step in self.steps if step.get("name", "").startswith("Verify external URL"))
        self.assertIn('if xcrun simctl openurl', delivery)
        self.assertIn('STATUS=$?', delivery)
        self.assertIn('$ROUTE-openurl.log', delivery)
        self.assertIn('$ROUTE-openurl-status.txt', delivery)
        self.assertIn('exit "$STATUS"', delivery)
        diagnostics = next(step for step in self.steps if step.get("name") == "Preserve simulator failure diagnostics")
        self.assertEqual(diagnostics["if"], "${{ failure() && env.WATCH_ID != '' }}")
        self.assertEqual(diagnostics["timeout-minutes"], 2)
        self.assertIn('failure-current-screen.png', diagnostics["run"])
        self.assertIn('failure-$RECEIPT.json', diagnostics["run"])
        self.assertIn('subsystem CONTAINS[c] "launchservices"', diagnostics["run"])
        self.assertIn('process == "Carousel"', diagnostics["run"])

    def test_receipt_alone_cannot_publish_a_screenshot(self):
        capture = next(step["run"] for step in self.steps if step.get("name", "").startswith("Capture intended"))
        self.assertIn('verify-watch-capture" "$name"', capture)
        self.assertLess(capture.index('verify-watch-capture" "$name"'), capture.index('mv "$RUNNER_TEMP/watch-screenshots/$name-pending.png"'))
        delivery = next(step["run"] for step in self.steps if step.get("name", "").startswith("Verify external URL"))
        self.assertIn('verify-watch-capture" "$ROUTE-deep-link"', delivery)
        self.assertIn('.captureID == $id and .pid == $pid and .url == $url', delivery)

    def test_quick_lift_reduces_only_empty_input_space_not_text_or_save_target(self):
        input_view = (ROOT / "apps/ios/Watch/WatchTextInput.swift").read_text()
        lift = (ROOT / "apps/ios/Watch/WatchLiftCaptureView.swift").read_text()
        controls = (ROOT / "apps/ios/Watch/WatchDesign.swift").read_text()
        self.assertIn("var minimumMultilineHeight: CGFloat = 90", input_view)
        self.assertIn("minHeight: multiline ? minimumMultilineHeight : 38", input_view)
        self.assertIn(".lineLimit(multiline ? nil : 2)", input_view)
        self.assertIn("alignment: .bottom, minimumMultilineHeight: 54", lift)
        self.assertIn("ScrollView {", lift)
        self.assertIn('WatchPrimaryAction(title: saveTitle)', lift)
        self.assertIn("minHeight: 44", controls)
        self.assertNotIn(".clipped()", lift)

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
                ("small-log-lift", "Log lift Lift details Bench press, 80 kg, 4 reps", False),
                ("small-log-lift", "Log lift Lift details Bench press, 80 kg, 4 reps Save", True),
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
