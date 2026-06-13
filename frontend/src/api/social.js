// frontend/src/api/social.js
import { buildUrl, getAuthHeaders, apiGet, apiPost, apiDelete } from "../api";

function tokenForAnyRole() {
  return (
    getAuthHeaders("client").Authorization ||
    getAuthHeaders("provider").Authorization ||
    getAuthHeaders("admin").Authorization ||
    ""
  );
}

async function handle(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data || {};
    throw err;
  }
  return data || {};
}

export async function getSocialFeed(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") qs.set(k, String(v));
  });
  const path = `/api/social/feed${qs.toString() ? `?${qs}` : ""}`;
  const auth = tokenForAnyRole();
  const res = await fetch(buildUrl(path), { headers: auth ? { Authorization: auth } : {}, credentials: "include" });
  return handle(res);
}

export function getProviderPosts(providerId) {
  return apiGet(`/api/social/providers/${providerId}/posts`, true);
}

export function createSocialPost({ title, body, type, country, city, service_id, files = [] }) {
  const fd = new FormData();
  fd.append("title", title || "");
  fd.append("body", body || "");
  fd.append("type", type || "post");
  if (country) fd.append("country", country);
  if (city) fd.append("city", city);
  if (service_id) fd.append("service_id", String(service_id));
  Array.from(files || []).forEach((file) => fd.append("files", file));

  return fetch(buildUrl("/api/social/posts"), {
    method: "POST",
    headers: { ...getAuthHeaders("provider") },
    body: fd,
    credentials: "include",
  }).then(handle);
}

export function deleteSocialPost(id) {
  return apiDelete(`/api/social/posts/${id}`, "provider");
}

export function toggleSocialLike(id, role = true) {
  return apiPost(`/api/social/posts/${id}/like`, {}, role);
}

export function getSocialComments(id) {
  return apiGet(`/api/social/posts/${id}/comments`, true);
}

export function createSocialComment(id, body, role = true) {
  return apiPost(`/api/social/posts/${id}/comments`, { body }, role);
}

export function getFollowStatus(providerId) {
  return apiGet(`/api/social/providers/${providerId}/follow`, "client");
}

export function toggleProviderFollow(providerId) {
  return apiPost(`/api/social/providers/${providerId}/follow`, {}, "client");
}
