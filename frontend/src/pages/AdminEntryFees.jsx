// frontend/src/pages/AdminEntryFees.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "../shared/toast";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const authHeaders = () => {
  const tok =
    localStorage.getItem("token") ||
    localStorage.getItem("providerToken") ||
    localStorage.getItem("clientToken");
  return tok ? { Authorization: `Bearer ${tok}` } : {};
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const blank = {
  name_ru: "", name_uz: "", name_en: "", city: "", currency: "UZS",

  wk_res_adult: 0, wk_res_child: 0, wk_res_senior: 0,
  wk_nrs_adult: 0, wk_nrs_child: 0, wk_nrs_senior: 0,

  we_res_adult: 0, we_res_child: 0, we_res_senior: 0,
  we_nrs_adult: 0, we_nrs_child: 0, we_nrs_senior: 0,

  hd_res_adult: 0, hd_res_child: 0, hd_res_senior: 0,
  hd_nrs_adult: 0, hd_nrs_child: 0, hd_nrs_senior: 0,
};

/* --- Локальный словарик для тостов --- */
const L = {
  ru: {
    created: "Объект успешно добавлен",
    updated: "Изменения сохранены",
    deleted: "Объект удалён",
    load_error: "Не удалось загрузить список",
    save_error: "Ошибка сохранения",
    delete_error: "Ошибка при удалении",
    confirm_delete: 'Удалить "{{name}}"?',
    saving: "Сохраняю…",
  },
  en: {
    created: "Item created",
    updated: "Changes saved",
    deleted: "Item deleted",
    load_error: "Failed to load list",
    save_error: "Save failed",
    delete_error: "Delete failed",
    confirm_delete: 'Delete “{{name}}”?',
    saving: "Saving…",
  },
  uz: {
    created: "Obyekt qoʻshildi",
    updated: "Oʻzgartirishlar saqlandi",
    deleted: "Obyekt o‘chirildi",
    load_error: "Roʻyxatni yuklab boʻlmadi",
    save_error: "Saqlashda xato",
    delete_error: "O‘chirishda xato",
    confirm_delete: '“{{name}}” o‘chirilsinmi?',
    saving: "Saqlanmoqda…",
  },
};
const i18nPick = (lang = "en") =>
  L[lang?.slice(0, 2)] || L.en;
const tr = (lang, key, vars = {}) =>
  (i18nPick(lang)[key] || L.en[key] || key).replace(/{{(\w+)}}/g, (_m, k) => vars[k] ?? "");

export default function AdminEntryFees() {
  const { i18n } = useTranslation();
  const lng = i18n.language || "en";

  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const u = new URL("/api/admin/entry-fees", API_BASE);
      u.searchParams.set("q", q);
      u.searchParams.set("page", page);
      u.searchParams.set("limit", limit);
      const r = await fetch(u, { credentials: "include", headers: { ...authHeaders() } });
      if (!r.ok) throw new Error("load failed");
      const d = await r.json();
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch {
      toast.error(tr(lng, "load_error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, page]);

  const onEdit = (row) => setEditing(row ? { ...row } : { ...blank });

  const onDelete = async (row) => {
    if (!confirm(tr(lng, "confirm_delete", { name: row.name_ru }))) return;
    try {
      const r = await fetch(new URL(`/api/admin/entry-fees/${row.id}`, API_BASE), {
        method: "DELETE",
        credentials: "include",
        headers: { ...authHeaders() },
      });
      if (!r.ok) throw new Error("delete failed");
      toast.success(tr(lng, "deleted"));
      fetchList();
    } catch {
      toast.error(tr(lng, "delete_error"));
    }
  };

  const onSave = async (e) => {
    e.preventDefault();
    const body = { ...editing };
    Object.keys(body).forEach((k) => {
      if (/_(adult|child|senior)$/.test(k)) body[k] = num(body[k]);
    });

    const isNew = !body.id;
    const url = isNew ? "/api/admin/entry-fees" : `/api/admin/entry-fees/${body.id}`;
    const method = isNew ? "POST" : "PUT";

    setSaving(true);
    try {
      const r = await fetch(new URL(url, API_BASE), {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("save failed");
      toast.success(tr(lng, isNew ? "created" : "updated"));
      setEditing(null);
      fetchList();
    } catch {
      toast.error(tr(lng, "save_error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Entry fees — админ</h1>
        <button className="px-3 py-2 rounded bg-gray-800 text-white" onClick={() => onEdit(null)}>
          + Новый объект
        </button>
      </div>

      {/* поиск */}
      <div className="flex gap-2 items-center mb-3">
        <input
          className="border rounded px-3 py-2 w-72"
          placeholder="Поиск: название/город"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        {loading && <span className="text-sm text-gray-500">Загрузка…</span>}
      </div>

      {/* список */}
      <div className="border rounded overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">ID</th>
              <th className="p-2 text-left">Название (ru)</th>
              <th className="p-2 text-left">Город</th>
              <th className="p-2 text-left">Валюта</th>
              <th className="p-2 text-left">Будни рез/нерез (ВЗР)</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-2">{row.id}</td>
                <td className="p-2">{row.name_ru}</td>
                <td className="p-2">{row.city}</td>
                <td className="p-2">{row.currency}</td>
                <td className="p-2">
                  {row.wk_res_adult} / {row.wk_nrs_adult}
                </td>
                <td className="p-2 text-right">
                  <button className="px-2 py-1 border rounded mr-2" onClick={() => onEdit(row)}>
                    Редакт.
                  </button>
                  <button className="px-2 py-1 border rounded" onClick={() => onDelete(row)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && !loading && (
              <tr>
                <td className="p-3 text-gray-500" colSpan={6}>
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* пагинация */}
      <div className="mt-3 flex gap-2 items-center">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          ←
        </button>
        <div className="text-sm">Стр. {page} / {pages}</div>
        <button
          disabled={page >= pages}
          onClick={() => setPage((p) => Math.min(pages, p + 1))}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          →
        </button>
      </div>

      {/* форма */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <form onSubmit={onSave} className="bg-white w-[980px] max-h-[90vh] overflow-auto rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{editing.id ? "Редактирование" : "Новый объект"}</h2>
              <button type="button" onClick={() => setEditing(null)} className="px-3 py-1 border rounded">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <label className="text-sm">
                Название (ru)
                <input
                  required
                  className="mt-1 border rounded px-2 py-1 w-full"
                  value={editing.name_ru || ""}
                  onChange={(e) => setEditing((s) => ({ ...s, name_ru: e.target.value }))}
                />
              </label>
              <label className="text-sm">
                Название (uz)
                <input
                  className="mt-1 border rounded px-2 py-1 w-full"
                  value={editing.name_uz || ""}
                  onChange={(e) => setEditing((s) => ({ ...s, name_uz: e.target.value }))}
                />
              </label>
              <label className="text-sm">
                Название (en)
                <input
                  className="mt-1 border rounded px-2 py-1 w-full"
                  value={editing.name_en || ""}
                  onChange={(e) => setEditing((s) => ({ ...s, name_en: e.target.value }))}
                />
              </label>
              <label className="text-sm">
                Город
                <input
                  required
                  className="mt-1 border rounded px-2 py-1 w-full"
                  value={editing.city || ""}
                  onChange={(e) => setEditing((s) => ({ ...s, city: e.target.value }))}
                />
              </label>

              <label className="text-sm">
                Валюта
                <select
                  className="mt-1 border rounded px-2 py-1 w-full"
                  value={editing.currency || "UZS"}
                  onChange={(e) => setEditing((s) => ({ ...s, currency: e.target.value }))}
                >
                  <option>UZS</option>
                  <option>USD</option>
                  <option>EUR</option>
                </select>
              </label>
            </div>

            <TariffBlock title="Будни" prefix="wk" editing={editing} setEditing={setEditing} />
            <TariffBlock title="Выходные" prefix="we" editing={editing} setEditing={setEditing} />
            <TariffBlock title="Праздничные" prefix="hd" editing={editing} setEditing={setEditing} />

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-4 py-2 border rounded" onClick={() => setEditing(null)}>
                Отмена
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-60">
                {saving ? tr(lng, "saving") : "Сохранить"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function TariffBlock({ title, prefix, editing, setEditing }) {
  const set = (k, v) => setEditing((s) => ({ ...s, [k]: v }));

  return (
    <div className="border rounded p-3">
      <div className="font-semibold mb-2">{title}</div>
      <div className="grid grid-cols-3 gap-4">
        {/* Резиденты */}
        <div>
          <div className="text-sm font-medium mb-1">Резиденты</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Num label="ВЗР" v={editing[`${prefix}_res_adult`]} onChange={(v) => set(`${prefix}_res_adult`, v)} />
            <Num label="РЕБ" v={editing[`${prefix}_res_child`]} onChange={(v) => set(`${prefix}_res_child`, v)} />
            <Num label="ПЕНС" v={editing[`${prefix}_res_senior`]} onChange={(v) => set(`${prefix}_res_senior`, v)} />
          </div>
        </div>
        {/* Нерезиденты */}
        <div>
          <div className="text-sm font-medium mb-1">Нерезиденты</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Num label="ВЗР" v={editing[`${prefix}_nrs_adult`]} onChange={(v) => set(`${prefix}_nrs_adult`, v)} />
            <Num label="РЕБ" v={editing[`${prefix}_nrs_child`]} onChange={(v) => set(`${prefix}_nrs_child`, v)} />
            <Num label="ПЕНС" v={editing[`${prefix}_nrs_senior`]} onChange={(v) => set(`${prefix}_nrs_senior`, v)} />
          </div>
        </div>
        {/* Подсказка */}
        <div className="text-xs text-gray-500">
          Указывайте цены в выбранной валюте объекта. Все поля числовые, пустые = 0.
        </div>
      </div>
    </div>
  );
}

function Num({ label, v, onChange }) {
  return (
    <label className="text-xs">
      {label}
      <input
        type="number"
        min={0}
        step="1"
        className="mt-1 w-full border rounded px-2 py-1"
        value={v ?? 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </label>
  );
}
