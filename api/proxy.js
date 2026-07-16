const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const backendUrl = (process.env.BACKEND_URL || process.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

  if (!backendUrl) {
    res.status(500).json({ error: "BACKEND_URL is not configured" });
    return;
  }

  const path = String(req.query.path || "").replace(/^\/+/, "");
  const target = new URL(`/api/${path}`, backendUrl);

  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) {
      value.forEach((item) => target.searchParams.append(key, item));
    } else if (typeof value !== "undefined") {
      target.searchParams.set(key, value);
    }
  }

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "host") continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  const hasBody = !["GET", "HEAD"].includes(req.method || "GET");
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await readBody(req) : undefined,
    redirect: "manual",
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  const body = Buffer.from(await upstream.arrayBuffer());
  res.send(body);
}
