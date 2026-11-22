# Reference

Facts about the system that change slowly. Nothing here is a plan or a task list.

| Doc | What it is |
| --- | --- |
| [data-model.md](data-model.md) | The SQL schema, table ownership and data lifecycles. |
| [logs.md](logs.md) | How backend, agent, runner and deployment logs are read, and what is safe to log. |
| [daily/health-ingestion.md](daily/health-ingestion.md) | The acceptance contract for the Daily health upload endpoints (code exists behind a switch). |
| [daily/migration.md](daily/migration.md) and [daily/schema-mapping.md](daily/schema-mapping.md) | The approved Daily-to-Jarvis migration and the schema mapping. |
| [daily-v182/README.md](daily-v182/README.md) | The pinned Daily v182 source contract. |

The pinned [Daily v182 source contract](daily-v182/README.md) documents the original Daily API, tools and schema. Use the [source-to-Jarvis matrix](daily-v182/source-to-jarvis-matrix.md) to compare the implementations and the [delivery status](daily-v182/delivery-status.md) to see what still needs acceptance. The snapshot is not a dependency or a migration to run.
