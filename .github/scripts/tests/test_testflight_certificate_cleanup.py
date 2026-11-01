import json
import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / ".github/scripts/testflight_certificate_cleanup.rb"

HARNESS = r"""
require ARGV.fetch(0)
fixture = JSON.parse(STDIN.read)
key = OpenSSL::PKey::EC.generate('prime256v1')
cleanup = TestFlightCertificateCleanup.new(key.to_pem, 'fixture-key', 'fixture-issuer')
token = cleanup.instance_variable_get(:@token)
header, payload, raw = token.split('.').map { |part| Base64.urlsafe_decode64(part) }
raise 'Wrong header' unless JSON.parse(header) == {'alg'=>'ES256', 'kid'=>'fixture-key', 'typ'=>'JWT'}
claims = JSON.parse(payload)
raise 'Wrong claims' unless claims['iss'] == 'fixture-issuer' &&
  claims['aud'] == 'appstoreconnect-v1' && claims['exp'] - claims['iat'] == 630
raise 'Wrong signature length' unless raw.bytesize == 64
integers = [raw[0, 32], raw[32, 32]].map { |part| OpenSSL::ASN1::Integer.new(OpenSSL::BN.new(part, 2)) }
der = OpenSSL::ASN1::Sequence.new(integers).to_der
raise 'Invalid signature' unless key.verify(OpenSSL::Digest::SHA256.new, der, token.split('.')[0, 2].join('.'))
calls = []
cleanup.define_singleton_method(:request) do |method, uri|
  calls << [method, uri.to_s]
  raise 'private API diagnostics' if fixture['fail_at'] == calls.length
  method == 'GET' ? JSON.generate(fixture.fetch('pages').shift) : ''
end
begin
  cleanup.run
  puts JSON.generate(calls: calls, failed: false)
rescue StandardError
  puts JSON.generate(calls: calls, failed: true)
end
"""


def certificate(identifier, kind):
    return {"id": identifier, "type": "certificates",
            "attributes": {"certificateType": kind}}


def page(certificates, next_url=None):
    return {"data": certificates, "links": {"next": next_url}}


class TestFlightCertificateCleanupTests(unittest.TestCase):
    def run_cleanup(self, pages, fail_at=None):
        result = subprocess.run(
            ["ruby", "-e", HARNESS, str(SCRIPT)],
            input=json.dumps({"pages": pages, "fail_at": fail_at}),
            capture_output=True, text=True, check=True, cwd=ROOT,
        )
        self.assertEqual(result.stderr, "")
        self.assertNotIn("fixture-key", result.stdout)
        self.assertNotIn("fixture-issuer", result.stdout)
        self.assertNotIn("private API diagnostics", result.stdout)
        return json.loads(result.stdout.splitlines()[-1])

    def test_only_ios_and_apple_development_types_are_revoked_across_pages(self):
        next_url = "https://api.appstoreconnect.apple.com/v1/certificates?cursor=fixture"
        result = self.run_cleanup([
            page([certificate("dev-one", "DEVELOPMENT"),
                  certificate("dist-one", "DISTRIBUTION")], next_url),
            page([certificate("dev-two", "IOS_DEVELOPMENT"),
                  *[certificate(f"other-{index}", kind) for index, kind in enumerate((
                      "IOS_DISTRIBUTION", "MAC_APP_DISTRIBUTION", "MAC_INSTALLER_DISTRIBUTION",
                      "DEVELOPER_ID_APPLICATION", "DEVELOPER_ID_KEXT", "MAC_APP_DEVELOPMENT",
                      "UNKNOWN_FUTURE_TYPE"))]]),
        ])
        self.assertFalse(result["failed"])
        self.assertEqual([method for method, _ in result["calls"]], ["GET", "GET", "DELETE", "DELETE"])
        self.assertEqual([url for method, url in result["calls"] if method == "DELETE"], [
            "https://api.appstoreconnect.apple.com/v1/certificates/dev-one",
            "https://api.appstoreconnect.apple.com/v1/certificates/dev-two",
        ])

    def test_empty_list_and_distribution_only_list_do_not_delete(self):
        for records in ([], [certificate("dist", "DISTRIBUTION")]):
            with self.subTest(records=records):
                result = self.run_cleanup([page(records)])
                self.assertFalse(result["failed"])
                self.assertEqual([method for method, _ in result["calls"]], ["GET"])

    def test_invalid_pagination_and_records_fail_before_any_deletion(self):
        for next_url in (
            "http://api.appstoreconnect.apple.com/v1/certificates",
            "https://other.example/v1/certificates",
            "https://api.appstoreconnect.apple.com:444/v1/certificates",
            "https://user@api.appstoreconnect.apple.com/v1/certificates",
            "https://api.appstoreconnect.apple.com/v1/profiles",
            "https://api.appstoreconnect.apple.com/v1/certificates#fragment",
            "https://api.appstoreconnect.apple.com/v1/certificates?limit=200",
            42,
        ):
            with self.subTest(next_url=next_url):
                result = self.run_cleanup([page([certificate("dev", "DEVELOPMENT")], next_url)])
                self.assertTrue(result["failed"])
                self.assertTrue(all(method == "GET" for method, _ in result["calls"]))
        for record in (
            certificate("../distribution", "DEVELOPMENT"),
            {"id": "dev", "type": "certificates", "attributes": {}},
            {"id": "dev", "type": "profiles", "attributes": {"certificateType": "DEVELOPMENT"}},
        ):
            with self.subTest(record=record):
                result = self.run_cleanup([page([certificate("valid-dev", "DEVELOPMENT"), record])])
                self.assertTrue(result["failed"])
                self.assertEqual(len(result["calls"]), 1)

    def test_inconsistent_types_and_page_limit_fail_without_deleting(self):
        result = self.run_cleanup([page([
            certificate("same", "DEVELOPMENT"), certificate("same", "DISTRIBUTION"),
        ])])
        self.assertTrue(result["failed"])
        pages = [page([certificate(f"dev-{index}", "DEVELOPMENT")],
                      f"https://api.appstoreconnect.apple.com/v1/certificates?cursor={index}")
                 for index in range(21)]
        result = self.run_cleanup(pages)
        self.assertTrue(result["failed"])
        self.assertEqual(len(result["calls"]), 20)
        self.assertTrue(all(method == "GET" for method, _ in result["calls"]))

    def test_listing_and_delete_failures_are_not_false_success(self):
        next_url = "https://api.appstoreconnect.apple.com/v1/certificates?cursor=next"
        for fail_at in (1, 2, 3):
            with self.subTest(fail_at=fail_at):
                result = self.run_cleanup([
                    page([certificate("dev", "DEVELOPMENT")], next_url), page([]),
                ], fail_at=fail_at)
                self.assertTrue(result["failed"])
                self.assertEqual(len(result["calls"]), fail_at)

    def test_cli_errors_are_sanitized(self):
        result = subprocess.run(
            ["ruby", str(SCRIPT)], cwd=ROOT,
            env={**os.environ, "APP_STORE_CONNECT_KEY_P8": "private-key-fixture",
                 "APP_STORE_CONNECT_KEY_ID": "private-key-id-fixture",
                 "APP_STORE_CONNECT_ISSUER_ID": "private-issuer-fixture"},
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("Development certificate cleanup failed", result.stderr)
        self.assertNotIn("fixture", result.stderr)
        self.assertNotIn(str(SCRIPT), result.stderr)

    def test_real_request_sets_auth_and_rejects_http_errors_without_diagnostics(self):
        harness = r"""
require ARGV.fetch(0)
key = OpenSSL::PKey::EC.generate('prime256v1')
cleanup = TestFlightCertificateCleanup.new(key.to_pem, 'fixture-key', 'fixture-issuer')
class FakeHTTP
  attr_accessor :use_ssl, :open_timeout, :read_timeout
  def request(request)
    raise 'Missing auth' unless request['Authorization'].start_with?('Bearer ') &&
      request['Authorization'].split.last.split('.').length == 3
    raise 'Missing TLS/timeouts' unless use_ssl && open_timeout == 10 && read_timeout == 30
    response = Object.new
    response.define_singleton_method(:code) { '403' }
    yield response
  end
end
Net::HTTP.define_singleton_method(:new) { |*args| FakeHTTP.new }
begin
  cleanup.request('GET', URI('https://api.appstoreconnect.apple.com/v1/certificates'))
  raise 'Expected HTTP failure'
rescue RuntimeError => error
  raise unless error.message == 'App Store Connect request failed'
end
"""
        subprocess.run(["ruby", "-e", harness, str(SCRIPT)], check=True,
                       capture_output=True, text=True)

    def test_real_request_reads_success_responses_and_bounds_body_size(self):
        harness = r"""
require ARGV.fetch(0)
key = OpenSSL::PKey::EC.generate('prime256v1')
cleanup = TestFlightCertificateCleanup.new(key.to_pem, 'fixture-key', 'fixture-issuer')
class FakeHTTP
  attr_accessor :use_ssl, :open_timeout, :read_timeout
  def request(request)
    code = request.method == 'DELETE' ? '204' : '200'
    body = request.uri.query == 'large' ? 'x' * (2 * 1024 * 1024 + 1) : 'fixture-body'
    response = Object.new
    response.define_singleton_method(:code) { code }
    response.define_singleton_method(:read_body) { |&block| block.call(body) }
    yield response
  end
end
Net::HTTP.define_singleton_method(:new) { |*args| FakeHTTP.new }
uri = URI('https://api.appstoreconnect.apple.com/v1/certificates')
raise 'Wrong body' unless cleanup.request('GET', uri) == 'fixture-body'
cleanup.request('DELETE', URI('https://api.appstoreconnect.apple.com/v1/certificates/fixture'))
begin
  cleanup.request('GET', URI(uri.to_s + '?large'))
  raise 'Expected response size failure'
rescue RuntimeError => error
  raise unless error.message == 'API response exceeded bounds'
end
"""
        subprocess.run(["ruby", "-e", harness, str(SCRIPT)], check=True,
                       capture_output=True, text=True)

    def test_workflow_keeps_original_signing_and_cleanup_uses_only_existing_secrets(self):
        source = subprocess.run(
            ["ruby", "-ryaml", "-rjson", "-e",
             "puts JSON.generate(YAML.safe_load_file(ARGV[0]))",
             str(ROOT / ".github/workflows/ios-testflight.yml")],
            capture_output=True, text=True, check=True,
        )
        steps = json.loads(source.stdout)["jobs"]["upload"]["steps"]
        names = [step.get("name") for step in steps]
        cleanup = steps[names.index("Revoke development certificates")]
        self.assertEqual(cleanup["if"], "always() && github.ref == 'refs/heads/main'")
        self.assertEqual(cleanup["timeout-minutes"], 5)
        self.assertEqual(set(cleanup["env"]), {
            "APP_STORE_CONNECT_KEY_P8", "APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID",
        })
        self.assertIn(str(SCRIPT.relative_to(ROOT)), cleanup["run"])
        self.assertGreater(names.index("Revoke development certificates"),
                           names.index("Export and upload to TestFlight"))
        self.assertGreater(names.index("Delete App Store Connect key"),
                           names.index("Revoke development certificates"))
        self.assertEqual(steps[-1]["if"], "always()")
        self.assertNotIn("IOS_DISTRIBUTION_P12", source.stdout)
        self.assertNotIn("IOS_APP_PROFILE", source.stdout)
        self.assertNotIn("IOS_BROADCAST_PROFILE", source.stdout)


if __name__ == "__main__":
    unittest.main()
