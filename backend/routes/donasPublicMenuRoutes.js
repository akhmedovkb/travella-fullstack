// backend/routes/donasPublicMenuRoutes.js

const express = require("express");
const pool = require("../db");
const PDFDocument = require("pdfkit");

const router = express.Router();

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function money(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}
function moneySpaced(n) {
  const v = Math.round(toNum(n));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function calcPpu(ing) {
  const packSize = toNum(ing.pack_size);
  const packPrice = toNum(ing.pack_price);
  if (!packSize) return 0;
  return packPrice / packSize;
}

async function fetchMenuData() {
  const menuR = await pool.query(
    `SELECT id, name, category, is_active, price, sell_price, description
     FROM donas_menu_items
     WHERE is_active = TRUE
     ORDER BY category NULLS LAST, name ASC`
  );

  const ingR = await pool.query(
    `SELECT id, name, unit, pack_size, pack_price, is_active
     FROM donas_ingredients
     WHERE is_active = TRUE`
  );

  const compR = await pool.query(
    `SELECT id, menu_item_id, ingredient_id, qty, unit
     FROM donas_menu_item_components
     ORDER BY menu_item_id ASC, id ASC`
  );

  const ingredientsById = new Map(ingR.rows.map((x) => [Number(x.id), x]));
  const recipeByItem = new Map();
  for (const row of compR.rows) {
    const key = Number(row.menu_item_id);
    if (!recipeByItem.has(key)) recipeByItem.set(key, []);
    recipeByItem.get(key).push(row);
  }

  const items = menuR.rows.map((mi) => {
    const price = toNum(mi.sell_price ?? mi.price ?? 0);
    const recipe = recipeByItem.get(Number(mi.id)) || [];

    let cogs = 0;
    let hasAnyValid = false;

    for (const r of recipe) {
      const ing = ingredientsById.get(Number(r.ingredient_id));
      if (!ing) continue;
      const ppu = calcPpu(ing);
      const qty = toNum(r.qty);
      if (!ppu || !qty) continue;
      hasAnyValid = true;
      cogs += ppu * qty;
    }

    // если нет рецепта или все строки "нулевые" → считаем, что COGS неизвестен
    const cogsVal = recipe.length === 0 || !hasAnyValid ? null : cogs;
    const profit = cogsVal === null ? null : price - cogsVal;
    const margin = cogsVal === null || price <= 0 ? null : (profit / price) * 100;

    return {
      id: mi.id,
      name: mi.name,
      category: mi.category,
      description: mi.description,
      price,
      cogs: cogsVal,
      profit,
      margin,
    };
  });

  const updatedAt = new Date().toISOString();
  return { items, updatedAt };
}

function renderMenuHTML({ items, updatedAt, mode }) {
  const showFinance = mode === "admin";

  const rows = items
    .map((it) => {
      const priceStr = money(it.price);

      const cogsStr = it.cogs === null ? "—" : money(it.cogs);
      const profitStr = it.profit === null ? "—" : money(it.profit);
      const marginStr = it.margin === null ? "—" : `${it.margin.toFixed(1)}%`;

      return `
        <tr>
          <td class="name">
            <div class="title">${esc(it.name)}</div>
            ${it.description ? `<div class="desc">${esc(it.description)}</div>` : ""}
          </td>
          <td class="price">${priceStr}</td>
          ${
            showFinance
              ? `<td class="num">${cogsStr}</td>
                 <td class="num">${profitStr}</td>
                 <td class="num">${marginStr}</td>`
              : ""
          }
        </tr>
      `;
    })
    .join("");

  const colsHead = showFinance
    ? `<th class="left">Блюдо</th><th class="right">Цена</th><th class="right">COGS</th><th class="right">Прибыль</th><th class="right">Маржа</th>`
    : `<th class="left">Блюдо</th><th class="right">Цена</th>`;

  const note = showFinance
    ? `<div class="note">COGS/Маржа видны только в админ-режиме.</div>`
    : `<div class="note">Цены в UZS. Обновлено: ${esc(new Date(updatedAt).toLocaleString("ru-RU"))}</div>`;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Dona’s Dosas — Menu</title>
  <style>
    :root{
      --bg:#f6f7fb;
      --card:#fff;
      --text:#111827;
      --muted:#6b7280;
      --line:#e5e7eb;
      --accent:#111827;
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      background:var(--bg);
      color:var(--text);
    }
    .wrap{
      max-width: 980px;
      margin: 0 auto;
      padding: 28px 18px 40px;
    }
    .header{
      display:flex;
      align-items:flex-end;
      justify-content:space-between;
      gap:12px;
      margin-bottom: 14px;
    }
    .brand{
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .sub{
      font-size: 13px;
      color: var(--muted);
      margin-top: 4px;
    }
    .card{
      background:var(--card);
      border:1px solid var(--line);
      border-radius: 16px;
      overflow:hidden;
      box-shadow: 0 6px 20px rgba(17,24,39,0.06);
    }
    table{
      width:100%;
      border-collapse:collapse;
    }
    thead th{
      background:#fafafa;
      color:#374151;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing:.06em;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
    }
    tbody td{
      padding: 12px 14px;
      border-top: 1px solid var(--line);
      vertical-align: top;
      font-size: 14px;
    }
    th.left, td.name{ text-align:left; }
    th.right, td.price, td.num{ text-align:right; white-space:nowrap; }
    .title{ font-weight: 650; }
    .desc{
      margin-top:4px;
      font-size:12px;
      color:var(--muted);
      line-height:1.35;
    }
    .note{
      margin-top:10px;
      font-size:12px;
      color:var(--muted);
    }
    @media print{
      body{ background:#fff; }
      .wrap{ padding: 0; }
      .card{ box-shadow:none; border-radius: 0; }
      .note{ display:none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>
        <div class="brand">Dona’s Dosas — Menu</div>
        <div class="sub">Fresh • Simple • Tasty</div>
      </div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>${colsHead}</tr>
        </thead>
        <tbody>
          ${rows || `<tr><td class="name">Пока нет позиций</td><td class="price">—</td></tr>`}
        </tbody>
      </table>
    </div>

    ${note}
  </div>
</body>
</html>`;
}

// PDF (без puppeteer)
function sendMenuPdf(res, { items, updatedAt }) {
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="donas-dosas-menu.pdf"');
  res.setHeader("Cache-Control", "no-store");

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 48, left: 48, right: 48, bottom: 48 },
  });

  doc.pipe(res);

  doc.fontSize(20).text("Dona’s Dosas — Menu", { align: "center" });
  doc.moveDown(0.25);
  doc.fontSize(10).fillColor("#666").text("Fresh • Simple • Tasty", { align: "center" });
  doc.fillColor("#000");
  doc.moveDown(0.8);

  doc
    .fontSize(10)
    .fillColor("#666")
    .text(`Prices in UZS • Updated: ${new Date(updatedAt).toLocaleString("ru-RU")}`, {
      align: "center",
    });
  doc.fillColor("#000");
  doc.moveDown(1.2);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colNameW = Math.floor(pageWidth * 0.72);
  const colPriceW = pageWidth - colNameW;

  function drawHeader() {
    doc.fontSize(11).fillColor("#000");
    const y = doc.y;
    doc.text("DISH", doc.page.margins.left, y, { width: colNameW, continued: true });
    doc.text("PRICE", doc.page.margins.left + colNameW, y, { width: colPriceW, align: "right" });

    doc.moveDown(0.5);
    const lineY = doc.y;
    doc
      .moveTo(doc.page.margins.left, lineY)
      .lineTo(doc.page.margins.left + pageWidth, lineY)
      .lineWidth(1)
      .strokeColor("#E5E7EB")
      .stroke();
    doc.moveDown(0.6);
  }

  function ensureSpace(heightNeeded = 22) {
    const bottomY = doc.page.height - doc.page.margins.bottom;
    if (doc.y + heightNeeded > bottomY) {
      doc.addPage();
      drawHeader();
    }
  }

  drawHeader();

  if (!items?.length) {
    doc.fontSize(12).fillColor("#666").text("No active items yet.", { align: "center" });
    doc.end();
    return;
  }

  // группируем по category для красоты
  const byCat = new Map();
  for (const it of items) {
    const cat = String(it.category || "Other").trim() || "Other";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(it);
  }

  for (const [cat, list] of byCat.entries()) {
    ensureSpace(34);
    doc.fontSize(12).fillColor("#111827").text(String(cat).toUpperCase());
    doc.moveDown(0.35);

    const lineY = doc.y;
    doc
      .moveTo(doc.page.margins.left, lineY)
      .lineTo(doc.page.margins.left + pageWidth, lineY)
      .lineWidth(1)
      .strokeColor("#F3F4F6")
      .stroke();
    doc.moveDown(0.6);

    for (const it of list) {
      ensureSpace(22);

      const name = String(it.name || `Item #${it.id}`).trim();
      const price = moneySpaced(it.price);

      const y = doc.y;
      doc.fontSize(11).fillColor("#111827");
      doc.text(name, doc.page.margins.left, y, { width: colNameW, continued: true });
      doc.text(price, doc.page.margins.left + colNameW, y, { width: colPriceW, align: "right" });

      doc.moveDown(0.75);

      const rowLineY = doc.y;
      doc
        .moveTo(doc.page.margins.left, rowLineY)
        .lineTo(doc.page.margins.left + pageWidth, rowLineY)
        .lineWidth(1)
        .strokeColor("#F3F4F6")
        .stroke();

      doc.moveDown(0.5);
    }
  }

  doc.end();
}

// Public HTML menu (QR/Print)
router.get("/menu/donas-dosas", async (req, res) => {
  try {
    const data = await fetchMenuData();
    const html = renderMenuHTML({ ...data, mode: "public" });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    console.error("GET /menu/donas-dosas error:", e);
    return res.status(500).send("Menu error");
  }
});

// PDF menu (реальный PDF, без puppeteer)
router.get("/menu/donas-dosas.pdf", async (req, res) => {
  try {
    const data = await fetchMenuData();
    return sendMenuPdf(res, data);
  } catch (e) {
    console.error("GET /menu/donas-dosas.pdf error:", e);
    return res.status(500).type("text/plain").send("PDF error");
  }
});

module.exports = router;
