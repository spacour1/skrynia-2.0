-- The ledger is the system of record for money movement: once an entry/line is posted it
-- must never be edited or removed, only ever appended to (an "adjustment" entry corrects a
-- mistake, it never rewrites history). Enforce that in the database itself rather than
-- relying on every caller to remember not to UPDATE/DELETE these rows.
create or replace function forbid_ledger_mutation() returns trigger as $$
begin
  raise exception 'ledger rows are immutable - post a correcting entry instead of modifying %.%', tg_table_name, tg_op;
end;
$$ language plpgsql;

drop trigger if exists ledger_entries_immutable on ledger_entries;
create trigger ledger_entries_immutable
  before update or delete on ledger_entries
  for each row execute function forbid_ledger_mutation();

drop trigger if exists ledger_lines_immutable on ledger_lines;
create trigger ledger_lines_immutable
  before update or delete on ledger_lines
  for each row execute function forbid_ledger_mutation();
