const bcrypt = require("bcryptjs");
const pool = require("../db");

if (process.argv.includes("--if-enabled") && process.env.SEED_TOUR_BUILDER_E2E !== "true") {
  console.log("Tour Builder E2E fixture seed is disabled");
  process.exit(0);
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function upsertProvider({ name, email, password, type, isAdmin, phone, social }) {
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO providers
       (name,email,password,type,location,phone,social,address,is_admin,languages,city_slugs,car_fleet)
     VALUES($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10::jsonb,$11::text[],$12::jsonb)
     ON CONFLICT (lower(email)) DO UPDATE SET
       name=EXCLUDED.name,password=EXCLUDED.password,type=EXCLUDED.type,
       location=EXCLUDED.location,phone=EXCLUDED.phone,social=EXCLUDED.social,
       address=EXCLUDED.address,is_admin=EXCLUDED.is_admin,languages=EXCLUDED.languages,
       city_slugs=EXCLUDED.city_slugs,car_fleet=EXCLUDED.car_fleet,updated_at=NOW()
     RETURNING id,email,type,is_admin`,
    [
      name,
      email,
      hash,
      type,
      ["Tashkent"],
      phone,
      social,
      "Tour Builder staging E2E fixture",
      isAdmin,
      JSON.stringify(["ru", "en"]),
      ["tashkent"],
      JSON.stringify([]),
    ]
  );
  return result.rows[0];
}

async function main() {
  const railwayEnvironment = String(process.env.RAILWAY_ENVIRONMENT_NAME || "").toLowerCase();
  if (railwayEnvironment !== "staging") {
    throw new Error(`Refusing to seed Tour Builder E2E accounts outside Railway staging (received ${railwayEnvironment || "unknown"})`);
  }
  const dmc = await upsertProvider({
    name: "Tour Builder E2E DMC",
    email: required("STAGING_E2E_DMC_EMAIL").toLowerCase(),
    password: required("STAGING_E2E_DMC_PASSWORD"),
    type: "agent",
    isAdmin: true,
    phone: "+998900000091",
    social: "@travella_e2e_dmc",
  });
  const supplier = await upsertProvider({
    name: "Tour Builder E2E Guide",
    email: required("STAGING_E2E_SUPPLIER_EMAIL").toLowerCase(),
    password: required("STAGING_E2E_SUPPLIER_PASSWORD"),
    type: "guide",
    isAdmin: false,
    phone: "+998900000092",
    social: "@travella_e2e_supplier",
  });
  console.log(`Tour Builder E2E fixtures ready: DMC #${dmc.id}, supplier #${supplier.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
