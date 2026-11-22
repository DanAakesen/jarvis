# Daily integration scope

Jarvis Health uses its own backend, owner authorization and Azure SQL `daily` schema. The database export/import proposal was withdrawn; the original Daily service is not a runtime dependency.

- [Approved source scope and tracking issues](https://github.com/DanAakesen/jarvis/issues/1005)
- [Current Jarvis Health interfaces](../../../apps/backend/src/health/README.md)
- [Health upload contract](health-ingestion.md) and [SQL field mapping](schema-mapping.md)

The [original migration scope](https://github.com/DanAakesen/jarvis/blob/3851f4d96cc6d33b2c4b55f6a0c8ae29d1816177/docs/reference/daily/migration.md) remains in Git history. It is not a rollout checklist.
