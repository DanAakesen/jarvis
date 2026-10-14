import base64
import hashlib
from importlib.metadata import version
from urllib.parse import parse_qs, urlsplit

from oauthlib.oauth2 import WebApplicationClient
from requests_oauthlib import OAuth2Session


def test_authorization_uri_pkce_round_trip() -> None:
    assert version("oauthlib") in {"3.3.1", "4.0.0"}

    client_id = "offline-client"
    redirect_uri = "https://client.example/callback"
    verifier = base64.urlsafe_b64encode(hashlib.sha256(b"offline-verifier").digest())
    verifier = verifier.rstrip(b"=").decode("ascii")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
    challenge = challenge.rstrip(b"=").decode("ascii")
    session = OAuth2Session(
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=["openid"],
        state="offline-state",
    )

    authorization_url, state = session.authorization_url(
        "https://authorization.example/authorize",
        code_challenge=challenge,
        code_challenge_method="S256",
    )

    assert state == "offline-state"
    authorization = parse_qs(urlsplit(authorization_url).query)
    assert authorization["client_id"] == [client_id]
    assert authorization["redirect_uri"] == [redirect_uri]
    assert authorization["response_type"] == ["code"]
    assert authorization["state"] == [state]
    assert authorization["code_challenge"] == [challenge]
    assert authorization["code_challenge_method"] == ["S256"]

    token_request = parse_qs(
        WebApplicationClient(client_id).prepare_request_body(
            code="offline-code",
            code_verifier=verifier,
            redirect_uri=redirect_uri,
        )
    )
    assert token_request["code"] == ["offline-code"]
    assert token_request["code_verifier"] == [verifier]
    assert (
        base64.urlsafe_b64encode(hashlib.sha256(token_request["code_verifier"][0].encode()).digest())
        .rstrip(b"=")
        .decode("ascii")
        == authorization["code_challenge"][0]
    )
