// components/admin/SetProviderPassword.jsx
import React, { useState } from "react";

export default function SetProviderPassword({ providerId, onDone }) {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const minLen = 6;

  const save = async () => {
    if (pwd.trim().length < minLen) return alert(`Min ${minLen} characters`);
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/providers/${providerId}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Request failed");
      alert("Пароль обновлён");
      setOpen(false);
      setPwd("");
      onDone?.();
    } catch (e) {
      alert("Ошибка: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="px-2 py-1 border rounded" onClick={() => setOpen(true)}>
        Set password
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-xl w-[360px] shadow">
            <h3 className="font-semibold mb-3">Set new password</h3>
            <input
              type="text"
              className="w-full border rounded px-2 py-2 mb-3"
              placeholder="New password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="px-3 py-2 bg-blue-600 text-white rounded"
                      onClick={save} disabled={busy || pwd.trim().length < minLen}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
