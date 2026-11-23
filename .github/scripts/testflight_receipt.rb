require 'json'
require 'net/http'
require 'uri'
require 'yaml'
require_relative 'app_store_connect_jwt'

def asc_get(token, path, params)
  uri = URI("https://api.appstoreconnect.apple.com#{path}")
  uri.query = URI.encode_www_form(params)
  request = Net::HTTP::Get.new(uri)
  request['Authorization'] = "Bearer #{token}"
  request['Accept'] = 'application/json'
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.open_timeout = 10
  http.read_timeout = 30
  response = http.request(request)
  raise 'App Store Connect readback failed' unless response.code == '200' && response.body.bytesize < 2 * 1024 * 1024

  JSON.parse(response.body)
end

def available_to_internal_testing?(processing, internal, expired)
  processing == 'VALID' && internal == 'IN_BETA_TESTING' && expired == false
end

if $PROGRAM_NAME == __FILE__
  begin
    number = ENV.fetch('TARGET_BUILD_NUMBER')
    raise 'Invalid build number' unless number.match?(/\A[1-9][0-9]*\z/)
    project = YAML.safe_load(File.read('apps/ios/project.yml'))
    bundle_id = project.dig('targets', 'Jarvis', 'settings', 'base', 'PRODUCT_BUNDLE_IDENTIFIER')
    expected_version = project.dig('settings', 'base', 'MARKETING_VERSION') if ENV['TARGET_VERIFY_MARKETING_VERSION'] == 'true'
    token = AppStoreConnectJwt.generate(ENV.fetch('APP_STORE_CONNECT_KEY_P8'), ENV.fetch('APP_STORE_CONNECT_KEY_ID'), ENV.fetch('APP_STORE_CONNECT_ISSUER_ID'))
    apps = asc_get(token, '/v1/apps', 'filter[bundleId]' => bundle_id, 'fields[apps]' => 'bundleId', 'limit' => '2')['data']
    raise 'App lookup was empty or ambiguous' unless apps.one? && apps.first.dig('attributes', 'bundleId') == bundle_id
    context = { source_sha: ENV['TARGET_SOURCE_SHA'], source_ref: ENV['TARGET_SOURCE_REF'] }.compact
    query = { 'filter[app]' => apps.first['id'], 'filter[version]' => number,
              'filter[preReleaseVersion.platform]' => 'IOS', 'include' => 'app,preReleaseVersion,buildBetaDetail,betaGroups', 'fields[apps]' => 'bundleId',
              'fields[builds]' => 'version,processingState,uploadedDate,expired,app,preReleaseVersion,buildBetaDetail,betaGroups',
              'fields[preReleaseVersions]' => 'version,platform', 'fields[buildBetaDetails]' => 'internalBuildState',
              'fields[betaGroups]' => 'isInternalGroup', 'limit[betaGroups]' => '50', 'limit' => '10' }
    result = context.merge(marketing_version: expected_version, build_number: number,
                           apple_processing_state: 'NOT_LISTED', available_to_internal_testing: false)
    deadline = Time.now + Integer(ENV.fetch('TESTFLIGHT_RECEIPT_WAIT_SECONDS', '180'))
    loop do
      response = asc_get(token, '/v1/builds', query)
      builds = response['data']
      raise 'Multiple builds match the app and build number' if builds.length > 1
      if builds.one?
        build = builds.first
        raise 'Build app or number does not match' unless build.dig('relationships', 'app', 'data', 'id') == apps.first['id'] && build.dig('attributes', 'version').to_s == number
        included = Array(response['included']).to_h { |item| [[item['type'], item['id']], item] }
        rel = build['relationships']
        pre = included[['preReleaseVersions', rel.dig('preReleaseVersion', 'data', 'id')]]&.dig('attributes') || {}
        raise 'Build platform does not match' unless pre['platform'] == 'IOS'
        raise 'Build marketing version does not match this upload' if expected_version && pre['version'].to_s != expected_version
        beta = included[['buildBetaDetails', rel.dig('buildBetaDetail', 'data', 'id')]]&.dig('attributes') || {}
        groups = Array(rel.dig('betaGroups', 'data')).count do |g|
          included[['betaGroups', g['id']]]&.dig('attributes', 'isInternalGroup') == true
        end
        attrs = build['attributes']
        result = context.merge(marketing_version: pre['version'], build_number: number,
                   apple_processing_state: attrs['processingState'],
                   internal_build_state: beta['internalBuildState'], internal_group_count: groups,
                   available_to_internal_testing: available_to_internal_testing?(attrs['processingState'], beta['internalBuildState'], attrs['expired']))
        break if result[:apple_processing_state] != 'PROCESSING' &&
                 !(result[:apple_processing_state] == 'VALID' && [nil, 'PROCESSING'].include?(result[:internal_build_state]))
      end
      break if Time.now >= deadline
      sleep 20
    end
    json = JSON.pretty_generate(result)
    puts json
    File.open(ENV['GITHUB_STEP_SUMMARY'], 'a:UTF-8') { |summary| summary.puts "## TestFlight read-only receipt\n\n```json\n#{json}\n```" } if ENV['GITHUB_STEP_SUMMARY']
  rescue StandardError
    warn '::error::TestFlight readback failed; no credentials, Apple response body, or tester identities are logged.'
    exit 1
  end
end
