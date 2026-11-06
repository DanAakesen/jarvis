"""Validate full-policy evidence; output only its opaque activation receipt."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "agents" / "jarvis"))
from managed_policy_compatibility import validated_canary_receipt


def read(path):
    with Path(path).open("rb") as source:
        raw = source.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError
    return json.loads(raw)


def main():
    try:
        receipt = validated_canary_receipt(read(sys.argv[1]), read(sys.argv[2]))
    except (ValueError, TypeError, AttributeError, OSError, RecursionError, IndexError):
        return 1
    print(receipt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
