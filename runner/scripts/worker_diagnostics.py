"""Bounded, non-sensitive Azure provisioning diagnostics."""
import json
import re


def deployment_errors(stderr):
    """Retain all CLI error identities, including separately rendered inner errors."""
    text = stderr.decode(errors='replace') if isinstance(stderr, bytes) else stderr
    decoder = json.JSONDecoder()
    codes = []

    def add(code):
        if (len(codes) < 12 and isinstance(code, str)
                and re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,119}', code)
                and code not in codes):
            codes.append(code)

    # Azure CLI can emit the outer error and each inner error as separate JSON
    # objects. Do not stop after the first object, or the actionable cause is lost.
    # Error messages can also contain escaped JSON or a conventional Code: field.
    def collect(source, depth=0):
        if depth > 4 or len(codes) >= 12:
            return
        for match in re.finditer(r'\{', source):
            try:
                node, _ = decoder.raw_decode(source[match.start():])
            except ValueError:
                continue
            if isinstance(node, dict):
                add(node.get('code'))
                message = node.get('message')
                if isinstance(message, str):
                    collect(message, depth + 1)
        for code in re.findall(r'\bCode:\s*([A-Za-z][A-Za-z0-9_.-]{0,119})\b', source):
            add(code)
        for code in re.findall(r'\bBCP[0-9]{3}\b', source):
            add(code)

    collect(text)
    return [{'code': code} for code in codes] or [{'code': 'UnknownDeploymentFailure'}]
