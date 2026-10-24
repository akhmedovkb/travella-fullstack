const { Client } = require("pg");
const {
  getAllowedProviderServiceCategories,
  TRANSPORT_SERVICE_CATEGORY_SET,
} = require("../utils/providerServiceCatalog");

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_PUBLIC_URL or DATABASE_URL is required");
}

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query("BEGIN");
    const providers = await client.query(
      `SELECT DISTINCT ON (LOWER(type)) id, LOWER(type) AS type
         FROM providers
        WHERE LOWER(type) IN ('agent', 'guide', 'transport')
        ORDER BY LOWER(type), id`
    );

    const tested = [];
    for (const provider of providers.rows) {
      for (const category of getAllowedProviderServiceCategories(provider.type)) {
        const isTransport = TRANSPORT_SERVICE_CATEGORY_SET.has(category);
        const details = isTransport
          ? { seats: 4, vehicle_model: "CRUD smoke vehicle" }
          : { city_slug: "tashkent" };
        const inserted = await client.query(
          `INSERT INTO provider_services
             (provider_id, category, title, price, currency, is_active, details, vehicle_model)
           VALUES ($1, $2, $3, $4, 'UZS', TRUE, $5::jsonb, $6)
           RETURNING id`,
          [
            provider.id,
            category,
            `CRUD smoke: ${category}`,
            1000,
            JSON.stringify(details),
            isTransport ? "CRUD smoke vehicle" : null,
          ]
        );
        const id = inserted.rows[0].id;

        const updated = await client.query(
          `UPDATE provider_services
              SET title = $1, price = $2, updated_at = NOW()
            WHERE id = $3 AND provider_id = $4
            RETURNING id, title, price`,
          [`CRUD smoke updated: ${category}`, 2000, id, provider.id]
        );
        if (updated.rowCount !== 1 || Number(updated.rows[0].price) !== 2000) {
          throw new Error(`Update failed for ${provider.type}/${category}`);
        }

        const deleted = await client.query(
          `DELETE FROM provider_services WHERE id = $1 AND provider_id = $2 RETURNING id`,
          [id, provider.id]
        );
        if (deleted.rowCount !== 1) {
          throw new Error(`Delete failed for ${provider.type}/${category}`);
        }
        tested.push(`${provider.type}/${category}`);
      }
    }

    const expectedTypes = ["agent", "guide", "transport"];
    const foundTypes = new Set(providers.rows.map((row) => row.type));
    const missingTypes = expectedTypes.filter((type) => !foundTypes.has(type));
    if (missingTypes.length) {
      throw new Error(`No provider available for: ${missingTypes.join(", ")}`);
    }

    await client.query("ROLLBACK");
    console.log(JSON.stringify({ ok: true, operations: tested.length, persisted: false }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
