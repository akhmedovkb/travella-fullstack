// frontend/src/pages/admin/AdminOperations.jsx
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  BadgeCheck,
  ClipboardCheck,
  ContactRound,
  Hotel,
  ListChecks,
  UserRoundSearch,
  UsersRound,
} from "lucide-react";
import AdminModeration from "../AdminModeration";
import AdminLeads from "./Leads";
import AdminRefusedActual from "./AdminRefusedActual";
import AdminProviders from "./AdminProviders";
import AdminClients from "./AdminClients";
import AdminServiceAudit from "./AdminServiceAudit";
import AdminHotelInspections from "./AdminHotelInspections";
import AdminProviderFunnel from "./AdminProviderFunnel";

const TABS = [
  {
    id: "moderation",
    label: "Услуги",
    title: "Модерация услуг",
    group: "Контент",
    icon: BadgeCheck,
    hint: "Проверка и управление услугами провайдеров.",
  },
  {
    id: "hotel_inspections",
    label: "Инспекции отелей",
    title: "Модерация инспекций отелей",
    group: "Контент",
    icon: Hotel,
    hint: "Проверка инспекций отелей, фото, видео и причин отклонения.",
  },
  {
    id: "provider_funnel",
    label: "Воронка",
    title: "Воронка поставщиков",
    group: "Поставщики",
    icon: Activity,
    hint: "Где поставщики начинают создание услуг, где бросают и сколько доходит до proof/модерации.",
  },
  {
    id: "leads",
    label: "Лиды",
    title: "Лиды",
    group: "Продажи",
    icon: UserRoundSearch,
    hint: "Новые лиды, подтверждение и конвертация в клиентов/провайдеров.",
  },
  {
    id: "refused",
    label: "Отказные услуги",
    title: "Все отказные услуги",
    group: "Контент",
    icon: ListChecks,
    hint: "Все refused_* услуги: просмотр, фильтрация, продление, удаление и ручная проверка актуальности.",
  },
  {
    id: "providers",
    label: "Провайдеры",
    title: "Провайдеры",
    group: "Поставщики",
    icon: UsersRound,
    hint: "Поиск, просмотр и контроль зарегистрированных провайдеров.",
  },
  {
    id: "clients",
    label: "Клиенты",
    title: "Клиенты",
    group: "Продажи",
    icon: ContactRound,
    hint: "Поиск, просмотр и контроль зарегистрированных клиентов.",
  },
  {
    id: "provider_actions",
    label: "Журнал действий",
    title: "Действия поставщиков",
    group: "Поставщики",
    icon: ClipboardCheck,
    hint: "Журнал действий поставщиков по услугам.",
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
  const groups = ["Контент", "Поставщики", "Продажи"];

  return (
    <div className="min-h-[calc(100vh-72px)] bg-slate-50 px-4 py-5 md:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px] space-y-4">
        <header className="space-y-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-orange-600">
              Операционный центр
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">{activeMeta.title}</h1>
            <p className="mt-1 text-sm text-slate-500">{activeMeta.hint}</p>
          </div>

          <nav aria-label="Разделы операционного центра" className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.65fr)]">
            {groups.map((group) => (
              <div key={group} className="min-w-0">
                <div className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {group}
                </div>
                <div className="flex flex-wrap gap-1">
                  {TABS.filter((tab) => tab.group === group).map((tab) => {
                    const Icon = tab.icon;
                    const selected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setTab(tab.id)}
                        aria-current={selected ? "page" : undefined}
                        className={`inline-flex min-h-9 min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                          selected
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                        }`}
                      >
                        <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                        <span className="min-w-0 break-words">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </header>

        <main className="min-w-0">
          {activeTab === "moderation" && <AdminModeration embedded />}
          {activeTab === "hotel_inspections" && <AdminHotelInspections embedded />}
          {activeTab === "provider_funnel" && <AdminProviderFunnel embedded />}
          {activeTab === "leads" && <AdminLeads />}
          {activeTab === "refused" && <AdminRefusedActual />}
          {activeTab === "providers" && <AdminProviders />}
          {activeTab === "clients" && <AdminClients />}
          {activeTab === "provider_actions" && <AdminServiceAudit embedded />}
        </main>
      </div>
    </div>
  );
}
