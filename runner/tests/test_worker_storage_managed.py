from urllib.parse import parse_qs
import httpx
import pytest
from worker_storage import Mailbox

URL = 'https://teststore.blob.core.windows.net/factory-sbx-' + 'a' * 32


def test_managed_mailbox_requires_scoped_credential(monkeypatch):
    monkeypatch.delenv('JARVIS_FACTORY_MAILBOX_SAS_FILE', raising=False)
    with pytest.raises(ValueError, match='scoped mailbox'):
        Mailbox(URL)


def test_rotating_container_sas_is_read_per_request(tmp_path, monkeypatch):
    token = tmp_path / 'sas'
    token.write_text('sr=c&spr=https&sig=first')
    monkeypatch.setenv('JARVIS_FACTORY_MAILBOX_SAS_FILE', str(token))
    requests = []
    def response(request):
        requests.append(request)
        return httpx.Response(200, json={'ok': True})
    mailbox = Mailbox(URL, client=httpx.Client(transport=httpx.MockTransport(response)))
    try:
        assert mailbox.get('health.json') == {'ok': True}
        token.write_text('sr=c&spr=https&sig=renewed')
        mailbox.get('health.json')
        assert parse_qs(requests[0].url.query.decode())['sig'] == ['first']
        assert parse_qs(requests[1].url.query.decode())['sig'] == ['renewed']
        assert all('Authorization' not in request.headers for request in requests)
        assert all(request.url.path == '/factory-sbx-' + 'a' * 32 + '/health.json' for request in requests)
    finally:
        mailbox.close()


def test_reject_account_scope_sas(tmp_path, monkeypatch):
    token = tmp_path / 'sas'
    token.write_text('ss=b&spr=https&sig=wrong')
    monkeypatch.setenv('JARVIS_FACTORY_MAILBOX_SAS_FILE', str(token))
    mailbox = Mailbox(URL)
    try:
        with pytest.raises(ValueError, match='scoped mailbox'):
            mailbox.get('health.json')
    finally:
        mailbox.close()
