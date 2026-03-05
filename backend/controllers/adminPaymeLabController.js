// backend/controllers/adminPaymeLabController.js

const axios = require("axios");

function safeStr(x) {
  return String(x ?? "").trim();
}

function basicAuth(login, key) {
  return "Basic " + Buffer.from(`${login}:${key}`, "utf8").toString("base64");
}

function getPaymeCreds() {
  const mode = safeStr(process.env.PAYME_MODE).toLowerCase();

  // sandbox/test mode
  if (mode === "sandbox" || mode === "test" || mode === "dev") {
    return {
      login:
        safeStr(process.env.PAYME_MERCHANT_LOGIN_SANDBOX) ||
        safeStr(process.env.PAYME_MERCHANT_LOGIN),
      key:
        safeStr(process.env.PAYME_MERCHANT_KEY_SANDBOX) ||
        safeStr(process.env.PAYME_MERCHANT_KEY),
    };
  }

  // prod/default
  return {
    login: safeStr(process.env.PAYME_MERCHANT_LOGIN),
    key: safeStr(process.env.PAYME_MERCHANT_KEY),
  };
}

/**
 * Build Merchant RPC URL.
 *
 * Почему: в проде (Railway/Render/etc.) порт динамический, поэтому
 * "http://localhost:4000" => ECONNREFUSED.
 *
 * Приоритет:
 * 1) PAYME_MERCHANT_RPC_URL (если задан)
 * 2) self url через req.protocol + req.get('host') (нужно app.set('trust proxy', 1))
 * 3) http://127.0.0.1:${PORT}/api/merchant/payme
 */
function getMerchantRpcUrl(req) {
  const explicit = safeStr(process.env.PAYME_MERCHANT_RPC_URL);
  if (explicit) return explicit;

  const proto = safeStr(req?.protocol) || "http";
  const host = safeStr(req?.get?.("host") || req?.headers?.host);
  if (host) return `${proto}://${host}/api/merchant/payme`;

  const port = safeStr(process.env.PORT) || "4000";
  return `http://127.0.0.1:${port}/api/merchant/payme`;
}

async function paymeLabRun(req, res) {
  const { method, params } = req.body || {};
  const m = safeStr(method);

  if (!m) return res.status(400).json({ ok: false, message: "method required" });

  try {
    const rpcUrl = getMerchantRpcUrl(req);
    const { login, key } = getPaymeCreds();

    if (!login || !key) {
      return res.status(500).json({
        ok: false,
        message: "PAYME merchant credentials missing (PAYME_MERCHANT_LOGIN/KEY)",
      });
    }

    const rpc = {
      jsonrpc: "2.0",
      id: `lab_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      method: m,
      params: params || {},
    };

    const response = await axios.post(rpcUrl, rpc, {
      timeout: 20000,
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(login, key),
      },
      // на всякий случай: даже если вернется не-2xx, мы покажем payload
      validateStatus: () => true,
    });

    return res.json({
      ok: true,
      rpc,
      result: response.data,
      http_status: response.status,
      rpc_url: rpcUrl,
    });
  } catch (e) {
    // НЕ логируем Authorization
    console.error("[payme-lab] run error:", e?.code || "", e?.message || e);
    if (e?.response?.data) console.error("[payme-lab] response:", e.response.data);

    return res.status(500).json({
      ok: false,
      error: e?.response?.data || e?.message || String(e),
    });
  }
}

module.exports = { paymeLabRun };
