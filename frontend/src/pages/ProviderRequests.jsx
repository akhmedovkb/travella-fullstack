// frontend/src/pages/ProviderRequests.jsx
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import ProviderInboxList from "../components/ProviderInboxList";
import ProviderOutboxList from "../components/ProviderOutboxList";

export default function ProviderRequests() {
  const [searchParams, setSearchParams] = useSearchParams();

  const resolveTab = (sp) =>
    String(sp.get("tab") || "").toLowerCase() === "outgoing"
      ? "outgoing"
      : "incoming";

  const [tab, setTab] = useState(resolveTab(searchParams));

  // синхронизация c URL (?tab=outgoing)
  useEffect(() => {
    const next = resolveTab(searchParams);
    if (next !== tab) setTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const switchTab = (next) => {
    if (next === tab) return;
    setTab(next);
    const p = new URLSearchParams(searchParams);
    p.set("tab", next);
    setSearchParams(p, { replace: true });
  };

  const TabBtn = ({ k, children }) => {
    const active = tab === k;
    return (
      <button
        onClick={() => switchTab(k)}
        className={`px-4 py-2 rounded-lg border-b-2 font-medium ${
          active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500"
        }`}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-xl shadow p-6 border">
        <div className="flex items-center gap-3 border-b pb-3 mb-4">
          <TabBtn k="incoming">Входящие</TabBtn>
          <TabBtn k="outgoing">Исходящие</TabBtn>
        </div>

        {tab === "incoming" ? (
          <ProviderInboxList showHeader={false} />
        ) : (
          <ProviderOutboxList showHeader={false} />
        )}
      </div>
    </div>
  );
}
