-- Diagnostic-only first. Review every result before applying data corrections.

SELECT telegram_chat_id, array_agg(id ORDER BY id) AS provider_ids, count(*)
FROM providers
WHERE telegram_chat_id IS NOT NULL
GROUP BY telegram_chat_id
HAVING count(*) > 1;

SELECT tg_chat_id, array_agg(id ORDER BY id) AS provider_ids, count(*)
FROM providers
WHERE tg_chat_id IS NOT NULL
GROUP BY tg_chat_id
HAVING count(*) > 1;

SELECT telegram_web_chat_id, array_agg(id ORDER BY id) AS provider_ids, count(*)
FROM providers
WHERE telegram_web_chat_id IS NOT NULL
GROUP BY telegram_web_chat_id
HAVING count(*) > 1;

SELECT telegram_refused_chat_id, array_agg(id ORDER BY id) AS provider_ids, count(*)
FROM providers
WHERE telegram_refused_chat_id IS NOT NULL
GROUP BY telegram_refused_chat_id
HAVING count(*) > 1;

WITH telegram_links AS (
  SELECT id AS provider_id, 'telegram_refused_chat_id' AS field_name,
         telegram_refused_chat_id::text AS telegram_id
  FROM providers WHERE telegram_refused_chat_id IS NOT NULL
  UNION ALL
  SELECT id, 'telegram_chat_id', telegram_chat_id::text
  FROM providers WHERE telegram_chat_id IS NOT NULL
  UNION ALL
  SELECT id, 'tg_chat_id', tg_chat_id::text
  FROM providers WHERE tg_chat_id IS NOT NULL
  UNION ALL
  SELECT id, 'telegram_web_chat_id', telegram_web_chat_id::text
  FROM providers WHERE telegram_web_chat_id IS NOT NULL
)
SELECT telegram_id,
       array_agg(DISTINCT provider_id ORDER BY provider_id) AS provider_ids,
       jsonb_agg(jsonb_build_object('provider_id', provider_id, 'field', field_name)
                 ORDER BY provider_id, field_name) AS matches
FROM telegram_links
GROUP BY telegram_id
HAVING count(DISTINCT provider_id) > 1
ORDER BY telegram_id;

-- Run only after a human confirms that provider 1430's web link is erroneous.
-- The predicate makes the correction idempotent and prevents overwriting a changed value.
-- BEGIN;
-- UPDATE providers
-- SET telegram_web_chat_id = NULL
-- WHERE id = 1430
--   AND telegram_web_chat_id::text = '6720291137';
-- COMMIT;

-- Add these only after duplicates in the corresponding business-unique fields are resolved.
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_providers_telegram_chat_id
--   ON providers (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_providers_tg_chat_id
--   ON providers (tg_chat_id) WHERE tg_chat_id IS NOT NULL;
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_providers_telegram_refused_chat_id
--   ON providers (telegram_refused_chat_id) WHERE telegram_refused_chat_id IS NOT NULL;
-- telegram_web_chat_id intentionally has no proposed index until its web-link semantics are confirmed.

-- Post-correction verification for the reported actor.
SELECT id, name, telegram_chat_id, tg_chat_id,
       telegram_refused_chat_id, telegram_web_chat_id
FROM providers
WHERE telegram_chat_id::text IN ('6720291137', '6462533802')
   OR tg_chat_id::text IN ('6720291137', '6462533802')
   OR telegram_refused_chat_id::text IN ('6720291137', '6462533802')
   OR telegram_web_chat_id::text IN ('6720291137', '6462533802')
ORDER BY id;
