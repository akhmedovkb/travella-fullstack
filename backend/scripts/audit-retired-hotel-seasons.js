const db = require('../db');

async function main() {
  const tableResult = await db.query(
    `SELECT to_regclass('public.hotel_seasons')::text AS table_name`
  );
  const tableName = tableResult.rows[0]?.table_name || null;
  if (!tableName) {
    console.log(JSON.stringify({ exists: false, rows: 0, dependencies: [] }));
    return;
  }

  const [countResult, columnsResult, dependenciesResult] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS count FROM hotel_seasons`),
    db.query(
      `SELECT column_name,data_type,is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='hotel_seasons'
        ORDER BY ordinal_position`
    ),
    db.query(
      `SELECT tc.constraint_name,tc.constraint_type,kcu.table_name,kcu.column_name
         FROM information_schema.table_constraints tc
         LEFT JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_schema=tc.constraint_schema
          AND kcu.constraint_name=tc.constraint_name
        WHERE tc.constraint_schema='public'
          AND tc.table_name='hotel_seasons'
        ORDER BY tc.constraint_name,kcu.ordinal_position`
    ),
  ]);

  console.log(JSON.stringify({
    exists: true,
    rows: Number(countResult.rows[0]?.count || 0),
    columns: columnsResult.rows,
    dependencies: dependenciesResult.rows,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end());
