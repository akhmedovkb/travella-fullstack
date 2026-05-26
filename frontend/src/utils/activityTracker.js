// frontend/src/utils/activityTracker.js

import { apiPost } from "../api";

const SESSION_KEY = "travella:activity_session_id";
const LAST_PAGE_KEY = "travella:activity_last_page";

function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      const rand = Math.random().toString(36).slice(2, 10);
      id = `web_${Date.now()}_${rand}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `web_${Date.now()}`;
  }
}

function parseJwt(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getActor() {
  const clientToken = localStorage.getItem("clientToken") || "";
  const providerToken = localStorage.getItem("providerToken") || localStorage.getItem("token") || "";
  const token = clientToken || providerToken;
  const claims = parseJwt(token) || {};

  const role = clientToken ? "client" : (claims.role || claims.type || "provider");
  const actorId = claims.id || claims.userId || claims.uid || claims.clientId || claims.providerId || claims.sub || null;

  return { actorRole: String(role || "").toLowerCase(), actorId };
}

function visibleText(el) {
  if (!el) return "";
  const aria = el.getAttribute?.("aria-label") || el.getAttribute?.("title") || "";
  const txt = aria || el.innerText || el.textContent || el.value || "";
  return String(txt || "").replace(/\s+/g, " ").trim().slice(0, 260);
}

function pickClickable(start) {
  let el = start;
  for (let i = 0; el && i < 8; i += 1) {
    const tag = String(el.tagName || "").toLowerCase();
    if (
      tag === "button" ||
      tag === "a" ||
      tag === "input" ||
      tag === "select" ||
      tag === "textarea" ||
      el.getAttribute?.("role") === "button" ||
      el.getAttribute?.("data-track")
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return start;
}

function pickDataset(el) {
  const out = {};
  const d = el?.dataset || {};
  for (const [k, v] of Object.entries(d)) {
    if (k.startsWith("track")) out[k] = v;
  }
  return out;
}

function inferEventName(el) {
  const explicit = el?.getAttribute?.("data-track") || el?.dataset?.trackName;
  if (explicit) return explicit;

  const text = visibleText(el).toLowerCase();
  const href = el?.getAttribute?.("href") || "";

  if (text.includes("открыть") && text.includes("контакт")) return "click_open_contacts";
  if (text.includes("оплат") || text.includes("payme")) return "click_pay";
  if (text.includes("создать")) return "click_create";
  if (text.includes("сохранить")) return "click_save";
  if (text.includes("удалить")) return "click_delete";
  if (text.includes("архив")) return "click_archive";
  if (href) return "link_click";
  return "click";
}

function extractIds(el) {
  let cur = el;
  const out = {};
  for (let i = 0; cur && i < 8; i += 1) {
    const d = cur.dataset || {};
    if (!out.serviceId && (d.serviceId || d.trackServiceId)) out.serviceId = d.serviceId || d.trackServiceId;
    if (!out.providerId && (d.providerId || d.trackProviderId)) out.providerId = d.providerId || d.trackProviderId;
    if (!out.clientId && (d.clientId || d.trackClientId)) out.clientId = d.clientId || d.trackClientId;
    cur = cur.parentElement;
  }
  return out;
}

let queue = [];
let flushTimer = null;

function send(payload) {
  queue.push(payload);
  if (flushTimer) return;
  flushTimer = window.setTimeout(async () => {
    const items = queue.splice(0, 10);
    flushTimer = null;
    for (const item of items) {
      try {
        await apiPost("/api/activity/track", item, true);
      } catch {
        // analytics must never break UX
      }
    }
  }, 350);
}

export function trackActivity(eventName, extra = {}) {
  const actor = getActor();
  send({
    eventType: extra.eventType || "event",
    eventName,
    sessionId: getSessionId(),
    pagePath: window.location.pathname + window.location.search,
    pageTitle: document.title || "",
    source: "web",
    actorRole: actor.actorRole,
    actorId: actor.actorId,
    ...extra,
  });
}

export function installActivityTracker() {
  if (typeof window === "undefined" || window.__travellaActivityTrackerInstalled) return;
  window.__travellaActivityTrackerInstalled = true;

  const trackPage = () => {
    const path = window.location.pathname + window.location.search;
    const prev = sessionStorage.getItem(LAST_PAGE_KEY);
    if (prev !== path) {
      sessionStorage.setItem(LAST_PAGE_KEY, path);
      trackActivity("page_view", { eventType: "page_view" });
    }
  };

  trackPage();
  window.addEventListener("popstate", trackPage);

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function pushStatePatched(...args) {
    const ret = origPush.apply(this, args);
    setTimeout(trackPage, 0);
    return ret;
  };
  history.replaceState = function replaceStatePatched(...args) {
    const ret = origReplace.apply(this, args);
    setTimeout(trackPage, 0);
    return ret;
  };

  document.addEventListener(
    "click",
    (e) => {
      const el = pickClickable(e.target);
      if (!el) return;
      const ids = extractIds(el);
      const href = el.getAttribute?.("href") || "";
      trackActivity(inferEventName(el), {
        eventType: "click",
        elementText: visibleText(el),
        elementTag: String(el.tagName || "").toLowerCase(),
        elementRole: el.getAttribute?.("role") || "",
        elementHref: href,
        serviceId: ids.serviceId,
        providerId: ids.providerId,
        clientId: ids.clientId,
        meta: {
          dataset: pickDataset(el),
          className: String(el.className || "").slice(0, 300),
        },
      });
    },
    true
  );

  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      trackActivity(form?.getAttribute?.("data-track") || "form_submit", {
        eventType: "form_submit",
        elementText: form?.getAttribute?.("aria-label") || form?.getAttribute?.("name") || "form",
        elementTag: "form",
        meta: { action: form?.getAttribute?.("action") || "" },
      });
    },
    true
  );
}
