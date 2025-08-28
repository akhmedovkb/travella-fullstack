// frontend/src/components/ProviderCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

/** helpers */
const dateToYmd = (d) => {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const ymdToLocalDate = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d); // без UTC-сдвига
};
const normalizeFromServer = (arr) => {
  const out = new Set();
  (Array.isArray(arr) ? arr : []).forEach((v) => {
    const s = typeof v === "string" ? v : v?.day || v?.date || "";
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  });
  return Array.from(out).sort();
};

const ProviderCalendar = ({ token }) => {
  const { t } = useTranslation();
  const API = import.meta.env.VITE_API_BASE_URL;

  // что лежит в БД (YYYY-MM-DD)
  const [initial, setInitial] = useState([]);
  // текущее выделение (YYYY-MM-DD)
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  const config = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  // ===== загрузка ручных блокировок =====
  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API}/api/providers/blocked-dates`, config)
      .then(({ data }) => {
        const arr = normalizeFromServer(data); // ожидаем ["YYYY-MM-DD"]
        setInitial(arr);
        setSelected(arr);
      })
      .catch((err) => {
        console.error("Ошибка загрузки blocked-dates", err);
        toast.error(t("calendar.load_error") || "Не удалось загрузить занятые даты");
      });
  }, [token]);

  // Для DayPicker нужны Date-объекты
  const selectedAsDates = useMemo(
    () => selected.map(ymdToLocalDate).filter(Boolean),
    [selected]
  );

  // Тоггл дня
  const onDayClick = (day) => {
    const ymd = dateToYmd(day);
    setSelected((prev) => (prev.includes(ymd) ? prev.filter((x) => x !== ymd) : [...prev, ymd]));
  };

  // Сохранение
  const handleSave = async () => {
    const final = Array.from(new Set(selected)).sort();
    setSaving(true);
    try {
      // 1) пробуем полную замену
      await axios.post(`${API}/api/providers/blocked-dates`, { dates: final }, config);
      setInitial(final);
      toast.success(t("calendar.saved_successfully") || "Даты сохранены");
    } catch {
      // 2) сервер ждёт дифф
      try {
        const initSet = new Set(initial);
        const finSet = new Set(final);
        const add = final.filter((d) => !initSet.has(d));
        const remove = initial.filter((d) => !finSet.has(d));
        await axios.post(`${API}/api/providers/blocked-dates`, { add, remove }, config);
        setInitial(final);
        toast.success(t("calendar.saved_successfully") || "Даты сохранены");
      } catch (e2) {
        console.error("Ошибка сохранения blocked-dates", e2);
        toast.error(t("calendar.save_error") || "Ошибка сохранения дат");
      }
    } finally {
      setSaving(false);
      // подтянуть актуальные значения из БД (на всякий)
      try {
        const { data } = await axios.get(`${API}/api/providers/blocked-dates`, config);
        const arr = normalizeFromServer(data);
        setInitial(arr);
        setSelected(arr);
      } catch {}
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow border max-w-3xl mx-auto">
      <h3 className="text-lg font-semibold mb-4 text-orange-600">
        {t("calendar.blocking_title") || "Календарь занятости"}
      </h3>

      <DayPicker
        mode="multiple"
        selected={selectedAsDates}
        onDayClick={onDayClick}
        disabled={[{ before: new Date() }]}
        modifiersClassNames={{ selected: "bg-red-500 text-white" }}
      />

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-4 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-60"
      >
        {saving ? (t("saving") || "Сохранение…") : (t("calendar.save_blocked") || "Сохранить занятые даты")}
      </button>
      <p className="text-sm mt-2 text-gray-600">🔴 {t("calendar.manual_blocked")} | 🔵 {t("calendar.booked")}</p>
    </div>
  );
};

export default ProviderCalendar;
