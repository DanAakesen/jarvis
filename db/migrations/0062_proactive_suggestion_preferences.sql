ALTER TABLE dbo.proactive_settings ADD
  categories_json nvarchar(max) NOT NULL CONSTRAINT DF_proactive_settings_categories_json
    DEFAULT N'{"deadline":true,"clash":true,"travel":true,"todo":true,"prep":true,"news":true,"weather":true,"status":true,"suggestion":true}',
  suggestion_scope nvarchar(16) NOT NULL CONSTRAINT DF_proactive_settings_suggestion_scope DEFAULT N'all',
  CONSTRAINT CK_proactive_settings_categories_json CHECK (ISJSON(categories_json) = 1),
  CONSTRAINT CK_proactive_settings_suggestion_scope CHECK (suggestion_scope IN (N'all', N'personal', N'work'));

ALTER TABLE dbo.proactive_items ADD
  suggestion_scope nvarchar(16) NOT NULL CONSTRAINT DF_proactive_items_suggestion_scope DEFAULT N'unknown',
  CONSTRAINT CK_proactive_items_suggestion_scope CHECK (suggestion_scope IN (N'personal', N'work', N'unknown'));
