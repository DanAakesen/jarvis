ALTER TABLE dbo.activity ADD
  github_app_scope_key char(64) COLLATE Latin1_General_100_BIN2 NULL,
  recovered_at datetime2(7) NULL;

ALTER TABLE dbo.activity ADD
  CONSTRAINT CK_activity_github_app_scope CHECK (
    github_app_scope_key IS NULL OR (
      alert_key LIKE N'credential:github-app:failed:%' AND
      github_app_scope_key NOT LIKE '%[^0-9a-f]%'
    )
  ),
  CONSTRAINT CK_activity_github_app_recovered CHECK (
    recovered_at IS NULL OR (
      github_app_scope_key IS NOT NULL AND
      alert_key LIKE N'credential:github-app:failed:%'
    )
  );

CREATE TABLE dbo.github_app_mint_status (
  scope_key char(64) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT PK_github_app_mint_status PRIMARY KEY,
  status nvarchar(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
  last_checked_at datetime2(7) NOT NULL,
  CONSTRAINT CK_github_app_mint_status_scope CHECK (scope_key NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT CK_github_app_mint_status_value CHECK (status IN (N'ok', N'failed'))
);

IF EXISTS (SELECT 1 FROM dbo.credential_status WHERE name = N'github-app' AND status = N'failed')
  AND NOT EXISTS (
    SELECT 1 FROM dbo.activity WHERE alert_key LIKE N'credential:github-app:failed:%'
  )
BEGIN
  INSERT dbo.activity (area, kind, title, alert_key)
  VALUES (N'operations', N'credential_expiry',
    N'GitHub App token mint failed; check the App key and installation',
    N'credential:github-app:failed:legacy-unscoped');
END;
