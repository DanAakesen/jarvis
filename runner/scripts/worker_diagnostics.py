"""Bounded, non-sensitive Azure provisioning diagnostics."""
import json
import re


def deployment_errors(stderr):
    """Retain bounded control-plane error identities, never CLI arguments/parameters."""
    text = stderr.decode(errors='replace') if isinstance(stderr, bytes) else stderr
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{', text):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
        except ValueError:
            continue
        errors = []

        def visit(node):
            if not isinstance(node, dict) or len(errors) >= 12:
                return
            code = node.get('code')
            if isinstance(code, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,119}', code):
                errors.append({'code': code})
            for child in node.get('details', []) if isinstance(node.get('details', []), list) else []:
                visit(child)
            visit(node.get('error'))
            visit(node.get('innererror'))
        visit(value)
        if errors:
            return errors
    return [{'code': code} for code in sorted(set(re.findall(r'\bBCP[0-9]{3}\b', text)))][:12] or [{'code': 'UnknownDeploymentFailure'}]


