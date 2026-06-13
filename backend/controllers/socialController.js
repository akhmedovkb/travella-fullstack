// backend/controllers/socialController.js
/* eslint-disable no-console */

const pool = require("../db");
const { uploadBufferToR2 } = require("../utils/r2Upload");

let ready = false;

function roleOf(req) {
  return String(req?.user?.role || req?.user?.type || "").toLowerCase();
}
function isProvider(req) {
  const role = roleOf(req);
  return role === "provider" || role === "supplier" || role === "agency" || role === "tour_agent" || role === "hotel" || req?.user?.is_admin;
}
function isClient(req) {
  const role = roleOf(req);
  return role === "client" || role === "user";
}
function viewer(req) {
  const id = Number(req?.user?.id);
  if (!Number.isFinite(id)) return { role: "guest", id: null };
  return { role: isClient(req) ? "client" : "provider", id };
}
function cleanText(v, max = 4000) {
  return String(v || "").replace(/\u0000/g, "").trim().slice(0, max);
}
function cleanType(v) {
  const t = cleanText(v, 40).toLowerCase();
  return ["post", "offer", "news", "review", "photo", "video", "article"].includes(t) ? t : "post";
}
async function ensureSocialTables() {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_posts (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'post',
      title TEXT,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'published',
      visibility TEXT NOT NULL DEFAULT 'public',
      country TEXT,
      city TEXT,
      service_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_post_media (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES provider_posts(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL DEFAULT 'photo',
      url TEXT NOT NULL,
      key TEXT,
      thumbnail_url TEXT,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_follows (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, provider_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_post_likes (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES provider_posts(id) ON DELETE CASCADE,
      actor_role TEXT NOT NULL,
      actor_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (post_id, actor_role, actor_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_post_comments (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES provider_posts(id) ON DELETE CASCADE,
      actor_role TEXT NOT NULL,
      actor_id BIGINT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_posts_provider_created ON provider_posts(provider_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_posts_feed ON provider_posts(status, visibility, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_follows_client ON provider_follows(client_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_provider_post_comments_post ON provider_post_comments(post_id, created_at DESC)`);
  ready = true;
}

async function decoratePosts(rows, req) {
  const ids = rows.map((r) => Number(r.id)).filter(Boolean);
  if (!ids.length) return [];
  const v = viewer(req);
  const [mediaQ, likesQ, commentsQ, likedQ] = await Promise.all([
    pool.query(`SELECT post_id, media_type, url, key, thumbnail_url, sort_order FROM provider_post_media WHERE post_id = ANY($1::bigint[]) ORDER BY sort_order ASC, id ASC`, [ids]),
    pool.query(`SELECT post_id, COUNT(*)::int AS c FROM provider_post_likes WHERE post_id = ANY($1::bigint[]) GROUP BY post_id`, [ids]),
    pool.query(`SELECT post_id, COUNT(*)::int AS c FROM provider_post_comments WHERE post_id = ANY($1::bigint[]) AND status='published' GROUP BY post_id`, [ids]),
    v.id ? pool.query(`SELECT post_id FROM provider_post_likes WHERE post_id = ANY($1::bigint[]) AND actor_role=$2 AND actor_id=$3`, [ids, v.role, v.id]) : Promise.resolve({ rows: [] }),
  ]);
  const mediaBy = new Map();
  for (const m of mediaQ.rows) {
    const arr = mediaBy.get(Number(m.post_id)) || [];
    arr.push(m);
    mediaBy.set(Number(m.post_id), arr);
  }
  const likesBy = new Map(likesQ.rows.map((x) => [Number(x.post_id), Number(x.c)]));
  const commentsBy = new Map(commentsQ.rows.map((x) => [Number(x.post_id), Number(x.c)]));
  const liked = new Set(likedQ.rows.map((x) => Number(x.post_id)));
  return rows.map((r) => ({
    ...r,
    media: mediaBy.get(Number(r.id)) || [],
    likes_count: likesBy.get(Number(r.id)) || 0,
    comments_count: commentsBy.get(Number(r.id)) || 0,
    liked_by_me: liked.has(Number(r.id)),
  }));
}

function providerSelect(alias = "p") {
  // через to_jsonb(p), чтобы не падать на разных версиях таблицы providers,
  // если какого-то декоративного поля (avatar_url/logo_url/city) нет.
  return `jsonb_build_object(
    'id', ${alias}.id,
    'name', COALESCE(NULLIF(to_jsonb(${alias})->>'company_name',''), NULLIF(to_jsonb(${alias})->>'name',''), NULLIF(to_jsonb(${alias})->>'full_name',''), 'Provider #' || ${alias}.id::text),
    'company_name', to_jsonb(${alias})->>'company_name',
    'photo', COALESCE(to_jsonb(${alias})->>'photo', to_jsonb(${alias})->>'avatar_url', to_jsonb(${alias})->>'logo_url'),
    'telegram', COALESCE(to_jsonb(${alias})->>'telegram', to_jsonb(${alias})->>'telegram_username'),
    'location', COALESCE(to_jsonb(${alias})->>'location', to_jsonb(${alias})->>'city', to_jsonb(${alias})->>'country')
  )`;
}

async function listFeed(req, res) {
  try {
    await ensureSocialTables();
    const limit = Math.min(40, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const type = cleanText(req.query.type, 40).toLowerCase();
    const followedOnly = String(req.query.following || "") === "1";
    const v = viewer(req);
    const params = [];
    const where = [`pp.status='published'`, `pp.visibility='public'`];
    let joinFollow = "";
    if (type) { params.push(type); where.push(`pp.type=$${params.length}`); }
    if (followedOnly && v.role === "client" && v.id) {
      params.push(v.id); joinFollow = `JOIN provider_follows pf ON pf.provider_id=pp.provider_id AND pf.client_id=$${params.length}`;
    }
    params.push(limit, offset);
    const q = await pool.query(`
      SELECT pp.*, ${providerSelect("p")} AS provider
      FROM provider_posts pp
      JOIN providers p ON p.id=pp.provider_id
      ${joinFollow}
      WHERE ${where.join(" AND ")}
      ORDER BY pp.created_at DESC, pp.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return res.json({ items: await decoratePosts(q.rows, req), limit, offset });
  } catch (e) {
    console.error("social.listFeed error:", e);
    return res.status(500).json({ error: "feed_failed" });
  }
}

async function listProviderPosts(req, res) {
  try {
    await ensureSocialTables();
    const providerId = Number(req.params.providerId || req.user?.id);
    if (!Number.isFinite(providerId)) return res.status(400).json({ error: "bad_provider_id" });
    const isOwner = Number(req.user?.id) === providerId && isProvider(req);
    const where = [`pp.provider_id=$1`];
    if (!isOwner && !req.user?.is_admin) where.push(`pp.status='published' AND pp.visibility='public'`);
    const q = await pool.query(`
      SELECT pp.*, ${providerSelect("p")} AS provider
      FROM provider_posts pp JOIN providers p ON p.id=pp.provider_id
      WHERE ${where.join(" AND ")}
      ORDER BY pp.created_at DESC, pp.id DESC LIMIT 80
    `, [providerId]);
    return res.json({ items: await decoratePosts(q.rows, req) });
  } catch (e) {
    console.error("social.listProviderPosts error:", e);
    return res.status(500).json({ error: "provider_posts_failed" });
  }
}

async function createPost(req, res) {
  const client = await pool.connect();
  try {
    await ensureSocialTables();
    if (!isProvider(req)) return res.status(403).json({ error: "provider_only" });
    const providerId = Number(req.user.id);
    const title = cleanText(req.body.title, 160);
    const body = cleanText(req.body.body || req.body.text, 6000);
    if (!body && !title && !(req.files || []).length) return res.status(400).json({ error: "empty_post" });
    const type = cleanType(req.body.type);
    await client.query("BEGIN");
    const ins = await client.query(`
      INSERT INTO provider_posts(provider_id,type,title,body,country,city,service_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [providerId, type, title || null, body || "", cleanText(req.body.country, 80) || null, cleanText(req.body.city, 80) || null, Number(req.body.service_id) || null]);
    const post = ins.rows[0];
    const files = Array.isArray(req.files) ? req.files.slice(0, 10) : [];
    let order = 0;
    for (const file of files) {
      const uploaded = await uploadBufferToR2(file, { folder: "travella-social/posts", public_prefix: `provider-${providerId}` });
      await client.query(`INSERT INTO provider_post_media(post_id,media_type,url,key,thumbnail_url,sort_order) VALUES($1,$2,$3,$4,$5,$6)`, [post.id, uploaded.media_type || "photo", uploaded.url, uploaded.key, uploaded.thumbnail_url || uploaded.url, order++]);
    }
    await client.query("COMMIT");
    const rows = await decoratePosts([post], req);
    return res.status(201).json(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("social.createPost error:", e);
    return res.status(500).json({ error: e.code || "create_post_failed", message: e.message });
  } finally {
    client.release();
  }
}

async function deletePost(req, res) {
  try {
    await ensureSocialTables();
    const id = Number(req.params.id);
    const providerId = Number(req.user?.id);
    if (!Number.isFinite(id) || !Number.isFinite(providerId)) return res.status(400).json({ error: "bad_id" });
    const q = await pool.query(`UPDATE provider_posts SET status='deleted', updated_at=NOW() WHERE id=$1 AND (provider_id=$2 OR $3::boolean=true) RETURNING id`, [id, providerId, !!req.user?.is_admin]);
    if (!q.rowCount) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("social.deletePost error:", e);
    return res.status(500).json({ error: "delete_post_failed" });
  }
}

async function toggleFollow(req, res) {
  try {
    await ensureSocialTables();
    if (!isClient(req)) return res.status(403).json({ error: "client_only" });
    const clientId = Number(req.user.id);
    const providerId = Number(req.params.providerId);
    if (!Number.isFinite(providerId)) return res.status(400).json({ error: "bad_provider_id" });
    const exists = await pool.query(`SELECT id FROM provider_follows WHERE client_id=$1 AND provider_id=$2`, [clientId, providerId]);
    if (exists.rowCount) {
      await pool.query(`DELETE FROM provider_follows WHERE client_id=$1 AND provider_id=$2`, [clientId, providerId]);
      return res.json({ following: false });
    }
    await pool.query(`INSERT INTO provider_follows(client_id,provider_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [clientId, providerId]);
    return res.json({ following: true });
  } catch (e) {
    console.error("social.toggleFollow error:", e);
    return res.status(500).json({ error: "follow_failed" });
  }
}

async function followStatus(req, res) {
  try {
    await ensureSocialTables();
    const providerId = Number(req.params.providerId);
    const clientId = isClient(req) ? Number(req.user.id) : null;
    const followers = await pool.query(`SELECT COUNT(*)::int AS c FROM provider_follows WHERE provider_id=$1`, [providerId]);
    let following = false;
    if (clientId) {
      const q = await pool.query(`SELECT 1 FROM provider_follows WHERE client_id=$1 AND provider_id=$2`, [clientId, providerId]);
      following = q.rowCount > 0;
    }
    return res.json({ following, followers_count: Number(followers.rows[0]?.c || 0) });
  } catch (e) {
    console.error("social.followStatus error:", e);
    return res.status(500).json({ error: "follow_status_failed" });
  }
}

async function toggleLike(req, res) {
  try {
    await ensureSocialTables();
    const postId = Number(req.params.id);
    const v = viewer(req);
    if (!v.id) return res.status(401).json({ error: "auth_required" });
    const exists = await pool.query(`SELECT id FROM provider_post_likes WHERE post_id=$1 AND actor_role=$2 AND actor_id=$3`, [postId, v.role, v.id]);
    if (exists.rowCount) await pool.query(`DELETE FROM provider_post_likes WHERE post_id=$1 AND actor_role=$2 AND actor_id=$3`, [postId, v.role, v.id]);
    else await pool.query(`INSERT INTO provider_post_likes(post_id,actor_role,actor_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [postId, v.role, v.id]);
    const c = await pool.query(`SELECT COUNT(*)::int AS c FROM provider_post_likes WHERE post_id=$1`, [postId]);
    return res.json({ liked: !exists.rowCount, likes_count: Number(c.rows[0]?.c || 0) });
  } catch (e) {
    console.error("social.toggleLike error:", e);
    return res.status(500).json({ error: "like_failed" });
  }
}

async function listComments(req, res) {
  try {
    await ensureSocialTables();
    const postId = Number(req.params.id);
    const q = await pool.query(`SELECT * FROM provider_post_comments WHERE post_id=$1 AND status='published' ORDER BY created_at ASC, id ASC LIMIT 100`, [postId]);
    return res.json({ items: q.rows });
  } catch (e) {
    console.error("social.listComments error:", e);
    return res.status(500).json({ error: "comments_failed" });
  }
}

async function createComment(req, res) {
  try {
    await ensureSocialTables();
    const postId = Number(req.params.id);
    const v = viewer(req);
    if (!v.id) return res.status(401).json({ error: "auth_required" });
    const body = cleanText(req.body.body || req.body.text, 1200);
    if (!body) return res.status(400).json({ error: "empty_comment" });
    const q = await pool.query(`INSERT INTO provider_post_comments(post_id,actor_role,actor_id,body) VALUES($1,$2,$3,$4) RETURNING *`, [postId, v.role, v.id, body]);
    return res.status(201).json(q.rows[0]);
  } catch (e) {
    console.error("social.createComment error:", e);
    return res.status(500).json({ error: "comment_failed" });
  }
}

module.exports = { listFeed, listProviderPosts, createPost, deletePost, toggleFollow, followStatus, toggleLike, listComments, createComment };
