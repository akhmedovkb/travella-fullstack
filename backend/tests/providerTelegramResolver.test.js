"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROVIDER_TELEGRAM_ID_AMBIGUOUS,
  resolveProviderByTelegramActorId,
} = require("../utils/providerTelegramResolver");

function fakeDb(providers) {
  return {
    async query(sql, params) {
      const actorId = String(params[0]);
      const includesWeb = sql.includes("telegram_web_chat_id");
      const fields = [
        "telegram_refused_chat_id",
        "telegram_chat_id",
        "tg_chat_id",
        ...(includesWeb ? ["telegram_web_chat_id"] : []),
      ];
      const rows = [];
      for (const provider of providers) {
        for (const field of fields) {
          if (String(provider[field] ?? "") === actorId) {
            rows.push({ id: provider.id, field_name: field });
          }
        }
      }
      return { rows, rowCount: rows.length };
    },
  };
}

const fixture = [
  {
    id: 1430,
    telegram_chat_id: "6462533802",
    tg_chat_id: "6462533802",
    telegram_web_chat_id: "6720291137",
    telegram_refused_chat_id: "6462533802",
  },
  {
    id: 1468,
    telegram_chat_id: "6720291137",
    tg_chat_id: "6720291137",
    telegram_web_chat_id: "6720291137",
    telegram_refused_chat_id: "6720291137",
  },
];

test("web chat collision does not override the Telegram bot actor", async () => {
  const resolved = await resolveProviderByTelegramActorId(fakeDb(fixture), "6720291137", {
    log: false,
  });
  assert.equal(resolved.id, 1468);
  assert.equal(resolved.matchedField, "telegram_refused_chat_id");
});

test("duplicate primary bot ID fails instead of choosing LIMIT 1", async () => {
  const db = fakeDb([
    ...fixture,
    { id: 1500, telegram_chat_id: "6720291137" },
  ]);
  await assert.rejects(
    resolveProviderByTelegramActorId(db, "6720291137", { log: false }),
    (error) => error.code === PROVIDER_TELEGRAM_ID_AMBIGUOUS
  );
});

test("the original provider bot actor resolves to provider 1430", async () => {
  const resolved = await resolveProviderByTelegramActorId(fakeDb(fixture), "6462533802", {
    log: false,
  });
  assert.equal(resolved.id, 1430);
});

test("draft, service, proof and moderation keep one resolved provider ID", async () => {
  const db = fakeDb(fixture);
  const stages = ["draft", "service", "proof", "moderation"];
  const providerIds = [];
  for (const action of stages) {
    const resolved = await resolveProviderByTelegramActorId(db, "6720291137", {
      action,
      log: false,
    });
    providerIds.push(resolved.id);
  }
  assert.deepEqual(providerIds, [1468, 1468, 1468, 1468]);
});
