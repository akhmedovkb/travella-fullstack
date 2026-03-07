// backend/controllers/adminPaymeAutoFixController.js

const pool = require("../db");

async function adminPaymeAutoFix(req, res) {
  try {
    const report = {
      fixed_state1: 0,
      fixed_missing_perform: 0,
      fixed_missing_ledger: 0,
      duplicates_removed: 0,
      errors: [],
    };

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // -----------------------------
      // 1️⃣ зависшие state=1 → state=2
      // -----------------------------
      const stuck = await client.query(`
        SELECT id, payme_id, amount
        FROM payme_transactions
        WHERE state = 1
        AND create_time < NOW() - INTERVAL '10 minutes'
      `);

      for (const tx of stuck.rows) {
        await client.query(
          `
          UPDATE payme_transactions
          SET state = 2,
              perform_time = NOW()
          WHERE id = $1
        `,
          [tx.id]
        );

        report.fixed_state1++;
      }

      // --------------------------------
      // 2️⃣ perform_time отсутствует
      // --------------------------------
      const missingPerform = await client.query(`
        SELECT id
        FROM payme_transactions
        WHERE state = 2
        AND perform_time IS NULL
      `);

      for (const tx of missingPerform.rows) {
        await client.query(
          `
          UPDATE payme_transactions
          SET perform_time = NOW()
          WHERE id = $1
        `,
          [tx.id]
        );

        report.fixed_missing_perform++;
      }

      // --------------------------------
      // 3️⃣ нет записи в ledger
      // --------------------------------
      const missingLedger = await client.query(`
        SELECT p.id, p.payme_id, p.amount, p.order_id
        FROM payme_transactions p
        LEFT JOIN contact_balance_ledger l
        ON l.ref_id = p.payme_id
        WHERE p.state = 2
        AND l.id IS NULL
      `);

      for (const tx of missingLedger.rows) {
        await client.query(
          `
          INSERT INTO contact_balance_ledger
          (client_id, amount, type, ref_id, created_at)
          VALUES (
            $1,
            $2,
            'topup',
            $3,
            NOW()
          )
        `,
          [tx.order_id, tx.amount / 100, tx.payme_id]
        );

        report.fixed_missing_ledger++;
      }

      // --------------------------------
      // 4️⃣ удаляем дубли
      // --------------------------------
      const duplicates = await client.query(`
        SELECT payme_id
        FROM payme_transactions
        GROUP BY payme_id
        HAVING COUNT(*) > 1
      `);

      for (const row of duplicates.rows) {
        const dups = await client.query(
          `
          SELECT id
          FROM payme_transactions
          WHERE payme_id = $1
          ORDER BY id
        `,
          [row.payme_id]
        );

        const keep = dups.rows[0].id;

        for (let i = 1; i < dups.rows.length; i++) {
          await client.query(
            `
            DELETE FROM payme_transactions
            WHERE id = $1
          `,
            [dups.rows[i].id]
          );

          report.duplicates_removed++;
        }
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        report,
      });
    } catch (err) {
      await client.query("ROLLBACK");

      report.errors.push(err.message);

      res.status(500).json({
        success: false,
        report,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

module.exports = {
  adminPaymeAutoFix,
};
