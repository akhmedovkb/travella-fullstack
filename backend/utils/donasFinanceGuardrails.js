// backend/utils/donasFinanceGuardrails.js

/**
 * Dona's Dosas FINANCE → Months (DB Guardrails)
 *
 * Enforces at DB level:
 * - UNIQUE (slug, month)
 * - month is always first day of month
 * - non-negative money fields where applicable (cash_end can be negative → not constrained)
 * - donas_purchases.total non-negative
 * - locked months (#locked in notes) are DB read-only:
 *   UPDATE/DELETE blocked unless caller explicitly allows via:
 *     BEGIN;
 *     SET LOCAL donas.allow_locked_write = '1';
 *     ...writes to locked row...
 *     COMMIT;
 */

async function allowLockedWrite(client) {
  // must be inside a transaction
  await client.query("set local donas.allow_locked_write = '1'");
}

async function ensureDonasFinanceGuardrails(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");

    // guard: donas_finance_months must exist
    const t = await client.query(
      `
      select 1
      from information_schema.tables
      where table_schema='public' and table_name='donas_finance_months'
      limit 1
      `
    );
    if (!t.rows.length) {
      await client.query("commit");
      return;
    }

    // Strong uniqueness (required for safe upserts)
    await client.query(
      `
      create unique index if not exists donas_finance_months_slug_month_uq
      on donas_finance_months (slug, month)
      `
    );

    // Month must be first day of month
    await client.query(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname='donas_finance_months_month_first_day_chk'
        ) then
          alter table donas_finance_months
            add constraint donas_finance_months_month_first_day_chk
            check (month = date_trunc('month', month)::date);
        end if;
      end$$;
    `);

    // Non-negative money fields (cash_end intentionally excluded)
    await client.query(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname='donas_finance_months_nonneg_chk'
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

    // Purchases totals non-negative (if table exists)
    await client.query(`
      do $$
      begin
        if exists (
          select 1 from information_schema.tables
          where table_schema='public' and table_name='donas_purchases'
        ) then
          if not exists (
            select 1 from pg_constraint where conname='donas_purchases_total_nonneg_chk'
          ) then
            alter table donas_purchases
              add constraint donas_purchases_total_nonneg_chk
              check (coalesce(total, 0) >= 0);
          end if;
        end if;
      end$$;
    `);

    // Trigger function: block write to locked rows unless allow flag is set
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

        if tg_op = 'DELETE' then
          old_locked := (coalesce(old.notes,'') ilike '%#locked%');
          if old_locked and allow_write is distinct from '1' then
            raise exception 'Locked month is read-only (DB). Use Unlock/Resnapshot actions.';
          end if;
          return old;
        end if;

        old_locked := (coalesce(old.notes,'') ilike '%#locked%');
        new_locked := (coalesce(new.notes,'') ilike '%#locked%');

        -- forbid manual locking by writing notes
        if (not old_locked) and new_locked and allow_write is distinct from '1' then
          raise exception 'Cannot set #locked via notes (DB). Use Lock action.';
        end if;

        -- forbid any updates on locked rows
        if old_locked and allow_write is distinct from '1' then
          raise exception 'Locked month is read-only (DB). Use Unlock/Resnapshot actions.';
        end if;

        return new;
      end$$;
    `);

    // Attach trigger if not exists
    await client.query(`
      do $$
      begin
        if not exists (
          select 1 from pg_trigger where tgname='donas_finance_months_guard_trg'
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
