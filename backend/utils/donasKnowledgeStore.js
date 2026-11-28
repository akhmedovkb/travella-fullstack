const seeds = require('../data/donasKnowledgeSeed.json');
const { invalid, validateVersion } = require('./donasKnowledgeValidation');
const SLUG = 'donas-dosas';
function createStore(pool) {
  async function transaction(run) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async function head(client, kind, lock = false) {
    const { rows } = await client.query(`SELECT * FROM donas_knowledge_documents
      WHERE slug=$1 AND kind=$2${lock ? ' FOR UPDATE' : ''}`, [SLUG, kind]);
    if (!rows[0]) throw invalid('Документ ещё не создан', 404);
    return rows[0];
  }
  async function insert(client, doc, version, actor) {
    const revision = doc.current_revision + 1;
    const { rows } = await client.query(`INSERT INTO donas_knowledge_versions
      (document_id, revision, edition, title, status, sections, change_note, actor_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
    [doc.id, revision, version.edition, version.title, version.status, JSON.stringify(version.sections), version.change_note, String(actor)]);
    await client.query('UPDATE donas_knowledge_documents SET current_revision=$1 WHERE id=$2', [revision, doc.id]);
    return rows[0];
  }
  return {
    async initialize(kind, actor) {
      return transaction(async client => {
        await client.query(`INSERT INTO donas_knowledge_documents (slug,kind) VALUES ($1,$2)
          ON CONFLICT (slug,kind) DO NOTHING`, [SLUG,kind]);
        const doc = await head(client, kind, true);
        if (doc.current_revision) throw invalid('Документ уже создан', 409);
        return insert(client, doc, { ...seeds[kind], change_note: 'Начальное содержание из обсуждения 28.11.2026; гипотезы требуют проверки.' }, actor);
      });
    },
    async get(kind, revision) {
      // One statement gives a consistent head and version during concurrent saves.
      const { rows } = await pool.query(`SELECT v.* FROM donas_knowledge_documents d
        JOIN donas_knowledge_versions v ON v.document_id=d.id
        AND v.revision=COALESCE($3::integer,d.current_revision)
        WHERE d.slug=$1 AND d.kind=$2`, [SLUG,kind,revision ?? null]);
      if (!rows[0]) throw invalid('Документ или ревизия не найдены', 404);
      return rows[0];
    },
    async history(kind, before) {
      const { rows } = await pool.query(`SELECT v.revision,v.edition,v.title,v.status,v.change_note,v.actor_id,v.created_at
        FROM donas_knowledge_versions v JOIN donas_knowledge_documents d ON d.id=v.document_id
        WHERE d.slug=$1 AND d.kind=$2 AND ($3::integer IS NULL OR v.revision<$3)
        ORDER BY v.revision DESC LIMIT 50`, [SLUG,kind,before ?? null]);
      return rows;
    },
    async save(kind, body, actor) {
      const version = validateVersion(body);
      return transaction(async client => {
        const doc = await head(client, kind, true);
        if (doc.current_revision !== version.expectedRevision) throw invalid('Документ изменён другим пользователем. Загрузите актуальную ревизию.', 409);
        const { rows } = await client.query('SELECT * FROM donas_knowledge_versions WHERE document_id=$1 AND revision=$2', [doc.id,doc.current_revision]);
        if (rows[0].status === 'approved' && version.status !== 'draft') throw invalid('Для изменения утверждённого документа сначала создайте черновик', 409);
        return insert(client, doc, version, actor);
      });
    },
  };
}
module.exports = { createStore };
