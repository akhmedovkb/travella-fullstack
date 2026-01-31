// backend/utils/donasFinanceGuardrails.js

/**
 * DB-level guardrails for Dona's Dosas FINANCE → Months.
 *
 * What this enforces:
 * 1) Structural constraints for donas_finance_months (month format, non-negative fields).
 * 2) Strong uniqueness on (slug, month).
 * 3) "#locked" rows are DB read-only: UPDATE/DELETE blocked unless the caller explicitly enables it
 *    via `SET LOCAL donas.allow_locked_write = '1'` inside a transaction.
 * 4) Manual "#locked" in notes is blocked unless `donas.allow_locked_write` is enabled.
 */

async function allowLockedWrite(client) {
  // Must be called inside an open transaction (BEGIN ...).
  await client.query("set local donas.allow_locked_write = '1'");
}

async function ensureDonasFinanceGuardrails(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");

    // Strong uniqueness (required by upserts)
    await client.query(
      "create unique index if not exists donas_finance_months_slug_month_uq on donas_finance_months (slug, month)"
    );

    // Month must always be the first day of month
    await client.query(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'donas_finance_months_month_first_day_chk'
        ) then
          alter table donas_finance_months
            add constraint donas_finance_months_month_first_day_chk
            check (month = date_trunc('month', month)::date);
        end if;
      end$$;
    `);

    // Non-negative numeric fields (cash_end can be negative; do not constrain it)
    await client.query(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'donas_finance_months_nonneg_chk'
        ) then
          alter table donas_finance_months
            add constraint donas_finance_months_nonneg_chk
            check (
              coalesce(revenue, 0) >= 0
              and coalesce(cogs, 0) >= 0
              and coalesce(opex, 0) >= 0
              and coalesce(capex, 0) >= 0
              and coalesce(loan_paid, 0) >= 0
            );
        end if;
      end$$;
    `);

    // Purchases: total must be non-negative (type is intentionally NOT constrained; ledger may store other types)
    await client.query(`
      do $$
      begin
        if exists (select 1 from information_schema.tables where table_name='donas_purchases') then
          if not exists (
            select 1
            from pg_constraint
            where conname = 'donas_purchases_total_nonneg_chk'
          ) then
            alter table donas_purchases
              add constraint donas_purchases_total_nonneg_chk
              check (coalesce(total, 0) >= 0);
          end if;
        end if;
      end$$;
    `);

    // Trigger: lock enforcement
    await client.query(`
      create or replace function donas_finance_months_guard()
      returns trigger
      language plpgsql
      as $$
      declare
        allow_write text;
        old_locked boolean;
        new_locked boolean;
      begin
        allow_write := current_setting('donas.allow_locked_write', true);
        old_locked := (coalesce(old.notes,'') ilike '%#locked%');
        new_locked := (coalesce(new.notes,'') ilike '%#locked%');

        if tg_op = 'DELETE' then
          if old_locked and allow_write is distinct from '1' then
            raise exception 'Locked month is read-only (DB). Use Unlock/Resnapshot actions.';
          end if;
          return old;
        end if;

        if (not old_locked) and new_locked and allow_write is distinct from '1' then
          raise exception 'Cannot set #locked via notes (DB). Use Lock action.';
        end if;

        if old_locked and allow_write is distinct from '1' then
          raise exception 'Locked month is read-only (DB). Use Unlock/Resnapshot actions.';
        end if;

        return new;
      end$$;
    `);

    await client.query(`
      do $$
      begin
        if not exists (
          select 1
          from pg_trigger
          where tgname = 'donas_finance_months_guard_trg'
        ) then
          create trigger donas_finance_months_guard_trg
          before update or delete on donas_finance_months
          for each row
          execute function donas_finance_months_guard();
        end if;
      end$$;
    `);

    await client.query("commit");
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureDonasFinanceGuardrails,
  allowLockedWrite,
};
