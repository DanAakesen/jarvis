IF EXISTS (SELECT 1 FROM daily.training_targets WITH (TABLOCKX,HOLDLOCK))
  THROW 51000,'Daily training targets are owner settings and must be retained',1;
DROP TABLE daily.training_targets;
