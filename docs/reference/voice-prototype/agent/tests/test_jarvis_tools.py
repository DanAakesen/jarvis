from azure.data.tables import EdmType, EntityProperty

from jarvis_tools import _table_value


def test_table_values_fit_table_storage_types() -> None:
    large = _table_value(1_790_953_645_597)
    assert isinstance(large, EntityProperty) and large.edm_type == EdmType.INT64
    assert _table_value(42) == 42
    assert _table_value(True) is True
    assert _table_value({"task_id": "T-101"}) == '{"task_id": "T-101"}'
    assert _table_value("x" * 40_000) == "x" * 30_000
