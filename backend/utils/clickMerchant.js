// backend/utils/clickMerchant.js
const crypto = require("crypto");
const axios = require("axios");
const { unlockContactSafe } = require("./contactUnlock");

const CLICK_API_BASE = (process.env.CLICK_API_BASE || "https://api.click.uz/v2/merchant").replace(/\/+$/, "");
const CLICK_SERVICE_ID = String(process.env.CLICK_SERVICE_ID || process.env.CLICK_BOT_SERVICE_ID || "").trim();
const CLICK_MERCHANT_ID = String(process.env.CLICK_MERCHANT_ID || process.env.CLICK_BOT_MERCHANT_ID || "").trim();
const CLICK_MERCHANT_USER_ID = String(process.env.CLICK_MERCHANT_USER_ID || process.env.CLICK_BOT_MERCHANT_USER_ID || "").trim();
const CLICK_SECRET_KEY = String(process.env.CLICK_SECRET_KEY || process.env.CLICK_BOT_SECRET_KEY || "").trim();
const TELEGRAM_CLIENT_BOT_TOKEN = String(process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();

function isClickConfigured() {
  return !!(CLICK_SERVICE_ID && CLICK_MERCHANT_USER_ID && CLICK_SECRET_KEY);
}

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function md5(s) {
  return crypto.createHash("md5").update(String(s)).digest("hex");
}

function clickAuthHeader() {
  const ts = Math.floor(Date.now() / 1000);
  return `${CLICK_MERCHANT_USER_ID}:${sha1(`${ts}${CLICK_SECRET_KEY}`)}:${ts}`;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 9) return `998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return digits;
  if (digits.length === 13 && digits.startsWith("998")) return digits.slice(0, 12);
  return digits;
}

function toAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function minorFromSum(amountSum) {
  return Math.round(toAmount(amountSum) * 100);
}

async function ensureClickTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS click_orders (
      id BIGSERIAL PRIMARY KEY,
      merchant_trans_id TEXT NOT NULL UNIQUE,
      click_invoice_id BIGINT,
      click_trans_id BIGINT,
      click_paydoc_id BIGINT,
      merchant_prepare_id BIGINT,
      order_type TEXT NOT NULL,
      actor_role TEXT,
      actor_id BIGINT,
      telegram_chat_id BIGINT,
      service_id BIGINT,
      donation_id BIGINT,
      amount_sum NUMERIC(14,2) NOT NULL DEFAULT 0,
      amount_tiyin BIGINT NOT NULL DEFAULT 0,
      phone_number TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      error_code INTEGER,
      error_note TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      prepared_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`ALTER TABLE click_orders ADD COLUMN IF NOT EXISTS click_invoice_id BIGINT`);
  await db.query(`ALTER TABLE click_orders ADD COLUMN IF NOT EXISTS click_trans_id BIGINT`);
  await db.query(`ALTER TABLE click_orders ADD COLUMN IF NOT EXISTS click_paydoc_id BIGINT`);
  await db.query(`ALTER TABLE click_orders ADD COLUMN IF NOT EXISTS merchant_prepare_id BIGINT`);
  await db.query(`ALTER TABLE click_orders ADD COLUMN IF NOT EXISTS donation_id BIGINT`);
  await db.query(`ALTER TABLE click_orders ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_click_orders_status ON click_orders(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_click_orders_actor ON click_orders(actor_role, actor_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_click_orders_service ON click_orders(service_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_click_orders_invoice ON click_orders(click_invoice_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS click_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      action INTEGER,
      stage TEXT,
      merchant_trans_id TEXT,
      click_trans_id BIGINT,
      click_paydoc_id BIGINT,
      error INTEGER,
      error_note TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_click_events_mti ON click_events(merchant_trans_id)`);
}

async function createClickInvoice(order) {
  if (!isClickConfigured()) {
    const e = new Error("CLICK_NOT_CONFIGURED");
    e.status = 500;
    throw e;
  }

  const amount = toAmount(order.amountSum);
  const phone = normalizePhone(order.phoneNumber);
  if (!amount || amount <= 0) {
    const e = new Error("BAD_CLICK_AMOUNT");
    e.status = 400;
    throw e;
  }
  if (!phone) {
    const e = new Error("CLICK_PHONE_REQUIRED");
    e.status = 400;
    throw e;
  }

  const body = {
    service_id: Number(CLICK_SERVICE_ID),
    amount,
    phone_number: phone,
    merchant_trans_id: String(order.merchantTransId),
  };

  const { data } = await axios.post(`${CLICK_API_BASE}/invoice/create`, body, {
    timeout: 20000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Auth: clickAuthHeader(),
    },
  });

  const errorCode = Number(data?.error_code ?? 0);
  if (errorCode !== 0) {
    const e = new Error(data?.error_note || `CLICK_ERROR_${errorCode}`);
    e.status = 502;
    e.click = data;
    throw e;
  }

  return data;
}

async function createClickOrderAndInvoice(db, payload) {
  await ensureClickTables(db);

  const amount = toAmount(payload.amountSum);
  const amountTiyin = minorFromSum(amount);
  const mti = String(payload.merchantTransId || `travella-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const phone = normalizePhone(payload.phoneNumber);

  const inserted = await db.query(
    `
    INSERT INTO click_orders (
      merchant_trans_id, order_type, actor_role, actor_id, telegram_chat_id,
      service_id, donation_id, amount_sum, amount_tiyin, phone_number, status, meta, expires_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created',$11::jsonb,NOW() + INTERVAL '45 minutes')
    ON CONFLICT (merchant_trans_id) DO UPDATE
      SET updated_at=NOW()
    RETURNING *
    `,
    [
      mti,
      String(payload.orderType),
      payload.actorRole || null,
      payload.actorId || null,
      payload.telegramChatId || null,
      payload.serviceId || null,
      payload.donationId || null,
      amount,
      amountTiyin,
      phone,
      JSON.stringify(payload.meta || {}),
    ]
  );

  const invoice = await createClickInvoice({ merchantTransId: mti, amountSum: amount, phoneNumber: phone });
  const invoiceId = Number(invoice?.invoice_id || 0) || null;

  const updated = await db.query(
    `
    UPDATE click_orders
       SET click_invoice_id=$2,
           status='invoice_created',
           error_code=0,
           error_note=NULL,
           updated_at=NOW()
     WHERE merchant_trans_id=$1
     RETURNING *
    `,
    [mti, invoiceId]
  );

  return { ok: true, order: updated.rows[0] || inserted.rows[0], invoice };
}

function verifyClickSign(params, action) {
  const clickTransId = String(params.click_trans_id || "");
  const serviceId = String(params.service_id || "");
  const merchantTransId = String(params.merchant_trans_id || "");
  const amount = String(params.amount || "");
  const signTime = String(params.sign_time || "");
  const signString = String(params.sign_string || "").toLowerCase();

  let base;
  if (Number(action) === 0) {
    base = `${clickTransId}${serviceId}${CLICK_SECRET_KEY}${merchantTransId}${amount}${action}${signTime}`;
  } else {
    const merchantPrepareId = String(params.merchant_prepare_id || "");
    base = `${clickTransId}${serviceId}${CLICK_SECRET_KEY}${merchantTransId}${merchantPrepareId}${amount}${action}${signTime}`;
  }

  return md5(base).toLowerCase() === signString;
}

function clickResponse(base, error = 0, note = "Success") {
  return {
    click_trans_id: Number(base.click_trans_id || 0),
    merchant_trans_id: String(base.merchant_trans_id || ""),
    error,
    error_note: note,
  };
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  if (!TELEGRAM_CLIENT_BOT_TOKEN || !chatId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_CLIENT_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: extra.parse_mode || "HTML",
      disable_web_page_preview: true,
      reply_markup: extra.reply_markup,
    }, { timeout: 15000 });
    return true;
  } catch (e) {
    console.warn("[click] telegram notify failed:", e?.message || e);
    return false;
  }
}

async function applyClickSuccessEffect(db, order) {
  const orderType = String(order.order_type || "");
  const chatId = order.telegram_chat_id ? Number(order.telegram_chat_id) : null;
  const amountSum = Number(order.amount_sum || 0);

  if (orderType === "support_project") {
    if (order.donation_id) {
      await db.query(
        `
        UPDATE provider_support_donations
           SET status='paid',
               paid_at=COALESCE(paid_at, NOW()),
               updated_at=NOW(),
               payme_id=COALESCE(NULLIF(payme_id,''), $2),
               source='click_invoice',
               note=COALESCE(NULLIF(note,''), 'click_invoice')
         WHERE id=$1
        `,
        [order.donation_id, String(order.click_trans_id || order.click_paydoc_id || order.click_invoice_id || "")]
      );
    } else {
      await db.query(
        `
        INSERT INTO provider_support_donations (
          provider_id, telegram_chat_id, service_id, amount_tiyin,
          payme_id, status, source, note, paid_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,'paid','click_invoice','click_invoice',NOW(),NOW())
        `,
        [order.actor_id || null, chatId, order.service_id || null, order.amount_tiyin, String(order.click_trans_id || order.click_paydoc_id || order.click_invoice_id || "")]
      );
    }

    await sendTelegramMessage(chatId, `✅ Оплата поддержки проекта получена. Спасибо!\n\nСумма: <b>${amountSum.toLocaleString("ru-RU")} сум</b>`);
    return;
  }

  if (orderType === "unlock_contact") {
    const result = await unlockContactSafe({
      db,
      clientId: order.actor_id,
      serviceId: order.service_id,
      price: amountSum,
      source: "click_invoice",
      skipBalanceDeduction: true,
      note: `Click invoice ${order.click_invoice_id || order.merchant_trans_id}`,
    });

    await sendTelegramMessage(chatId, result?.alreadyUnlocked
      ? "✅ Контакты уже были открыты. Откройте карточку услуги повторно."
      : "✅ Оплата получена. Контакты поставщика открыты. Откройте карточку услуги повторно, чтобы увидеть контакты.");
  }
}

async function handleClickCallback(db, raw) {
  await ensureClickTables(db);
  const params = raw || {};
  const action = Number(params.action);
  const merchantTransId = String(params.merchant_trans_id || "");

  await db.query(
    `INSERT INTO click_events (action, stage, merchant_trans_id, click_trans_id, click_paydoc_id, error, error_note, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [action, action === 0 ? "prepare" : action === 1 ? "complete" : "unknown", merchantTransId, params.click_trans_id || null, params.click_paydoc_id || null, params.error || null, params.error_note || null, JSON.stringify(params)]
  );

  if (![0, 1].includes(action)) return { ...clickResponse(params, -3, "Action not found") };
  if (!merchantTransId) return { ...clickResponse(params, -5, "User does not exist") };
  if (String(params.service_id || "") !== String(CLICK_SERVICE_ID)) return { ...clickResponse(params, -2, "Service not found") };
  if (!verifyClickSign(params, action)) return { ...clickResponse(params, -1, "SIGN CHECK FAILED") };

  const orderQ = await db.query(`SELECT * FROM click_orders WHERE merchant_trans_id=$1 FOR UPDATE`, [merchantTransId]);
  const order = orderQ.rows[0];
  if (!order) return { ...clickResponse(params, -5, "User does not exist") };

  const callbackAmount = toAmount(params.amount);
  if (toAmount(order.amount_sum) !== callbackAmount) return { ...clickResponse(params, -2, "Incorrect parameter amount") };

  if (action === 0) {
    if (Number(params.error || 0) !== 0) {
      await db.query(`UPDATE click_orders SET status='prepare_error', error_code=$2, error_note=$3, updated_at=NOW() WHERE id=$1`, [order.id, params.error || null, params.error_note || null]);
      return { ...clickResponse(params, -9, "Transaction cancelled") };
    }

    const prepareId = Number(order.id);
    await db.query(
      `UPDATE click_orders
          SET status=CASE WHEN status='paid' THEN status ELSE 'prepared' END,
              click_trans_id=$2,
              click_paydoc_id=$3,
              merchant_prepare_id=$4,
              prepared_at=COALESCE(prepared_at,NOW()),
              updated_at=NOW()
        WHERE id=$1`,
      [order.id, params.click_trans_id || null, params.click_paydoc_id || null, prepareId]
    );

    return { ...clickResponse(params, 0, "Success"), merchant_prepare_id: prepareId };
  }

  const merchantPrepareId = Number(params.merchant_prepare_id || 0);
  if (merchantPrepareId !== Number(order.id)) return { ...clickResponse(params, -6, "Transaction not found") };

  if (String(order.status || "") === "paid") {
    return { ...clickResponse(params, 0, "Success"), merchant_confirm_id: Number(order.id) };
  }

  if (Number(params.error || 0) !== 0) {
    await db.query(
      `UPDATE click_orders SET status='cancelled', error_code=$2, error_note=$3, cancelled_at=COALESCE(cancelled_at,NOW()), updated_at=NOW() WHERE id=$1`,
      [order.id, params.error || null, params.error_note || null]
    );
    return { ...clickResponse(params, -9, "Transaction cancelled") };
  }

  await db.query("BEGIN");
  try {
    const paidQ = await db.query(
      `UPDATE click_orders
          SET status='paid',
              click_trans_id=$2,
              click_paydoc_id=$3,
              merchant_prepare_id=$4,
              paid_at=COALESCE(paid_at,NOW()),
              updated_at=NOW(),
              error_code=0,
              error_note=NULL
        WHERE id=$1
        RETURNING *`,
      [order.id, params.click_trans_id || null, params.click_paydoc_id || null, merchantPrepareId]
    );
    await applyClickSuccessEffect(db, paidQ.rows[0]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }

  return { ...clickResponse(params, 0, "Success"), merchant_confirm_id: Number(order.id) };
}

module.exports = {
  isClickConfigured,
  normalizePhone,
  ensureClickTables,
  createClickOrderAndInvoice,
  handleClickCallback,
};
