export async function createLead(payload) {
  const base = import.meta.env.VITE_API_URL || "";
  const res = await fetch(`${base}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Lead submit error");
  return json.lead || json;
}
