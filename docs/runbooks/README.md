# Operational runbooks

Written before launch, for the people who will run EverCalm in production.
Nothing here has been executed against a production system: there is no
production system yet. Each runbook says what must exist first.

| Runbook                                                 | When you need it                                             |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| [Production readiness](production-readiness.md)         | Before the first real customer: what is not yet configured   |
| [Launch checklist](launch-checklist.md)                 | Security, privacy and abuse protection, item by item         |
| [Billing provider](billing-provider.md)                 | Connecting a real payment provider to the billing foundation |
| [Migrations and rollback](migrations-and-rollback.md)   | Every deploy that changes the database                       |
| [Backup and restore](backup-and-restore.md)             | Setting up backups, and proving a restore works              |
| [Incident response](incident-response.md)               | Something is broken or data may be exposed                   |
| [Customer support](customer-support.md)                 | Working the support queue on the EverCalm team dashboard     |
| [Data retention and account closure](data-retention.md) | A customer leaves, or asks for their data                    |
