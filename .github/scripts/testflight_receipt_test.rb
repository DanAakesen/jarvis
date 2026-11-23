require 'minitest/autorun'
require_relative 'testflight_receipt'

class TestFlightReceiptTest < Minitest::Test
  def test_valid_internal_build_is_available
    assert available_to_internal_testing?('VALID', 'IN_BETA_TESTING', false)
  end

  def test_processing_build_is_not_available
    refute available_to_internal_testing?('PROCESSING', 'PROCESSING', false)
  end

  def test_ready_but_not_testing_is_not_available
    refute available_to_internal_testing?('VALID', 'READY_FOR_BETA_TESTING', false)
  end

  def test_expired_build_is_not_available
    refute available_to_internal_testing?('VALID', 'IN_BETA_TESTING', true)
  end

  def test_missing_expiration_state_is_not_available
    refute available_to_internal_testing?('VALID', 'IN_BETA_TESTING', nil)
  end
end
