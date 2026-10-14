import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


class CodeQlWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / ".github/workflows/codeql.yml").read_text(encoding="utf-8")
        cls.backend_workflow = (ROOT / ".github/workflows/backend-ci.yml").read_text(encoding="utf-8")
        cls.bridge_project = (
            ROOT / "pc-bridge/Jarvis.PcBridge/Jarvis.PcBridge.csproj"
        ).read_text(encoding="utf-8-sig")

    def test_codeql_keeps_existing_languages_and_manually_builds_csharp(self):
        self.assertIn("queries: security-extended", self.workflow)
        self.assertIn(
            "category: '/language:${{ matrix.language }}'",
            self.workflow,
        )

        languages = dict(
            re.findall(
                r"^\s+- language: ([\w-]+)\n\s+build-mode: (\w+)$",
                self.workflow,
                re.MULTILINE,
            )
        )
        self.assertEqual(
            languages,
            {
                "javascript-typescript": "none",
                "python": "none",
                "actions": "none",
                "csharp": "manual",
            },
        )

        init = self.workflow.index("name: Initialize CodeQL")
        setup = self.workflow.index("name: Setup .NET for C# CodeQL build")
        build = self.workflow.index("name: Build production PC bridge for CodeQL")
        analyze = self.workflow.index("name: Perform CodeQL Analysis")
        self.assertLess(init, setup)
        self.assertLess(setup, build)
        self.assertLess(build, analyze)

        setup_step = self.workflow[setup:build]
        build_step = self.workflow[build:analyze]
        self.assertIn("if: matrix.language == 'csharp'", setup_step)
        self.assertIn("if: matrix.language == 'csharp'", build_step)

        backend_setup = re.search(
            r"uses: actions/setup-dotnet@([a-f0-9]{40})", self.backend_workflow
        )
        csharp_setup = re.search(
            r"uses: actions/setup-dotnet@([a-f0-9]{40}).*?"
            r"dotnet-version: ([^\s]+)",
            setup_step,
            re.DOTALL,
        )
        self.assertIsNotNone(backend_setup)
        self.assertIsNotNone(csharp_setup)
        self.assertEqual(csharp_setup.group(1), backend_setup.group(1))
        self.assertEqual(csharp_setup.group(2), "10.0.x")

        self.assertIn(
            "run: dotnet build pc-bridge/Jarvis.PcBridge/Jarvis.PcBridge.csproj "
            "--configuration Release",
            self.workflow,
        )
        self.assertIn(
            r'ProjectReference Include="..\Jarvis.PcBridge.Core\Jarvis.PcBridge.Core.csproj"',
            self.bridge_project,
        )


if __name__ == "__main__":
    unittest.main()
