// frontend/src/pages/admin/AdminOperations.jsx
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import AdminModeration from "../AdminModeration";
import AdminLeads from "./Leads";
import AdminRefusedActual from "./AdminRefusedActual";
import AdminProviders from "./AdminProviders";
import AdminClients from "./AdminClients";

const TABS = [
  {
    id: "moderation",
    label: "Модерация услуг",
    hint: "Проверка и управление услугами провайдеров.",
  },
  {
    id: "leads",
    label: "Leads",
    hint: "Новые лиды, подтверждение и конвертация в клиентов/провайдеров.",
  },
  {
    id: "refused",
    label: "Все отказные услуги",
    hint: "Все refused_* услуги: просмотр, фильтрация, продление, удаление и ручная проверка актуальности.",
  },
  {
    id: "providers",
    label: "Провайдеры",
    hint: "Поиск, просмотр и контроль зарегистрированных провайдеров.",
  },
  {
    id: "clients",
    label: "Клиенты",
    hint: "Поиск, просмотр и контроль зарегистрированных клиентов.",
  },
];

export default function AdminOperations() {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = useMemo(() => {
    const raw = String(searchParams.get("tab") || "moderation").trim().toLowerCase();
    return TABS.some((x) => x.id === raw) ? raw : "moderation";
  }, [searchParams]);

  function setTab(tab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }

  const activeMeta = TABS.find((x) => x.id === activeTab) || TABS[0];

  const TabBtn = ({ id, children }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`px-3 py-2 rounded-lg text-sm transition ${
        activeTab === id ? "bg-black text-white" : "border bg-white hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admin Operations</h1>
          <p className="text-sm text-gray-500">{activeMeta.hint}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TabBtn id="moderation">Модерация услуг</TabBtn>
          <TabBtn id="leads">Leads</TabBtn>
          <TabBtn id="refused">Все отказные услуги</TabBtn>
          <TabBtn id="providers">Провайдеры</TabBtn>
          <TabBtn id="clients">Клиенты</TabBtn>
        </div>
      </div>

      {activeTab === "moderation" && <AdminModeration />}
      {activeTab === "leads" && <AdminLeads />}
      {activeTab === "refused" && <AdminRefusedActual />}
      {activeTab === "providers" && <AdminProviders />}
      {activeTab === "clients" && <AdminClients />}
    </div>
  );
}
