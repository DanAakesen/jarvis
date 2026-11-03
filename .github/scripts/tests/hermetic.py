"""Keep workflow tests independent of the branch or event they run on."""

import os
import unittest
from unittest.mock import patch

BRANCH_VARIABLES = (
    "GITHUB_ACTIONS", "GITHUB_BASE_REF", "GITHUB_EVENT_NAME", "GITHUB_HEAD_REF",
    "GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_REF_TYPE",
)


def setUpModule():
    patcher = patch.dict(os.environ)
    patcher.start()
    unittest.addModuleCleanup(patcher.stop)
    for name in BRANCH_VARIABLES:
        os.environ.pop(name, None)
