// frontend/src/pages/admin/AdminInside.jsx
import { useEffect, useState } from "react";
import {
  listParticipants, createParticipant, updateParticipant,
  listCompletionRequests, approveRequest, rejectRequest
} from "../../api/inside";

export default function AdminInside() {
  const [participants, setParticipants] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  // create form
  const [newUserId, setNewUserId] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([
        listParticipants({}),
        listCompletionRequests("pending"),
      ]);
      setParticipants(Array.isArray(p) ? p : p?.items || []);
      setRequests(Array.isArray(r) ? r : r?.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleCreate = async () => {
    const uid = Number(newUserId);
    if (!uid) return alert("user_id?");
    await createParticipant({ user_id: uid });
    setNewUserId("");
    await loadAll();
  };

  const incProgress = async (row) => {
    await updateParticipant(row.id, { progress_current: Number(row.progress_current) + 1 });
    await loadAll();
  };

  const setChapter = async (row, next) => {
    await updateParticipant(row.id, { current_chapter: next });
    await loadAll();
  };

  const approve = async (rq) => {
    await approveRequest(rq.id);
    await loadAll();
  };

  const reject = async (rq) => {
    await rejectRequest(rq.id);
    await loadAll();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold">India Inside — Admin</h1>

      <div className="mt-6 grid md:grid-cols-2 gap-6">
        {/* Participants */}
        <section className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Участники</h2>
            <button onClick={loadAll} className="text-orange-600">Обновить</button>
          </div>

          <div className="mt-3 flex gap-2">
            <input
              className="border rounded-lg px-3 py-2 w-48"
              placeholder="user_id"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
            />
            <button onClick={handleCreate} className="px-3 py-2 rounded-lg bg-black text-white">Создать</button>
          </div>

          {loading ? (
            <div className="text-gray-500 mt-4">Загрузка…</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Chapter</th>
                    <th className="py-2 pr-3">Progress</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="py-2 pr-3">{p.id}</td>
                      <td className="py-2 pr-3">{p.user_id}</td>
                      <td className="py-2 pr-3">
                        <select
                          className="border rounded px-2 py-1"
                          value={p.current_chapter}
                          onChange={(e) => setChapter(p, e.target.value)}
                        >
                          <option value="royal">royal</option>
                          <option value="silence">silence</option>
                          <option value="modern">modern</option>
                          <option value="kerala">kerala</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        {p.progress_current} / {p.progress_total}{" "}
                        <button className="ml-2 px-2 py-0.5 border rounded" onClick={() => incProgress(p)}>+1</button>
                      </td>
                      <td className="py-2 pr-3">{p.status}</td>
                      <td className="py-2">
                        {/* можно расширить: pause/complete */}
                      </td>
                    </tr>
                  ))}
                  {!participants.length && (
                    <tr><td className="py-4 text-gray-500" colSpan={6}>Нет участников</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Requests */}
        <section className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Заявки на завершение</h2>
            <button onClick={loadAll} className="text-orange-600">Обновить</button>
          </div>

          {loading ? (
            <div className="text-gray-500 mt-4">Загрузка…</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Chapter</th>
                    <th className="py-2 pr-3">Дата</th>
                    <th className="py-2">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2 pr-3">{r.id}</td>
                      <td className="py-2 pr-3">{r.user_id}</td>
                      <td className="py-2 pr-3">{r.chapter_key}</td>
                      <td className="py-2 pr-3">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="py-2">
                        <button className="px-2 py-1 border rounded mr-2" onClick={() => approve(r)}>Одобрить</button>
                        <button className="px-2 py-1 border rounded text-red-600" onClick={() => reject(r)}>Отклонить</button>
                      </td>
                    </tr>
                  ))}
                  {!requests.length && (
                    <tr><td className="py-4 text-gray-500" colSpan={5}>Нет заявок</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
