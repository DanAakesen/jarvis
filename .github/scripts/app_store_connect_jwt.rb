require 'base64'
require 'json'
require 'openssl'

module AppStoreConnectJwt
  def self.generate(key, key_id, issuer_id, now: Time.now.to_i)
    raise 'Missing API credentials' if [key, key_id, issuer_id].any? { |value| value.nil? || value.empty? }

    signing_key = OpenSSL::PKey.read(key)
    unless signing_key.is_a?(OpenSSL::PKey::EC) && signing_key.private? &&
           signing_key.group.curve_name == 'prime256v1'
      raise 'Invalid API key'
    end
    encode = ->(value) { Base64.urlsafe_encode64(value, padding: false) }
    header = encode.call(JSON.generate(alg: 'ES256', kid: key_id, typ: 'JWT'))
    payload = encode.call(JSON.generate(iss: issuer_id, iat: now - 30, exp: now + 600,
                                       aud: 'appstoreconnect-v1'))
    message = "#{header}.#{payload}"
    der = signing_key.sign(OpenSSL::Digest::SHA256.new, message)
    signature = OpenSSL::ASN1.decode(der).value.map do |integer|
      [integer.value.to_i.to_s(16).rjust(64, '0')].pack('H*')
    end.join
    "#{message}.#{encode.call(signature)}"
  end
end
