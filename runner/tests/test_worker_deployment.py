import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from worker_diagnostics import deployment_errors  # noqa: E402


def test_deployment_errors_preserve_nested_codes_without_sensitive_fields():
    value = '''WARNING: something\nERROR: {"error":{"code":"InvalidTemplateDeployment","message":"Bearer sensitive-value","details":[{"code":"SkuNotAvailable","target":"private-resource","message":"secret=private-value"}]}}'''
    assert deployment_errors(value) == [{'code': 'InvalidTemplateDeployment'}, {'code': 'SkuNotAvailable'}]


def test_deployment_errors_extract_compile_codes_and_bound_unknown_diagnostics():
    assert deployment_errors(b'Error BCP037: private parameters') == [{'code': 'BCP037'}]
    assert deployment_errors('private token or raw response') == [{'code': 'UnknownDeploymentFailure'}]


def test_deployment_errors_include_separately_rendered_cli_inner_errors():
    raw = '''ERROR: {"code":"InvalidTemplateDeployment","message":"The template failed"}
Inner Errors:
{"code":"SkuNotAvailable","message":"private subscription resource data"}
{"code":"SkuNotAvailable","message":"duplicate"}'''
    assert deployment_errors(raw) == [{'code': 'InvalidTemplateDeployment'}, {'code': 'SkuNotAvailable'}]


def test_deployment_errors_include_embedded_and_textual_inner_codes():
    import json
    raw = json.dumps({'code': 'InvalidTemplateDeployment', 'message': json.dumps({
        'code': 'DeploymentFailed', 'message': 'private input (Code: QuotaExceeded)'})})
    assert deployment_errors(raw) == [
        {'code': 'InvalidTemplateDeployment'}, {'code': 'DeploymentFailed'}, {'code': 'QuotaExceeded'}]
