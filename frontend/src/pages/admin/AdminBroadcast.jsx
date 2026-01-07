import React from "react";
import { apiGet, apiPost } from "../../api";
import { useTranslation } from "react-i18next";

export default function AdminBroadcast() {
  const { t } = useTranslation();

  const [audience, setAudience] = React.useState("all");
  const [text, setText] = React.useState("");
  const [broadcastId, setBroadcastId] = React.useState("");
  const [status, setStatus] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");

  const idNum = Number(broadcastId);
  const hasId = Number.isInteger(idNum) && idNum > 0;

  const clearAlerts = () => {
    setMsg("");
    setErr("");
  };

  const safeText = (v) => String(v || "").trim();

  const doTest = async () => {
    clearAlerts();
    const bodyText = safeText(text);
    if (!bodyText) {
      setErr(t("broadcast.err_text", "Введите текст"));
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost("/api/admin/broadcast/test", { text: bodyText });
      setMsg(
        t(
          "broadcast.test_ok",
          "Тест отправлен (в первый ADMIN_TG_CHAT_IDS): {{chatId}}",
          { chatId: r?.chatId || "" }
        )
      );
    } catch (e) {
      setErr(String(e?.message || "Ошибка"));
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    clearAlerts();
    const bodyText = safeText(text);
    if (!bodyText) {
      setErr(t("broadcast.err_text", "Введите текст"));
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost("/api/admin/broadcast/create", { audience, text: bodyText });
      const id = r?.broadcastId;
      setBroadcastId(String(id || ""));
      setMsg(
        t("broadcast.created", "Создано: #{{id}} (получателей: {{total}})", {
          id: id || "",
          total: r?.total ?? 0,
        })
      );
      if (id) {
        const s = await apiGet(`/api/admin/broadcast/${id}/status`);
        setStatus(s);
      }
    } catch (e) {
      setErr(String(e?.message || "Ошибка"));
    } finally {
      setBusy(false);
    }
  };

  const doStart = async () => {
    clearAlerts();
    if (!hasId) {
      setErr(t("broadcast.err_id", "Укажите ID рассылки"));
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost(`/api/admin/broadcast/${idNum}/start`, {});
      setMsg(t("broadcast.started", "Запущено"));
      const s = await apiGet(`/api/admin/broadcast/${idNum}/status`);
      setStatus({ ...s, ...r });
    } catch (e) {
      setErr(String(e?.message || "Ошибка"));
    } finally {
      setBusy(false);
    }
  };

  const doPause = async () => {
    clearAlerts();
    if (!hasId) {
      setErr(t("broadcast.err_id", "Укажите ID рассылки"));
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/api/admin/broadcast/${idNum}/pause`, {});
      setMsg(t("broadcast.paused", "Пауза"));
      const s = await apiGet(`/api/admin/broadcast/${idNum}/status`);
      setStatus(s);
    } catch (e) {
      setErr(String(e?.message || "Ошибка"));
    } finally {
      setBusy(false);
    }
  };

  const doRefresh = async () => {
    clearAlerts();
    if (!hasId) {
      setErr(t("broadcast.err_id", "Укажите ID рассылки"));
      return;
    }
    setBusy(true);
    try {
      const s = await apiGet(`/api/admin/broadcast/${idNum}/status`);
      setStatus(s);
      setMsg(t("broadcast.refreshed", "Обновлено"));
    } catch (e) {
      setErr(String(e?.message || "Ошибка"));
    } finally {
      setBusy(false);
    }
  };

  const b = status?.broadcast || null;
  const total = Number(status?.total ?? 0);
  const sent = Number(status?.sent ?? 0);
  const failed = Number(status?.failed ?? 0);
  const pending = Number(status?.pending ?? 0);
  const done = total > 0 ? sent + failed : 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-xl shadow p-4 md:p-6">
        <h1 className="text-xl md:text-2xl font-semibold">{t("broadcast.title", "Рассылка в Telegram")}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {t(
            "broadcast.subtitle",
            "Отправка сообщения всем привязанным к Bot Otkaznyx Turov клиентам и/или поставщикам."
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <div>
            <label className="text-sm font-medium text-gray-700">{t("broadcast.audience", "Аудитория")}</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            >
              <option value="all">{t("broadcast.audience_all", "Все")}</option>
              <option value="providers">{t("broadcast.audience_providers", "Поставщики")}</option>
              <option value="clients">{t("broadcast.audience_clients", "Клиенты")}</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">{t("broadcast.id", "ID рассылки")}</label>
            <input
              value={broadcastId}
              onChange={(e) => setBroadcastId(e.target.value)}
              placeholder="123"
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
            <div className="text-xs text-gray-500 mt-1">
              {t("broadcast.id_hint", "После создания появится автоматически")}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <button
              disabled={busy}
              onClick={doRefresh}
              className="h-10 px-4 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              {t("broadcast.refresh", "Обновить")}
            </button>
            <button
              disabled={busy || !hasId}
              onClick={doPause}
              className="h-10 px-4 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              {t("broadcast.pause", "Пауза")}
            </button>
            <button
              disabled={busy || !hasId}
              onClick={doStart}
              className="h-10 px-4 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {t("broadcast.start", "Запуск")}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-sm font-medium text-gray-700">{t("broadcast.text", "Текст сообщения")}</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            placeholder={t("broadcast.text_ph", "Например: инструкция, новости, обновления")}
          />
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              disabled={busy}
              onClick={doTest}
              className="h-10 px-4 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              {t("broadcast.test", "Тест админам")}
            </button>
            <button
              disabled={busy}
              onClick={doCreate}
              className="h-10 px-4 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {t("broadcast.create", "Создать (подготовить список)")}
            </button>
          </div>

          {(msg || err) && (
            <div
              className={
                "mt-3 rounded-lg px-3 py-2 text-sm " +
                (err ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")
              }
            >
              {err || msg}
            </div>
          )}
        </div>

        <div className="mt-6 border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">
                {t("broadcast.status", "Статус")}: <span className="font-mono">{b?.status || "-"}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {b?.started_at ? t("broadcast.started_at", "Старт: {{d}}", { d: new Date(b.started_at).toLocaleString() }) : ""}
                {b?.finished_at ? ` · ${t("broadcast.finished_at", "Финиш: {{d}}", { d: new Date(b.finished_at).toLocaleString() })}` : ""}
              </div>
            </div>

            <div className="text-right">
              <div className="text-sm text-gray-700">
                {t("broadcast.progress", "Прогресс")}: <span className="font-semibold">{pct}%</span>
              </div>
              <div className="text-xs text-gray-500">
                {t("broadcast.counters", "Всего: {{total}} · Отправлено: {{sent}} · Ошибки: {{failed}} · В очереди: {{pending}}", {
                  total,
                  sent,
                  failed,
                  pending,
                })}
              </div>
            </div>
          </div>

          <div className="mt-3 w-full h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-3 bg-blue-600" style={{ width: `${pct}%` }} />
          </div>

          {Array.isArray(status?.lastErrors) && status.lastErrors.length > 0 && (
            <div className="mt-5">
              <div className="text-sm font-semibold text-gray-800">{t("broadcast.last_errors", "Последние ошибки")}</div>
              <div className="mt-2 border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2">#</th>
                      <th className="text-left px-3 py-2">{t("broadcast.role", "Роль")}</th>
                      <th className="text-left px-3 py-2">chat_id</th>
                      <th className="text-left px-3 py-2">{t("broadcast.error", "Ошибка")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.lastErrors.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                        <td className="px-3 py-2">{r.role}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.chat_id}</td>
                        <td className="px-3 py-2 text-red-700">{r.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!status && (
            <div className="text-sm text-gray-500 mt-4">
              {t("broadcast.no_status", "Создайте рассылку или введите ID и нажмите «Обновить». ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
