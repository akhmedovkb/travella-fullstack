// frontend/src/utils/paymeGuide.js

function cleanPaymeUrl(payUrl) {
  return String(payUrl || "").trim();
}

export function buildPaymeGuideUrl(payUrl, options = {}) {
  const url = cleanPaymeUrl(payUrl);
  if (!url) return "";

  const params = new URLSearchParams();
  params.set("pay_url", url);

  if (options.purpose) params.set("purpose", String(options.purpose));
  if (options.amount != null && options.amount !== "") params.set("amount", String(options.amount));
  if (options.orderId != null && options.orderId !== "") params.set("order_id", String(options.orderId));
  if (options.serviceId != null && options.serviceId !== "") params.set("service_id", String(options.serviceId));
  if (options.returnTo) params.set("return_to", String(options.returnTo));

  return `/payme/guide?${params.toString()}`;
}

export function redirectToPaymeGuide(payUrl, options = {}) {
  const guideUrl = buildPaymeGuideUrl(payUrl, options);
  if (!guideUrl) return false;
  window.location.href = guideUrl;
  return true;
}
