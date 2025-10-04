import React, { useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

function getAuthToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken") ||
    localStorage.getItem("clientToken") ||
    ""
  );
}

export default function AdminQuickTools() {
  const [pid, setPid] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    setMsg("");
    const id = Number(pid);
    if (!Number.isInteger(id) || id <= 0) { setMsg("ID?"); return; }
    if ((pwd || "").length < 6) { setMsg("≥ 6 символов"); return; }

    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/providers/${id}/password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ password: pwd }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg("✓ Сохранено");
      setPwd("");
    } catch (e) {
      setMsg("Ошибка");
      console.error("admin password set error:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}
      className="hidden md:flex items-center gap-2 ml-2 px-2 py-1 rounded-lg bg-gray-50 ring-1 ring-gray-200">
      <span className="text-xs text-gray-500">Pwd:</span>
      <input
        type="number"
        min="1"
        value={pid}
        onChange={(e)=>setPid(e.target.value)}
        placeholder="ID"
        className="w-[84px] h-8 px-2 rounded border text-sm"
      />
      <input
        type="text"
        value={pwd}
        onChange={(e)=>setPwd(e.target.value)}
        placeholder="new password"
        className="w-[140px] h-8 px-2 rounded border text-sm"
      />
      <button
        type="submit"
        disabled={busy}
        className="h-8 px-3 rounded bg-blue-600 text-white text-sm disabled:opacity-60">
        Set
      </button>
      {msg && <span className="text-xs ml-1 text-gray-600">{msg}</span>}
    </form>
  );
}
