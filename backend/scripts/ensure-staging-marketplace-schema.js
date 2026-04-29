const pool = require("../db");

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      provider_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      category TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      price NUMERIC(12, 2) NOT NULL DEFAULT 0,
      location TEXT,
      city TEXT,
      country TEXT,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'published',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_created_at ON services(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_services_details_gin ON services USING GIN(details);`);

  await pool.query(`
    ALTER TABLE services
      ADD COLUMN IF NOT EXISTS availability JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS vehicle_model TEXT,
      ADD COLUMN IF NOT EXISTS moderation_status TEXT,
      ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS approved_by INTEGER,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejected_by INTEGER,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_by INTEGER,
      ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
      ADD COLUMN IF NOT EXISTS gross_price NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS net_price NUMERIC(12, 2);
  `);

  await pool.query(`ALTER TABLE services ALTER COLUMN price DROP NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT,
      password TEXT NOT NULL DEFAULT '',
      type TEXT,
      location TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      phone TEXT,
      social TEXT,
      photo TEXT,
      certificate TEXT,
      address TEXT,
      telegram_chat_id TEXT,
      tg_chat_id TEXT,
      telegram_refused_chat_id TEXT,
      telegram_web_chat_id TEXT,
      languages JSONB NOT NULL DEFAULT '[]'::jsonb,
      city_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      car_fleet JSONB NOT NULL DEFAULT '[]'::jsonb,
      hotel_id INTEGER,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'providers'
          AND column_name = 'location'
          AND data_type <> 'ARRAY'
      ) THEN
        ALTER TABLE providers
          ALTER COLUMN location DROP DEFAULT,
          ALTER COLUMN location TYPE TEXT[]
          USING CASE
            WHEN location IS NULL OR btrim(location::text) = '' THEN ARRAY[]::text[]
            WHEN location::text ~ '^\\{.*\\}$' THEN string_to_array(replace(btrim(location::text, '{}'), '"', ''), ',')::text[]
            ELSE ARRAY[location::text]::text[]
          END,
          ALTER COLUMN location SET DEFAULT ARRAY[]::text[],
          ALTER COLUMN location SET NOT NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'providers'
          AND column_name = 'city_slugs'
          AND data_type <> 'ARRAY'
      ) THEN
        ALTER TABLE providers DROP COLUMN city_slugs;
        ALTER TABLE providers ADD COLUMN city_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::text[];
      END IF;
    END $$;
  `);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_lower_email ON providers (lower(email));`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_services (
      id SERIAL PRIMARY KEY,
      provider_id INTEGER NOT NULL,
      category TEXT,
      title TEXT,
      price NUMERIC(12, 2),
      currency TEXT NOT NULL DEFAULT 'UZS',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      vehicle_model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_services_provider_id ON provider_services(provider_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_services_active_category ON provider_services(is_active, category);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_favorites (
      id SERIAL PRIMARY KEY,
      provider_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider_id, service_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_blocked_dates (
      provider_id INTEGER NOT NULL,
      date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(provider_id, date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_views (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL,
      viewer_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_service_views_service_id ON service_views(service_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_service_views_recent ON service_views(service_id, viewer_key, created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_service_contact_unlocks (
      id SERIAL PRIMARY KEY,
      client_id INTEGER,
      service_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_service_contact_unlocks_service_id ON client_service_contact_unlocks(service_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL,
      client_id INTEGER,
      provider_id INTEGER,
      author_provider_id INTEGER,
      created_by INTEGER,
      owner_id INTEGER,
      status TEXT NOT NULL DEFAULT 'new',
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_requests_service_id ON requests(service_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_requests_client_id ON requests(client_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);`);

  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS airport_cities (
      geoname_id INTEGER PRIMARY KEY,
      country_code TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ru TEXT,
      name_uz TEXT,
      iata_codes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      population INTEGER,
      search_text TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_airport_cities_search_trgm
      ON airport_cities USING GIN(search_text gin_trgm_ops);
  `);

  await pool.query(`
    INSERT INTO airport_cities
      (geoname_id, country_code, name_en, name_ru, name_uz, iata_codes, population, search_text)
    VALUES
      (1512569, 'UZ', 'Tashkent', 'Ташкент', 'Toshkent', ARRAY['TAS'], 2571668, 'tashkent ташкент toshkent tas uzbekistan'),
      (1216265, 'UZ', 'Samarkand', 'Самарканд', 'Samarqand', ARRAY['SKD'], 546303, 'samarkand самарканд samarqand skd uzbekistan'),
      (1217662, 'UZ', 'Bukhara', 'Бухара', 'Buxoro', ARRAY['BHK'], 280187, 'bukhara бухара buxoro bhk uzbekistan'),
      (1566083, 'VN', 'Ho Chi Minh City', 'Хошимин', 'Ho Chi Minh', ARRAY['SGN'], 8993082, 'ho chi minh city saigon хошимин сайгон sgn vietnam'),
      (1581130, 'VN', 'Hanoi', 'Ханой', 'Hanoi', ARRAY['HAN'], 8053663, 'hanoi ханой han vietnam'),
      (1583992, 'VN', 'Da Nang', 'Дананг', 'Da Nang', ARRAY['DAD'], 1134310, 'da nang дананг dad vietnam'),
      (745044, 'TR', 'Istanbul', 'Стамбул', 'Istanbul', ARRAY['IST','SAW'], 15519267, 'istanbul стамбул ist saw turkey'),
      (292223, 'AE', 'Dubai', 'Дубай', 'Dubai', ARRAY['DXB'], 3331420, 'dubai дубай dxb uae emirates'),
      (1273294, 'IN', 'Delhi', 'Дели', 'Delhi', ARRAY['DEL'], 16787941, 'delhi new delhi дели del india'),
      (1609350, 'TH', 'Bangkok', 'Бангкок', 'Bangkok', ARRAY['BKK'], 5104476, 'bangkok бангкок bkk thailand')
    ON CONFLICT (geoname_id) DO UPDATE SET
      country_code = EXCLUDED.country_code,
      name_en = EXCLUDED.name_en,
      name_ru = EXCLUDED.name_ru,
      name_uz = EXCLUDED.name_uz,
      iata_codes = EXCLUDED.iata_codes,
      population = EXCLUDED.population,
      search_text = EXCLUDED.search_text;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cms_pages (
      slug TEXT PRIMARY KEY,
      title_ru TEXT,
      title_uz TEXT,
      title_en TEXT,
      body_ru TEXT,
      body_uz TEXT,
      body_en TEXT,
      published BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cms_pages_published ON cms_pages(published);`);

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM services;`);
  if (rows[0].count === 0) {
    await pool.query(
      `
      INSERT INTO services
        (title, description, category, currency, price, location, city, country, details, status, created_at)
      VALUES
        ($1, $2, $3, 'USD', 120, 'Tashkent', 'Tashkent', 'Uzbekistan', $4::jsonb, 'published', NOW() - INTERVAL '1 day'),
        ($5, $6, $7, 'USD', 260, 'Samarkand', 'Samarkand', 'Uzbekistan', $8::jsonb, 'published', NOW() - INTERVAL '2 days'),
        ($9, $10, $11, 'USD', 80, 'Bukhara', 'Bukhara', 'Uzbekistan', $12::jsonb, 'published', NOW() - INTERVAL '3 days')
      `,
      [
        "Staging city tour",
        "Test service for staging marketplace",
        "guide",
        JSON.stringify({ isActive: true, top_points: 10, views: 150 }),
        "Staging hotel package",
        "Test hotel package for staging",
        "hotel",
        JSON.stringify({ isActive: true, top_points: 7, startDate: new Date(Date.now() + 5 * 86400000).toISOString() }),
        "Staging transfer",
        "Test transfer service for staging",
        "transport",
        JSON.stringify({ isActive: true, top_points: 5, event_date: new Date(Date.now() + 3 * 86400000).toISOString() }),
      ]
    );
  }

  console.log("staging marketplace schema ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
