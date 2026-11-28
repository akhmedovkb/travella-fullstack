const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const seeds = require('../data/donasKnowledgeSeed.json');
const { validateVersion } = require('../utils/donasKnowledgeValidation');
const { createStore } = require('../utils/donasKnowledgeStore');
const payload = (doc, changes = {}) => ({ ...doc, expectedRevision: doc.revision, change_note: 'Test change', ...changes });

test('validates sections, bounds, statuses, approval and revision', () => {
  const valid = { ...seeds['business-concept'], expectedRevision: 1, change_note: 'Initial test' };
  assert.equal(validateVersion(valid).edition, '2.0');
  for (const changes of [
    { sections: [] }, { sections: [null] }, { status: 'production' }, { expectedRevision: 0 },
    { expectedRevision: 1.5 }, { status: 'approved' }, { title: '' }, { change_note: ' ' },
    { title: 'a'.repeat(201) }, { sections: [valid.sections[0], valid.sections[0]] },
    { sections: [{ ...valid.sections[0], content: 'a'.repeat(30001) }] },
  ]) assert.throws(() => validateVersion({ ...valid, ...changes }));
  assert.equal(validateVersion({ ...valid, status: 'approved', sections: valid.sections.map(s => ({ ...s, status: 'approved' })) }).status, 'approved');
});

test('seed content is unapproved; absent marinade quantities are explicit', () => {
  assert.equal(seeds['business-concept'].sections.length, 10);
  assert.equal(seeds['product-bible'].sections.length, 11);
  assert.equal(seeds['product-bible'].status, 'rd');
  assert.match(seeds['product-bible'].sections[2].content, /недоступны/);
  for (const seed of Object.values(seeds)) {
    assert.ok(!seed.sections.some(s => s.status === 'approved'));
    assert.ok(!JSON.stringify(seed).includes(''));
  }
});

test('PostgreSQL migration, store, history, concurrent edits and protected API', { skip: !process.env.DONAS_TEST_PGLITE && !process.env.DONAS_TEST_DATABASE_URL }, async () => {
  let pool;
  let engine;
  if (process.env.DONAS_TEST_DATABASE_URL) {
    pool = new (require('pg').Pool)({ connectionString: process.env.DONAS_TEST_DATABASE_URL });
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    engine = new PGlite();
    // Lease the single embedded PostgreSQL connection for the whole transaction.
    let queue = Promise.resolve();
    pool = {
      async connect() {
        const previous = queue;
        let release;
        queue = new Promise(resolve => { release = resolve; });
        await previous;
        return { query: (sql, params) => engine.query(sql, params), release };
      },
      async query(sql, params) {
        const client = await this.connect();
        try { return await client.query(sql, params); } finally { client.release(); }
      },
      end: () => engine.close(),
    };
  }
  let server;
  try {
    const sql = fs.readFileSync(path.join(__dirname,'../migrations/20261128_donas_knowledge.sql'),'utf8');
    const migrate = () => engine ? engine.exec(sql) : pool.query(sql);
    // Sentinels prove migration and all document actions leave operational data alone.
    await pool.query('CREATE TABLE donas_finance_test_sentinel (slug text, amount numeric)');
    await pool.query("INSERT INTO donas_finance_test_sentinel VALUES ('donas-dosas',123456.78)");
    await migrate(); await migrate();
    const store = createStore(pool);
    await assert.rejects(store.get('business-concept'), { status: 404 });
    const concept = await store.initialize('business-concept', 'tester');
    const bible = await store.initialize('product-bible', 'tester');
    assert.equal(concept.revision, 1); assert.equal(bible.edition, '1.0');
    await assert.rejects(store.initialize('business-concept', 'other'), { status: 409 });
    const changed = await store.save('business-concept', payload(concept, { title: 'Edited Concept' }), 'editor');
    assert.equal(changed.revision, 2);
    assert.equal((await store.get('business-concept', 1)).title, concept.title);
    assert.equal((await store.get('business-concept')).title, 'Edited Concept');
    await assert.rejects(store.save('business-concept', payload(concept), 'stale'), { status: 409 });
    const race = await Promise.allSettled([
      store.save('business-concept', payload(changed), 'first'),
      store.save('business-concept', payload(changed), 'second'),
    ]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(race.find(r => r.status === 'rejected').reason.status, 409);
    const latest = await store.get('business-concept');
    const approved = await store.save('business-concept', payload(latest, {
      status: 'approved', sections: latest.sections.map(s => ({ ...s, status: 'approved' })),
    }), 'approver');
    await assert.rejects(store.save('business-concept', payload(approved, { title: 'Cannot rewrite approved' }), 'editor'), { status: 409 });
    const draft = await store.save('business-concept', payload(approved, { status: 'draft' }), 'editor');
    assert.equal((await store.get('business-concept', approved.revision)).status, 'approved');
    assert.equal(draft.status, 'draft');
    // Rollback on failed revision insert must leave the head unchanged.
    const failingStore = createStore({ connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql,params) => {
        if (sql.startsWith('INSERT INTO donas_knowledge_versions')) throw new Error('Injected write failure');
        return client.query(sql,params);
      } };
    } });
    await assert.rejects(failingStore.save('business-concept', payload(draft), 'editor'), /Injected write failure/);
    assert.equal((await store.get('business-concept')).revision, draft.revision);
    await assert.rejects(pool.query("UPDATE donas_knowledge_versions SET title='tamper' WHERE revision=1"));
    await assert.rejects(pool.query('DELETE FROM donas_knowledge_versions WHERE revision=1'));
    const history = await store.history('business-concept');
    assert.equal(history[0].revision, draft.revision);
    assert.ok(history.every(v => !v.sections));
    assert.ok((await store.history('business-concept', 3)).every(v => v.revision < 3));
    assert.equal((await store.get('product-bible')).revision, 1);
    const sentinel = await pool.query('SELECT * FROM donas_finance_test_sentinel');
    assert.equal(Number(sentinel.rows[0].amount), 123456.78);
    assert.equal(sentinel.rows[0].slug, 'donas-dosas');

    const express = require('express');
    const { createRouter } = require('../routes/adminDonasKnowledgeRoutes');
    const app = express(); app.use(express.json());
    app.use('/knowledge', createRouter(store,
      (req,res,next) => req.headers['x-test-user'] ? (req.user={ id:'api-test' }, next()) : res.sendStatus(401),
      (req,res,next) => req.headers['x-test-admin'] === 'yes' ? next() : res.sendStatus(403)));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/knowledge`;
    const admin = { 'x-test-user':'1', 'x-test-admin':'yes', 'Content-Type':'application/json' };
    for (const [suffix,method] of [['business-concept','GET'],['business-concept/history','GET'],['business-concept/initialize','POST'],['business-concept/versions','POST']]) {
      assert.equal((await fetch(`${base}/${suffix}`,{method})).status,401);
      assert.equal((await fetch(`${base}/${suffix}`,{method,headers:{'x-test-user':'1'}})).status,403);
    }
    assert.equal((await fetch(`${base}/unknown`, { headers:admin })).status,404);
    assert.equal((await fetch(`${base}/business-concept?revision=abc`, { headers:admin })).status,400);
    assert.equal((await fetch(`${base}/business-concept?revision=999`, { headers:admin })).status,404);
    const loaded = await (await fetch(`${base}/business-concept`,{headers:admin})).json();
    assert.equal(loaded.document.revision,draft.revision);
    assert.equal((await fetch(`${base}/business-concept/versions`, {method:'POST',headers:admin,body:JSON.stringify(payload(draft,{ status:'invalid' }))})).status,400);
    const saved = await fetch(`${base}/business-concept/versions`, {method:'POST',headers:admin,body:JSON.stringify(payload(draft))});
    assert.equal(saved.status,201);
    assert.equal((await saved.json()).document.revision,draft.revision+1);
    assert.equal((await fetch(`${base}/business-concept/versions`, {method:'POST',headers:admin,body:JSON.stringify(payload(draft))})).status,409);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
