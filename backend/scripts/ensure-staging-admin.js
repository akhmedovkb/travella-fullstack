const bcrypt = require("bcryptjs");
const pool = require("../db");

async function main() {
  const email = String(process.env.STAGING_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.STAGING_ADMIN_PASSWORD || "");

  if (!email || !password) {
    throw new Error("STAGING_ADMIN_EMAIL and STAGING_ADMIN_PASSWORD are required");
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `
    INSERT INTO providers
      (name, email, password, type, location, phone, social, address, is_admin, languages, city_slugs, car_fleet)
    VALUES
      ($1, $2, $3, $4, $5::text[], $6, $7, $8, TRUE, $9::jsonb, $10::text[], $11::jsonb)
    ON CONFLICT (lower(email)) DO UPDATE SET
      password = EXCLUDED.password,
      is_admin = TRUE,
      type = EXCLUDED.type,
      location = EXCLUDED.location,
      phone = EXCLUDED.phone,
      social = EXCLUDED.social,
      address = EXCLUDED.address,
      languages = EXCLUDED.languages,
      city_slugs = EXCLUDED.city_slugs,
      updated_at = NOW()
    RETURNING id, email, is_admin
    `,
    [
      "Staging Admin",
      email,
      hash,
      "admin",
      ["Tashkent"],
      "+998900000001",
      "@staging_admin",
      "Tashkent staging admin",
      JSON.stringify(["ru", "en"]),
      ["tashkent"],
      JSON.stringify([]),
    ]
  );

  console.log(`staging admin ok: ${rows[0].email} id=${rows[0].id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
