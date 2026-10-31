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

  def run
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
        certificate_type = attributes['certificateType']
        if certificates.key?(id) && certificates[id] != certificate_type
          raise 'Inconsistent certificate type'
        end
        certificates[id] = certificate_type
      end
      raise 'Too many certificates' if certificates.size > 2000

      url = page.fetch('links', {})['next']
      raise 'Invalid next page' unless url.nil? || url.is_a?(String)
    end
    certificates.each do |id, type|
      next unless DEVELOPMENT_TYPES.include?(type)

      request('DELETE', URI("#{API}/v1/certificates/#{id}"))
    end
    puts 'Development certificate cleanup completed; distribution certificates preserved.'
  end

  def request(method, uri)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = 10
    http.read_timeout = 30
    request = method == 'DELETE' ? Net::HTTP::Delete.new(uri) : Net::HTTP::Get.new(uri)
    request['Authorization'] = ['Bearer', @token].join(' ')
    request['Accept'] = 'application/json'
    body = +''
    http.request(request) do |response|
      expected = method == 'DELETE' ? '204' : '200'
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
      TestFlightCertificateCleanup.new(
        ENV['APP_STORE_CONNECT_KEY_P8'], ENV['APP_STORE_CONNECT_KEY_ID'],
        ENV['APP_STORE_CONNECT_ISSUER_ID']
      ).run
    end
  rescue StandardError
    warn '::error::Development certificate cleanup failed. Check App Store Connect certificate permissions/connectivity; no identifiers or API diagnostics are logged.'
    exit 1
  end
end
