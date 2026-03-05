//backend/controllers/adminPaymeLabController.js

const axios = require("axios");

function basicAuth(login, key) {
  return "Basic " + Buffer.from(`${login}:${key}`).toString("base64");
}

function getBaseUrl(req) {
  // 1) явный BASE_URL (если ты хочешь жестко задать домен)
  const envBase = String(process.env.BASE_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");

  // 2) авто-определение по запросу (работает и в Railway/Proxy)
  const xfProto = req.headers["x-forwarded-proto"];
  const xfHost = req.headers["x-forwarded-host"];
  const proto = (Array.isArray(xfProto) ? xfProto[0] : xfProto) || req.protocol || "http";
  const host =
    (Array.isArray(xfHost) ? xfHost[0] : xfHost) ||
    req.get("host") ||
    "localhost:5000";

  return `${proto}://${host}`;
}

async function paymeLabRun(req, res) {
  const { method, params } = req.body || {};

  if (!method) {
    return res.status(400).json({ ok: false, message: "method required" });
  }

  try {
    const baseUrl = getBaseUrl(req);
    const url = `${baseUrl}/api/merchant/payme`;

    const rpc = {
      jsonrpc: "2.0",
      id: "lab_" + Date.now(),
      method,
      params: params || {},
    };

    const login = process.env.PAYME_MERCHANT_LOGIN_SANDBOX || process.env.PAYME_MERCHANT_LOGIN || "";
    const key = process.env.PAYME_MERCHANT_KEY_SANDBOX || process.env.PAYME_MERCHANT_KEY || "";

    const response = await axios.post(url, rpc, {
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(login, key),
      },
      timeout: 20000,
      validateStatus: () => true,
    });

    return res.json({
      ok: true,
      rpc,
      result: response.data,
      http_status: response.status,
      target_url: url,
    });
  } catch (e) {
    console.error("PaymeLab error:", e?.response?.data || e.message);

    return res.status(500).json({
      ok: false,
      error: e?.response?.data || e.message,
    });
  }
}

module.exports = { paymeLabRun };
