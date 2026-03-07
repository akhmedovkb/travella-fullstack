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

  return {
    login: safeStr(process.env.PAYME_MERCHANT_LOGIN),
    key: safeStr(process.env.PAYME_MERCHANT_KEY),
  };
}

function getMerchantRpcUrl(req) {
  const explicit = safeStr(process.env.PAYME_MERCHANT_RPC_URL);
  if (explicit) return explicit;

  const proto = safeStr(req?.protocol) || "http";
  const host = safeStr(req?.get?.("host") || req?.headers?.host);
  if (host) return `${proto}://${host}/api/merchant/payme`;

  const port = safeStr(process.env.PORT) || "4000";
  return `http://127.0.0.1:${port}/api/merchant/payme`;
}

function normalizeRpcBody(body) {
  const method = safeStr(body?.method);
  const params = body?.params && typeof body.params === "object" ? body.params : {};

  const jsonrpc =
    body?.jsonrpc === "2.0"
      ? "2.0"
      : "2.0";

  const id =
    body?.id !== undefined && body?.id !== null && body?.id !== ""
      ? body.id
      : `lab_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return {
    jsonrpc,
    id,
    method,
    params,
  };
}

async function paymeLabRun(req, res) {
  const rpc = normalizeRpcBody(req.body || {});
  const m = safeStr(rpc.method);

  if (!m) {
    return res.status(400).json({
      ok: false,
      message: "method required",
    });
  }

  try {
    const rpcUrl = getMerchantRpcUrl(req);
    const { login, key } = getPaymeCreds();

    if (!login || !key) {
      return res.status(500).json({
        ok: false,
        message: "PAYME merchant credentials missing (PAYME_MERCHANT_LOGIN/KEY)",
      });
    }

    const response = await axios.post(rpcUrl, rpc, {
      timeout: 20000,
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(login, key),
      },
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
    console.error("[payme-lab] run error:", e?.code || "", e?.message || e);
    if (e?.response?.data) {
      console.error("[payme-lab] response:", e.response.data);
    }

    return res.status(500).json({
      ok: false,
      error: e?.response?.data || e?.message || String(e),
    });
  }
}

module.exports = { paymeLabRun };
