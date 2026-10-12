/** Target schema registry, based on supplied definitions; not a live inventory claim. */
export const dailyTables = {
  "health_ingestions": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "automation_id",
      "session_id",
      "checksum",
      "status",
      "content_bytes",
      "received_at",
      "completed_at",
      "request_metadata_json",
      "normalized_counts_json",
      "error_code",
      "error_message"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "health_raw_objects": {
    "keys": [
      "ingestion_id"
    ],
    "columns": [
      "ingestion_id",
      "object_key",
      "checksum",
      "sanitized_checksum",
      "content_bytes",
      "content_type",
      "stored_at",
      "expires_at",
      "storage_status",
      "last_error",
      "deleted_at"
    ],
    "keyTypes": {
      "ingestion_id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "health_daily_metrics": {
    "keys": [
      "metric_name",
      "metric_date"
    ],
    "columns": [
      "metric_name",
      "metric_date",
      "unit",
      "value",
      "min_value",
      "avg_value",
      "max_value",
      "sample_count",
      "start_at",
      "end_at",
      "fields_json",
      "ingestion_id",
      "updated_at"
    ],
    "keyTypes": {
      "metric_name": {
        "type": "text",
        "maxLength": 256
      },
      "metric_date": {
        "type": "date"
      }
    }
  },
  "health_sleep_daily": {
    "keys": [
      "sleep_date"
    ],
    "columns": [
      "sleep_date",
      "sleep_start",
      "sleep_end",
      "total_sleep_hours",
      "asleep_hours",
      "core_hours",
      "deep_hours",
      "rem_hours",
      "awake_hours",
      "in_bed_hours",
      "source_json",
      "segment_count",
      "ingestion_id",
      "updated_at"
    ],
    "keyTypes": {
      "sleep_date": {
        "type": "date"
      }
    }
  },
  "health_workouts": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "workout_type",
      "activity_identifier",
      "workout_date",
      "start_at",
      "end_at",
      "duration_seconds",
      "source_name",
      "is_indoor",
      "active_energy_value",
      "active_energy_unit",
      "total_energy_value",
      "total_energy_unit",
      "distance_value",
      "distance_unit",
      "avg_heart_rate",
      "max_heart_rate",
      "detail_json",
      "ingestion_id",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "health_workout_metrics": {
    "keys": [
      "workout_id",
      "metric_name"
    ],
    "columns": [
      "workout_id",
      "metric_name",
      "unit",
      "value",
      "min_value",
      "avg_value",
      "max_value",
      "sample_count",
      "fields_json",
      "ingestion_id",
      "updated_at"
    ],
    "keyTypes": {
      "workout_id": {
        "type": "text",
        "maxLength": 256
      },
      "metric_name": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "health_workout_heart_rate_minute": {
    "keys": [
      "workout_id",
      "sample_minute",
      "metric_name"
    ],
    "columns": [
      "workout_id",
      "sample_minute",
      "metric_name",
      "min_value",
      "avg_value",
      "max_value",
      "unit",
      "source_json",
      "sample_count",
      "ingestion_id",
      "updated_at"
    ],
    "keyTypes": {
      "workout_id": {
        "type": "text",
        "maxLength": 256
      },
      "sample_minute": {
        "type": "text",
        "maxLength": 64
      },
      "metric_name": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "health_sync_state": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "last_attempt_at",
      "last_success_at",
      "last_automation_id",
      "last_session_id",
      "last_checksum",
      "last_error",
      "last_error_at",
      "last_cleanup_at",
      "last_counts_json",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "bigint"
      }
    }
  },
  "health_sync_feeds": {
    "keys": [
      "feed_kind"
    ],
    "columns": [
      "feed_kind",
      "automation_id",
      "session_id",
      "checksum",
      "last_success_at",
      "last_counts_json",
      "updated_at"
    ],
    "keyTypes": {
      "feed_kind": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "health_phone_sync_state": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "last_received_at",
      "shortcut_name",
      "checked_feeds_json",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "bigint"
      }
    }
  },
  "nutrition_queue": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "idempotency_key",
      "meal_name",
      "meal_type",
      "components_json",
      "occurred_at",
      "energy_kcal",
      "protein_grams",
      "carbohydrates_grams",
      "fat_grams",
      "fiber_grams",
      "confidence",
      "capture_method",
      "status",
      "created_at",
      "claimed_at",
      "claim_expires_at",
      "completed_at",
      "writer",
      "last_error",
      "expires_at",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "nutrition_meals": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "idempotency_key",
      "meal_name",
      "meal_type",
      "components_json",
      "occurred_at",
      "meal_date",
      "energy_kcal",
      "protein_grams",
      "carbohydrates_grams",
      "fat_grams",
      "fiber_grams",
      "confidence",
      "capture_method",
      "source",
      "revision",
      "nutrient_provenance_json",
      "apple_health_status",
      "apple_health_completed_at",
      "apple_health_writer",
      "apple_health_error",
      "deleted_at",
      "created_at",
      "expires_at",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "nutrition_favorites": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "favorite_name",
      "nutrient_provenance_json",
      "normalized_name",
      "aliases_json",
      "meal_name",
      "meal_type",
      "components_json",
      "energy_kcal",
      "protein_grams",
      "carbohydrates_grams",
      "fat_grams",
      "fiber_grams",
      "confidence",
      "source_meal_id",
      "source_idempotency_key",
      "created_at",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "nutrition_meal_plans": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "plan_name",
      "normalized_name",
      "description",
      "items_json",
      "energy_kcal",
      "protein_grams",
      "carbohydrates_grams",
      "fat_grams",
      "fiber_grams",
      "revision",
      "deleted_at",
      "created_at",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "nutrition_recommendation_feedback": {
    "keys": [
      "meal_key"
    ],
    "columns": [
      "meal_key",
      "preference",
      "created_at",
      "updated_at"
    ],
    "keyTypes": {
      "meal_key": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "coach_profiles": {
    "keys": [],
    "columns": [
      "display_name",
      "primary_goal",
      "current_phase",
      "date_of_birth",
      "deficit_rate",
      "protein_minimum_grams",
      "protein_per_kg",
      "sleep_target_hours",
      "steps_target",
      "gym_target_weekly",
      "run_target_weekly",
      "coaching_intensity",
      "profanity_preference",
      "meal_schedule_json",
      "food_preferences_json",
      "restrictions_json",
      "football_preferences_json",
      "revision",
      "created_at",
      "updated_at"
    ],
    "keyTypes": {}
  },
  "coach_commitments": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "commitment_date",
      "metric",
      "instruction",
      "target_value",
      "unit",
      "comparison",
      "baseline_value",
      "due_at",
      "status",
      "idempotency_key",
      "created_at",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "readiness_checkins": {
    "keys": [
      "checkin_date"
    ],
    "columns": [
      "checkin_date",
      "feeling_rating",
      "context_text",
      "captured_at",
      "created_at",
      "updated_at"
    ],
    "keyTypes": {
      "checkin_date": {
        "type": "date"
      }
    }
  },
  "recovery_days": {
    "keys": [
      "recovery_date"
    ],
    "columns": [
      "recovery_date",
      "context_text",
      "created_at",
      "updated_at"
    ],
    "keyTypes": {
      "recovery_date": {
        "type": "date"
      }
    }
  },
  "attention_runs": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "idempotency_key",
      "mode",
      "captured_at",
      "received_at",
      "checksum",
      "status",
      "source_status_json",
      "completed_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "attention_source_snapshots": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "run_id",
      "source",
      "status",
      "captured_at",
      "received_at",
      "item_count",
      "checksum",
      "error_code",
      "error_message"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "attention_items": {
    "keys": [
      "snapshot_id",
      "item_type",
      "stable_id"
    ],
    "columns": [
      "snapshot_id",
      "source",
      "item_type",
      "stable_id",
      "parent_id",
      "title",
      "starts_at",
      "ends_at",
      "due_at",
      "priority",
      "is_all_day",
      "state",
      "content_json"
    ],
    "keyTypes": {
      "snapshot_id": {
        "type": "text",
        "maxLength": 256
      },
      "item_type": {
        "type": "text",
        "maxLength": 256
      },
      "stable_id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "gmail_suppressions": {
    "keys": [
      "thread_id"
    ],
    "columns": [
      "thread_id",
      "suppressed_message_id",
      "suppressed_incoming_at",
      "suppressed_at",
      "revived_at",
      "updated_at"
    ],
    "keyTypes": {
      "thread_id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "order_suppressions": {
    "keys": [
      "order_key"
    ],
    "columns": [
      "order_key",
      "suppressed_order_updated_at",
      "suppressed_at",
      "revived_at",
      "updated_at"
    ],
    "keyTypes": {
      "order_key": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "briefing_runs": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "trigger",
      "started_at",
      "completed_at",
      "status",
      "preview_text",
      "body_json",
      "source_snapshots_json",
      "health_status",
      "delivery_status",
      "delivered_at",
      "delivery_evidence_json",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "attention_rule_config": {
    "keys": [
      "key"
    ],
    "columns": [
      "key",
      "value_json",
      "source",
      "updated_at"
    ],
    "keyTypes": {
      "key": {
        "type": "text",
        "maxLength": 256
      }
    }
  },
  "coach_experiments": {
    "keys": [
      "id"
    ],
    "columns": [
      "id",
      "metric",
      "instruction",
      "target_value",
      "target_days",
      "unit",
      "baseline_value",
      "baseline_days",
      "starts_on",
      "ends_on",
      "status",
      "review_start_date",
      "review_end_date",
      "locked_variables_json",
      "rationale",
      "idempotency_key",
      "created_at",
      "updated_at"
    ],
    "keyTypes": {
      "id": {
        "type": "text",
        "maxLength": 256
      }
    }
  }
} as const;
export type DailyTable = keyof typeof dailyTables;
