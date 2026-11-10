require 'base64'
require 'json'
require 'net/http'
require 'openssl'
require 'set'
require 'timeout'
require 'uri'

class TestFlightCertificateCleanup
  API = 'https://api.appstoreconnect.apple.com'
  DEVELOPMENT_TYPES = %w[DEVELOPMENT IOS_DEVELOPMENT].freeze
  class CertificateCreationFailed < StandardError; end

  def initialize(key, key_id, issuer_id)
    raise 'Missing API credentials' if [key, key_id, issuer_id].any? { |value| value.nil? || value.empty? }

    signing_key = OpenSSL::PKey.read(key)
    unless signing_key.is_a?(OpenSSL::PKey::EC) && signing_key.private? &&
           signing_key.group.curve_name == 'prime256v1'
      raise 'Invalid API key'
    end
    now = Time.now.to_i
    encode = ->(value) { Base64.urlsafe_encode64(value, padding: false) }
    header = encode.call(JSON.generate(alg: 'ES256', kid: key_id, typ: 'JWT'))
    payload = encode.call(JSON.generate(iss: issuer_id, iat: now - 30, exp: now + 600,
                                       aud: 'appstoreconnect-v1'))
    message = "#{header}.#{payload}"
    der = signing_key.sign(OpenSSL::Digest::SHA256.new, message)
    signature = OpenSSL::ASN1.decode(der).value.map do |integer|
      [integer.value.to_i.to_s(16).rjust(64, '0')].pack('H*')
    end.join
    @token = "#{message}.#{encode.call(signature)}"
  end

  def prepare(directory, password)
    raise 'Missing temporary signing passphrase' unless password.is_a?(String) && password.bytesize >= 32

    Dir.mkdir(directory, 0o700)
    key = OpenSSL::PKey::RSA.new(2048)
    # Persist ownership proof before the non-idempotent request, including a lost response.
    File.write(File.join(directory, 'private-key.pem'), key.to_pem, mode: 'wx', perm: 0o600)
    csr = OpenSSL::X509::Request.new
    csr.version = 0
    csr.subject = OpenSSL::X509::Name.parse('/CN=Jarvis TestFlight automation')
    csr.public_key = key.public_key
    csr.sign(key, OpenSSL::Digest::SHA256.new)
    body = JSON.generate(data: { type: 'certificates',
                                attributes: { certificateType: 'DEVELOPMENT', csrContent: csr.to_pem } })
    record = JSON.parse(request('POST', URI("#{API}/v1/certificates"), body)).fetch('data')
    certificate = owned_certificate(record, key)
    raise 'Created certificate did not match signing key' unless certificate

    p12 = OpenSSL::PKCS12.create(password, 'Jarvis TestFlight', key, certificate)
    { 'identity.p12' => p12.to_der,
      'identity' => OpenSSL::Digest::SHA1.hexdigest(certificate.to_der).upcase }.each do |name, value|
      File.binwrite(File.join(directory, name), value, mode: 'wx', perm: 0o600)
    end
    puts 'Run-owned development signing identity prepared.'
  end

  def owned_certificate(record, key)
    attributes = record.fetch('attributes')
    return nil unless DEVELOPMENT_TYPES.include?(attributes.fetch('certificateType'))

    certificate = OpenSSL::X509::Certificate.new(Base64.strict_decode64(attributes.fetch('certificateContent')))
    certificate if certificate.public_key.to_der == key.public_key.to_der
  end

  def run(key)
    certificates = {}
    seen = Set.new
    url = "#{API}/v1/certificates?limit=200"
    # Complete and validate the listing before revoking anything.
    while url
      raise 'Certificate listing exceeded bounds' if seen.size >= 20 || !seen.add?(url)

      uri = URI(url)
      unless uri.scheme == 'https' && uri.host == 'api.appstoreconnect.apple.com' &&
             uri.port == 443 && uri.userinfo.nil? && uri.fragment.nil? &&
             uri.path == '/v1/certificates'
        raise 'Invalid pagination URL'
      end
      page = JSON.parse(request('GET', uri))
      raise 'Invalid certificate list' unless page['data'].is_a?(Array)

      page['data'].each do |certificate|
        id, type = certificate.values_at('id', 'type')
        attributes = certificate['attributes']
        unless type == 'certificates' && id.is_a?(String) && id.match?(/\A[A-Za-z0-9-]+\z/) &&
               attributes.is_a?(Hash) && attributes['certificateType'].is_a?(String)
          raise 'Invalid certificate record'
        end
        if certificates.key?(id) && certificates[id] != certificate
          raise 'Inconsistent certificate record'
        end
        certificates[id] = certificate
      end
      raise 'Too many certificates' if certificates.size > 2000

      url = page.fetch('links', {})['next']
      raise 'Invalid next page' unless url.nil? || url.is_a?(String)
    end
    owned = certificates.select { |_id, record| owned_certificate(record, key) }
    owned.each_key do |id|
      request('DELETE', URI("#{API}/v1/certificates/#{id}"))
    end
    puts 'Run-owned certificate cleanup completed; unrelated and distribution certificates preserved.'
  end

  def request(method, uri, body = nil)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = 10
    http.read_timeout = 30
    request = { 'DELETE' => Net::HTTP::Delete, 'GET' => Net::HTTP::Get,
                'POST' => Net::HTTP::Post }.fetch(method).new(uri)
    request['Authorization'] = ['Bearer', @token].join(' ')
    request['Accept'] = 'application/json'
    if body
      request['Content-Type'] = 'application/json'
      request.body = body
    end
    body = +''
    http.request(request) do |response|
      expected = { 'DELETE' => '204', 'GET' => '200', 'POST' => '201' }.fetch(method)
      raise CertificateCreationFailed if method == 'POST' && response.code != expected

      raise 'App Store Connect request failed' unless response.code == expected

      response.read_body do |chunk|
        body << chunk
        raise 'API response exceeded bounds' if body.bytesize > 2 * 1024 * 1024
      end
    end
    body
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    Timeout.timeout(240) do
      mode, directory = ARGV
      raise 'Invalid operation' unless %w[prepare cleanup].include?(mode) && directory

      key_path = File.join(directory, 'private-key.pem')
      if mode == 'cleanup' && !File.exist?(key_path)
        puts 'No run-owned signing key; certificate cleanup skipped.'
        exit 0
      end
      client = TestFlightCertificateCleanup.new(
        ENV['APP_STORE_CONNECT_KEY_P8'], ENV['APP_STORE_CONNECT_KEY_ID'],
        ENV['APP_STORE_CONNECT_ISSUER_ID']
      )
      if mode == 'prepare'
        client.prepare(directory, ENV['TESTFLIGHT_SIGNING_PASSPHRASE'])
      else
        key = OpenSSL::PKey.read(File.read(key_path))
        raise 'Invalid signing key' unless key.is_a?(OpenSSL::PKey::RSA) && key.private?

        client.run(key)
      end
    end
  rescue TestFlightCertificateCleanup::CertificateCreationFailed
    warn '::error::Signing certificate creation rejected. Check certificate quota and API permissions. An account administrator must verify ownership before freeing quota; no unrelated certificates were revoked. No automatic creation retry.'
    exit 1
  rescue StandardError
    warn '::error::TestFlight signing preparation or certificate cleanup failed. Check API permissions/connectivity. Cleanup may be incomplete and an administrator may need to verify orphan ownership. No identifiers or API diagnostics are logged.'
    exit 1
  end
end
