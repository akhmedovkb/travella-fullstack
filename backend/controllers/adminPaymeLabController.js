//backend/controllers/adminPaymeLabController.js

const pool = require("../db");
const axios = require("axios");

function basicAuth(login, key) {
  return "Basic " + Buffer.from(`${login}:${key}`).toString("base64");
}

async function paymeLabRun(req, res) {
  const { method, params } = req.body || {};

  if (!method) {
    return res.status(400).json({
      ok: false,
      message: "method required",
    });
  }

  try {
    const url = `${process.env.BASE_URL || "http://localhost:4000"}/api/merchant/payme`;

    const rpc = {
      jsonrpc: "2.0",
      id: "lab_" + Date.now(),
      method,
      params: params || {},
    };

    const response = await axios.post(url, rpc, {
      headers: {
        Authorization: basicAuth(
          process.env.PAYME_MERCHANT_LOGIN_SANDBOX || process.env.PAYME_MERCHANT_LOGIN,
          process.env.PAYME_MERCHANT_KEY_SANDBOX || process.env.PAYME_MERCHANT_KEY
        ),
      },
    });

    res.json({
      ok: true,
      rpc,
      result: response.data,
    });
  } catch (e) {
    console.error("PaymeLab error:", e?.response?.data || e.message);

    res.status(500).json({
      ok: false,
      error: e?.response?.data || e.message,
    });
  }
}

module.exports = {
  paymeLabRun,
};
