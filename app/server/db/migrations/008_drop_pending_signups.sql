-- Signup now proves the email with a one-time code before anything is saved (ADR 0007), so nothing waits in this table.
drop table pending_signups;
