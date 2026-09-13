-- ===========================================================================
-- Take DELETE away from the runtime role on the communication records that
-- are evidence.
--
-- WHY THIS IS A SEPARATE MIGRATION. 0001 sets
--   ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE
-- so every table created afterwards starts with full DML for evercalm_app.
-- A narrower GRANT in a later migration is therefore a no-op: it adds
-- privileges that are already there and takes nothing away. Restricting a new
-- table needs an explicit REVOKE, which is how `audit_events` (0001) and
-- `separations` (0004) do it. 0011 granted narrowly and said it had
-- restricted; it had not. This makes the stated guarantee true.
--
-- What each revocation protects:
--
--   announcement_recipients  A receipt is the evidence that somebody was told
--                            something and whether they confirmed it.
--                            Archiving retires an announcement and leaves the
--                            receipts intact; nothing should erase one.
--   announcement_revisions   Content history. An acknowledgement points at a
--                            specific wording, so that wording has to survive.
--                            Draft editing rewrites revision 1 in place, which
--                            needs UPDATE and not DELETE.
--   notifications            A delivery record, including a suppressed one -
--                            the proof that we deliberately did not tell
--                            somebody something. Cancelling sets a status.
--
-- UPDATE is deliberately retained on all three: view counts, acknowledgement
-- stamps, delivery state and draft edits are all updates.
-- ===========================================================================

REVOKE DELETE ON "announcement_recipients" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "announcement_revisions" FROM evercalm_app;--> statement-breakpoint
REVOKE DELETE ON "notifications" FROM evercalm_app;
