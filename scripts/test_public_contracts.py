#!/usr/bin/env python3
"""Keep immutable checker code separate from the canonical data it compares."""

from pathlib import Path
import unittest

import yaml


class PublicContractWorkflowTests(unittest.TestCase):
    def test_pinned_code_does_not_freeze_canonical_specification_data(self):
        workflow = Path(__file__).resolve().parent.parent / ".github/workflows/public-contracts.yml"
        steps = yaml.safe_load(workflow.read_text())["jobs"]["copy-contract"]["steps"]
        checkouts = {step["with"]["path"]: step["with"] for step in steps if "with" in step
                     and "repository" in step["with"]}
        self.assertEqual(checkouts[".contract-checker"]["repository"], "selvage-protocol/specification")
        self.assertEqual(checkouts[".contract-checker"]["ref"], "12795c817566897d0af4c13877d229f4555581f8")
        self.assertEqual(checkouts["specification"]["repository"], "selvage-protocol/specification")
        self.assertEqual(checkouts["specification"]["ref"], "main")
        self.assertEqual(checkouts["vscode_client"]["ref"], "main")
        commands = "\n".join(step.get("run", "") for step in steps)
        self.assertIn("python3 .contract-checker/scripts/check-workspace.py --workspace", commands)
        self.assertIn("--revision specification=HEAD", commands)
        self.assertIn("for repo in web_client vscode_client specification", commands)
        self.assertIn("printf 'checker-code='", commands)
        self.assertIn("git -C .contract-checker rev-parse HEAD", commands)


if __name__ == "__main__":
    unittest.main()
