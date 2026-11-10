import json
import os
from pathlib import Path
import subprocess
import tempfile
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
signing_key = OpenSSL::PKey::RSA.new(2048)
foreign_key = OpenSSL::PKey::EC.generate('prime256v1')
contents = [signing_key, foreign_key].map do |certificate_key|
  cert = OpenSSL::X509::Certificate.new
  cert.serial = 1
  cert.version = 2
  cert.subject = cert.issuer = OpenSSL::X509::Name.parse('/CN=synthetic fixture')
  cert.public_key = certificate_key
  cert.not_before = Time.now
  cert.not_after = Time.now + 600
  cert.sign(key, OpenSSL::Digest::SHA256.new)
  Base64.strict_encode64(cert.to_der)
end
fixture.fetch('pages').each do |page|
  page.fetch('data').each do |record|
    attributes = record['attributes']
    next unless attributes && %w[owned unrelated].include?(attributes['certificateContent'])

    attributes['certificateContent'] = contents[attributes['certificateContent'] == 'owned' ? 0 : 1]
  end
end
cleanup.define_singleton_method(:request) do |method, uri, *args|
  calls << [method, uri.to_s]
  raise 'private API diagnostics' if fixture['fail_at'] == calls.length
  method == 'GET' ? JSON.generate(fixture.fetch('pages').shift) : ''
end
begin
  cleanup.run(signing_key)
  puts JSON.generate(calls: calls, failed: false)
rescue StandardError
  puts JSON.generate(calls: calls, failed: true)
end
"""


def certificate(identifier, kind, owned=False):
    return {"id": identifier, "type": "certificates",
            "attributes": {"certificateType": kind,
                           "certificateContent": "owned" if owned else "unrelated"}}


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

    def test_only_key_owned_development_certificates_are_revoked_across_pages(self):
        next_url = "https://api.appstoreconnect.apple.com/v1/certificates?cursor=fixture"
        result = self.run_cleanup([
            page([certificate("dev-one", "DEVELOPMENT", owned=True),
                  certificate("unrelated-apple-dev", "DEVELOPMENT"),
                  certificate("dist-one", "DISTRIBUTION", owned=True)], next_url),
            page([certificate("dev-two", "IOS_DEVELOPMENT", owned=True),
                  certificate("unrelated-ios-dev", "IOS_DEVELOPMENT"),
                  *[certificate(f"other-{index}", kind) for index, kind in enumerate((
                      "IOS_DISTRIBUTION", "MAC_APP_DISTRIBUTION", "MAC_INSTALLER_DISTRIBUTION",
                      "DEVELOPER_ID_APPLICATION", "DEVELOPER_ID_KEXT", "MAC_APP_DEVELOPMENT",
                      "UNKNOWN_FUTURE_TYPE"))],
                  certificate("owned-ios-dist", "IOS_DISTRIBUTION", owned=True)]),
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
                    page([certificate("dev", "DEVELOPMENT", owned=True)], next_url), page([]),
                ], fail_at=fail_at)
                self.assertTrue(result["failed"])
                self.assertEqual(len(result["calls"]), fail_at)

    def test_unverifiable_development_content_fails_before_deletion(self):
        for content in (None, "", "not a certificate"):
            record = certificate("unverifiable", "DEVELOPMENT")
            record["attributes"]["certificateContent"] = content
            result = self.run_cleanup([page([
                certificate("owned", "DEVELOPMENT", owned=True), record,
            ])])
            self.assertTrue(result["failed"])
            self.assertEqual([method for method, _ in result["calls"]], ["GET"])

    def test_missing_ownership_key_skips_api_even_without_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                ["ruby", str(SCRIPT), "cleanup", directory], cwd=ROOT,
                env={key: value for key, value in os.environ.items()
                     if not key.startswith("APP_STORE_CONNECT_")},
                capture_output=True, text=True,
            )
        self.assertEqual(result.returncode, 0)
        self.assertIn("cleanup skipped", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_prepare_uses_fresh_csr_and_retains_proof_on_ambiguous_failure(self):
        harness = r"""
require ARGV.fetch(0)
require 'tmpdir'
Dir.mktmpdir do |root|
  %w[success lost-response wrong-key distribution].each do |scenario|
    directory = File.join(root, scenario)
    api_key = OpenSSL::PKey::EC.generate('prime256v1')
    client = TestFlightCertificateCleanup.new(api_key.to_pem, 'fixture-key', 'fixture-issuer')
    calls = []
    client.define_singleton_method(:request) do |method, uri, body|
      calls << method
      raise unless method == 'POST' && uri.to_s == "#{TestFlightCertificateCleanup::API}/v1/certificates"

      attributes = JSON.parse(body).fetch('data').fetch('attributes')
      raise unless attributes.fetch('certificateType') == 'DEVELOPMENT'

      csr = OpenSSL::X509::Request.new(attributes.fetch('csrContent'))
      raise unless csr.verify(csr.public_key)

      key = OpenSSL::PKey.read(File.read(File.join(directory, 'private-key.pem')))
      raise unless key.public_key.to_der == csr.public_key.to_der
      raise 'private response lost' if scenario == 'lost-response'

      cert = OpenSSL::X509::Certificate.new
      cert.version = 2
      cert.serial = 1
      cert.subject = cert.issuer = csr.subject
      cert.public_key = scenario == 'wrong-key' ? api_key : csr.public_key
      cert.not_before = Time.now
      cert.not_after = Time.now + 600
      cert.sign(api_key, OpenSSL::Digest::SHA256.new)
      JSON.generate(data: {id: 'synthetic', type: 'certificates',
                          attributes: {certificateType: scenario == 'distribution' ? 'DISTRIBUTION' : 'DEVELOPMENT',
                                       certificateContent: Base64.strict_encode64(cert.to_der)}})
    end
    failed = false
    begin
      client.prepare(directory, 'synthetic-temporary-passphrase-0000')
    rescue StandardError
      failed = true
    end
    raise unless failed == (scenario != 'success') && calls == ['POST']
    key_path = File.join(directory, 'private-key.pem')
    raise unless File.stat(key_path).mode & 0o777 == 0o600
    raise unless File.stat(directory).mode & 0o777 == 0o700
    if scenario == 'success'
      passphrase = 'synthetic-temporary-passphrase-0000'
      p12 = OpenSSL::PKCS12.new(File.binread(File.join(directory, 'identity.p12')), passphrase)
      raise unless p12.certificate.public_key.to_der == p12.key.public_key.to_der
      raise unless File.read(File.join(directory, 'identity')) ==
        OpenSSL::Digest::SHA1.hexdigest(p12.certificate.to_der).upcase
      Dir.children(directory).each do |name|
        raise unless File.stat(File.join(directory, name)).mode & 0o777 == 0o600
      end
    else
      raise if File.exist?(File.join(directory, 'identity.p12'))
    end
    original_key = File.read(key_path)
    begin
      client.prepare(directory, 'synthetic-temporary-passphrase-0000')
      raise 'Unexpected repeated creation'
    rescue Errno::EEXIST
      raise unless File.read(key_path) == original_key && calls == ['POST']
    end
    # Even a lost creation response can be reconciled by its persisted key.
    key = OpenSSL::PKey.read(original_key)
    cert = OpenSSL::X509::Certificate.new
    cert.serial = 2
    cert.subject = cert.issuer = OpenSSL::X509::Name.parse('/CN=synthetic')
    cert.public_key = key.public_key
    cert.not_before = Time.now
    cert.not_after = Time.now + 600
    cert.sign(api_key, OpenSSL::Digest::SHA256.new)
    record = {'attributes' => {'certificateType' => 'DEVELOPMENT',
                              'certificateContent' => Base64.strict_encode64(cert.to_der)}}
    raise unless client.owned_certificate(record, key)
  end
end
"""
        result = subprocess.run(["ruby", "-e", harness, str(SCRIPT)], check=True,
                                capture_output=True, text=True)
        self.assertNotIn("fixture", result.stdout + result.stderr)

    def test_creation_rejection_is_bounded_and_privacy_safe(self):
        harness = r"""
require ARGV.fetch(0)
key = OpenSSL::PKey::EC.generate('prime256v1')
client = TestFlightCertificateCleanup.new(key.to_pem, 'fixture-key', 'fixture-issuer')
calls = 0
http = Object.new
%w[use_ssl open_timeout read_timeout].each do |name|
  http.define_singleton_method("#{name}=") { |value| }
end
http.define_singleton_method(:request) do |request, &block|
  calls += 1
  raise unless request.method == 'POST' && request['Content-Type'] == 'application/json' &&
    request.body == '{"fixture":true}'
  response = Object.new
  response.define_singleton_method(:code) { '409' }
  response.define_singleton_method(:read_body) { raise 'Private quota diagnostics must not be read' }
  block.call(response)
end
Net::HTTP.define_singleton_method(:new) { |*args| http }
begin
  client.request('POST', URI("#{TestFlightCertificateCleanup::API}/v1/certificates"), '{"fixture":true}')
  raise 'Unexpected success'
rescue TestFlightCertificateCleanup::CertificateCreationFailed
  raise unless calls == 1
end
"""
        subprocess.run(["ruby", "-e", harness, str(SCRIPT)], check=True,
                       capture_output=True, text=True)

    def test_keychain_failures_stop_setup_and_local_cleanup_remains_honest(self):
        source = subprocess.run(
            ["ruby", "-ryaml", "-rjson", "-e",
             "puts JSON.generate(YAML.safe_load_file(ARGV[0]))",
             str(ROOT / ".github/workflows/ios-testflight.yml")],
            capture_output=True, text=True, check=True,
        )
        steps = json.loads(source.stdout)["jobs"]["upload"]["steps"]
        prepare = next(step["run"] for step in steps
                       if step.get("name") == "Prepare run-owned development signing")
        harness = r"""
ruby() {
  [[ -n "$TESTFLIGHT_SIGNING_PASSPHRASE" ]] || return 1
  mkdir "$RUNNER_TEMP/testflight-signing"
}
security() {
  printf '%s\n' "$1" >> "$RUNNER_TEMP/calls"
  echo 'private-keychain-diagnostics synthetic-passphrase'
  [[ "$1" != "$FAIL_COMMAND" ]]
}
"""
        commands = ["create-keychain", "set-keychain-settings", "unlock-keychain",
                    "import", "set-key-partition-list", "list-keychains"]
        for failure in [*commands, "none"]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                result = subprocess.run(
                    ["bash", "-e", "-c", harness + prepare], text=True, capture_output=True,
                    env={**os.environ, "RUNNER_TEMP": directory, "FAIL_COMMAND": failure},
                )
                self.assertEqual(result.returncode, 0 if failure == "none" else 1)
                expected = commands if failure == "none" else commands[:commands.index(failure) + 1]
                self.assertEqual((Path(directory) / "calls").read_text().splitlines(), expected)
                self.assertNotIn("synthetic-passphrase", result.stdout + result.stderr)
                self.assertNotIn("private-keychain-diagnostics", result.stdout + result.stderr)
                if failure != "none":
                    self.assertIn("::error::", result.stdout)

        cleanup = steps[-1]["run"]
        for failure in ("delete-keychain", "none"):
            with self.subTest(cleanup_failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "testflight-signing").mkdir()
                (root / "testflight-signing/signing.keychain-db").touch()
                for name in ("AuthKey.p8", "signing.log", "archive.log", "export.log", "ExportOptions.plist"):
                    (root / name).write_text("synthetic private data")
                result = subprocess.run(
                    ["bash", "-e", "-c", harness + cleanup], text=True, capture_output=True,
                    env={**os.environ, "RUNNER_TEMP": directory, "FAIL_COMMAND": failure},
                )
                self.assertEqual(result.returncode, 0 if failure == "none" else 1)
                self.assertEqual(sorted(path.name for path in root.iterdir()), ["calls"])
                self.assertNotIn("private-keychain-diagnostics", result.stdout + result.stderr)
                if failure != "none":
                    self.assertIn("deletion failed", result.stdout)

    def test_cli_errors_are_sanitized(self):
        result = subprocess.run(
            ["ruby", str(SCRIPT), "prepare", "/unused-fixture-path"], cwd=ROOT,
            env={**os.environ, "APP_STORE_CONNECT_KEY_P8": "private-key-fixture",
                 "APP_STORE_CONNECT_KEY_ID": "private-key-id-fixture",
                 "APP_STORE_CONNECT_ISSUER_ID": "private-issuer-fixture"},
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("signing preparation or certificate cleanup failed", result.stderr)
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
        cleanup = steps[names.index("Revoke only run-owned development certificates")]
        self.assertEqual(cleanup["if"], "always()")
        self.assertEqual(cleanup["timeout-minutes"], 5)
        self.assertEqual(set(cleanup["env"]), {
            "APP_STORE_CONNECT_KEY_P8", "APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID",
        })
        self.assertIn(str(SCRIPT.relative_to(ROOT)), cleanup["run"])
        self.assertIn('cleanup "$RUNNER_TEMP/testflight-signing"', cleanup["run"])
        self.assertGreater(names.index("Revoke only run-owned development certificates"),
                           names.index("Export and upload to TestFlight"))
        self.assertGreater(names.index("Delete App Store Connect key"),
                           names.index("Revoke only run-owned development certificates"))
        self.assertEqual(steps[-1]["if"], "always()")
        self.assertNotIn("IOS_DISTRIBUTION_P12", source.stdout)
        self.assertNotIn("IOS_APP_PROFILE", source.stdout)
        self.assertNotIn("IOS_BROADCAST_PROFILE", source.stdout)
        self.assertNotIn("Revoke stale", source.stdout)
        prepare = steps[names.index("Prepare run-owned development signing")]
        self.assertLess(names.index(prepare["name"]), names.index("Archive with automatic signing"))
        self.assertIn('prepare "$RUNNER_TEMP/testflight-signing"', prepare["run"])
        self.assertIn("security import", prepare["run"])
        self.assertIn("set-key-partition-list", prepare["run"])
        archive = steps[names.index("Archive with automatic signing")]["run"]
        self.assertIn('CODE_SIGN_IDENTITY="$(cat "$RUNNER_TEMP/testflight-signing/identity")"', archive)
        self.assertIn("-allowProvisioningUpdates", archive)
        self.assertIn("-allowProvisioningUpdates",
                      steps[names.index("Export and upload to TestFlight")]["run"])
        self.assertIn("security delete-keychain", steps[-1]["run"])
        self.assertIn('rm -rf "$RUNNER_TEMP/testflight-signing"', steps[-1]["run"])
        self.assertNotIn("continue-on-error", cleanup)
        for step in steps:
            if "run" in step:
                subprocess.run(["bash", "-n"], input=step["run"], text=True,
                               capture_output=True, check=True)
                self.assertNotIn("echo \"::error::${line}", step["run"])


if __name__ == "__main__":
    unittest.main()
