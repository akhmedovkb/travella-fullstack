/* eslint-disable no-console */

const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const { uploadToR2 } = require("../utils/r2");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 150 * 1024 * 1024,
    files: 80,
  },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL
    ? { rejectUnauthorized: false }
    : undefined,
});

const db = {
  query: (q, p) => pool.query(q, p),
};

let ensured = false;

async function ensureTables() {
  if (ensured) return;

  await db.query(`

CREATE TABLE IF NOT EXISTS hotel_inspections (

id SERIAL PRIMARY KEY,

hotel_id INTEGER NOT NULL
REFERENCES hotels(id)
ON DELETE CASCADE,

author_role TEXT,
author_id TEXT,

title TEXT,

review TEXT NOT NULL,

pros TEXT,
cons TEXT,
features TEXT,

media JSONB DEFAULT '[]'::jsonb,

scores JSONB DEFAULT '{}'::jsonb,
amenities JSONB DEFAULT '[]'::jsonb,
nearby JSONB DEFAULT '{}'::jsonb,

audience_keys JSONB DEFAULT '[]'::jsonb,
con_keys JSONB DEFAULT '[]'::jsonb,

travel_month INTEGER,
trip_type TEXT,
visit_type TEXT,

recommendation_score INTEGER DEFAULT 0,

likes INTEGER DEFAULT 0,

created_at TIMESTAMP DEFAULT NOW()

);

CREATE TABLE IF NOT EXISTS hotel_inspection_media (

id SERIAL PRIMARY KEY,

inspection_id INTEGER NOT NULL
REFERENCES hotel_inspections(id)
ON DELETE CASCADE,

media_type TEXT NOT NULL,

section_key TEXT,

caption TEXT,

tags JSONB DEFAULT '[]'::jsonb,

url TEXT NOT NULL,

thumbnail_url TEXT,

created_at TIMESTAMP DEFAULT NOW()

);

`);

  ensured = true;
}

async function createInspection(req, res) {
  try {
    await ensureTables();

    const hotelId = Number(req.params.hotelId);

    const p = req.body || {};

    const mediaMeta =
      typeof p.mediaMeta === "string"
        ? JSON.parse(p.mediaMeta)
        : p.mediaMeta || [];

    const parseJson = (v, fallback) => {
      try {
        if (typeof v === "string")
          return JSON.parse(v);

        return v ?? fallback;
      } catch {
        return fallback;
      }
    };

    const insert = await db.query(
      `
INSERT INTO hotel_inspections(

hotel_id,
author_role,
author_id,

title,

review,

pros,
cons,
features,

media,

scores,
amenities,
nearby,

audience_keys,
con_keys,

travel_month,
trip_type,
visit_type,

recommendation_score

)

VALUES(

$1,$2,$3,

$4,

$5,

$6,$7,$8,

$9,

$10,$11,$12,

$13,$14,

$15,$16,$17,

$18

)

RETURNING id
`,
      [
        hotelId,

        req.user?.role || null,
        req.user?.id || null,

        p.title || null,

        p.review,

        p.pros || null,
        p.cons || null,
        p.features || null,

        JSON.stringify(parseJson(p.media, [])),

        JSON.stringify(parseJson(p.scores, {})),

        JSON.stringify(parseJson(p.amenities, [])),

        JSON.stringify(parseJson(p.nearby, {})),

        JSON.stringify(
          parseJson(
            p.audience_keys,
            []
          )
        ),

        JSON.stringify(
          parseJson(
            p.con_keys,
            []
          )
        ),

        p.travel_month || null,

        p.trip_type || null,

        p.visit_type || null,

        p.recommendation_score || 0,
      ]
    );

    const inspectionId =
      insert.rows[0].id;

    const files =
      req.files || [];

    for (
      let i = 0;
      i < files.length;
      i++
    ) {
      const file = files[i];

      const meta =
        mediaMeta[i] || {};

      const key = `hotel-passport/${inspectionId}/${Date.now()}_${i}${path.extname(file.originalname)}`;

      const url =
        await uploadToR2({
          buffer: file.buffer,
          key,
          contentType:
            file.mimetype,
        });

      await db.query(
        `
INSERT INTO hotel_inspection_media(

inspection_id,

media_type,

section_key,

caption,

tags,

url,

thumbnail_url

)

VALUES(

$1,$2,$3,$4,$5,$6,$7

)
`,
        [
          inspectionId,

          file.mimetype.startsWith(
            "video/"
          )
            ? "video"
            : "photo",

          meta.section_key ||
            "room",

          meta.caption ||
            null,

          JSON.stringify(
            meta.tags || []
          ),

          url,

          url,
        ]
      );
    }

    res.json({
      success: true,
      id: inspectionId,
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: "create_failed",
    });
  }
}

async function listInspections(
  req,
  res
) {
  try {
    await ensureTables();

    const hotelId = Number(
      req.params.hotelId
    );

    const q =
      await db.query(
        `
SELECT *

FROM hotel_inspections

WHERE hotel_id=$1

ORDER BY
likes DESC,
created_at DESC
`,
        [hotelId]
      );

    for (const row of q.rows) {
      const media =
        await db.query(
          `
SELECT *

FROM hotel_inspection_media

WHERE inspection_id=$1
`,
          [row.id]
        );

      row.section_media =
        media.rows;
    }

    res.json({
      items: q.rows,
      count:
        q.rows.length,
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: "list_failed",
    });
  }
}

async function likeInspection(
  req,
  res
) {
  const id = Number(
    req.params.inspectionId
  );

  const q =
    await db.query(
      `
UPDATE hotel_inspections

SET likes=likes+1

WHERE id=$1

RETURNING likes
`,
      [id]
    );

  res.json(q.rows[0]);
}

module.exports = {
  upload,
  createInspection,
  listInspections,
  likeInspection,
};
