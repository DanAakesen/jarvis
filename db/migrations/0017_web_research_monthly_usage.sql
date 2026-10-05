CREATE TABLE dbo.web_research_monthly_usage (
  month_start date NOT NULL CONSTRAINT PK_web_research_monthly_usage PRIMARY KEY,
  transaction_count int NOT NULL CONSTRAINT CK_web_research_monthly_usage_count CHECK (transaction_count > 0),
  updated_at datetime2(7) NOT NULL
);
