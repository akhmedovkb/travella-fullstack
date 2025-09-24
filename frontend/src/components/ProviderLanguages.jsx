import React, { useEffect, useMemo, useState } from "react";
import Select, { components } from "react-select";   // ⬅ добавили { components }
import ISO6391 from "iso-639-1";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

/** кастомный input, который гасит автозаполнение браузера */
const NoAutoCompleteInput = (props) => (
  <components.Input
    {...props}
    autoComplete="off"
    spellCheck={false}
    id="languages-input"           // хитрость против Chrome
    name="languages-input"
  />
);

/** Превращаем ["ru","en"] -> [{value:"ru",label:"Русский (ru)"}, ...] */
const toOptions = (codes, uiLang = "en") =>
  (codes || []).map((code) => {
    const native = ISO6391.getNativeName(code) || ISO6391.getName(code) || code;
    const ruNameMap = { en:"Английский",ru:"Русский",uz:"Узбекский",de:"Немецкий",fr:"Французский",es:"Испанский",tr:"Турецкий",ar:"Арабский",zh:"Китайский",ja:"Японский",it:"Итальянский",hi:"Хинди",fa:"Персидский",id:"Индонезийский",kk:"Казахский" };
    const label = uiLang?.startsWith("ru") ? `${ruNameMap[code] || native} (${code})` : `${native} (${code})`;
    return { value: code, label };
  });

const allLanguageOptions = (uiLang = "en") => {
  const codes = ISO6391.getAllCodes();
  const opts = toOptions(codes, uiLang);
  return opts.sort((a, b) => a.label.localeCompare(b.label, uiLang || "en"));
};

const ProviderLanguages = ({ token }) => {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState([]);

  const cfg = useMemo(() => {
    const stored = token || localStorage.getItem("providerToken") || localStorage.getItem("token");
    return { headers: { Authorization: `Bearer ${stored}` } };
  }, [token]);

  const options = useMemo(() => allLanguageOptions(i18n.language || "en"), [i18n.language]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await axios.get(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`,
          cfg
        );
        if (cancel) return;
        const codes = Array.isArray(data?.languages) ? data.languages : [];
        setSelected(codes);
      } catch (e) {
        console.error("load languages error", e);
        toast.error(t("languages.load_error", { defaultValue: "Не удалось загрузить языки" }));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => void (cancel = true);
  }, [cfg, t]);

  const selectedOptions = useMemo(
    () => toOptions(selected, i18n.language || "en"),
    [selected, i18n.language]
  );

  const handleChange = (vals) => setSelected((vals || []).map((v) => v.value));

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/profile`,
        { languages: selected },
        cfg
      );
      toast.success(t("languages.saved", { defaultValue: "Языки сохранены" }));
    } catch (e) {
      console.error("save languages error", e);
      toast.error(t("languages.save_error", { defaultValue: "Ошибка сохранения языков" }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-md" autoComplete="off">{/* страховка */}
      <h3 className="text-lg font-semibold text-gray-800 mb-3">
        {t("languages.heading", { defaultValue: "Владение языками" })}
      </h3>

      <div className="mb-3">
        {/* медовая ловушка против автозаполнения e-mail в Chrome (невидимое поле) */}
        <input type="text" name="prevent_autofill" autoComplete="username" className="hidden" />

        <Select
          isMulti
          isClearable
          isLoading={loading}
          options={options}
          value={selectedOptions}
          onChange={handleChange}
          placeholder={t("languages.placeholder", { defaultValue: "Начните вводить язык…" })}
          classNamePrefix="rs"
          inputId="languages-input"       // те же id/name, что и в кастомном Input
          name="languages-input"
          components={{ Input: NoAutoCompleteInput }}
          styles={{
            control: (base) => ({ ...base, minHeight: 44, borderColor: "#d1d5db", boxShadow: "none" }),
            menu: (base) => ({ ...base, zIndex: 50 }),
          }}
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-60"
      >
        {saving
          ? t("common.saving", { defaultValue: "Сохранение…" })
          : t("common.save", { defaultValue: "Сохранить" })}
      </button>
    </div>
  );
};

export default ProviderLanguages;
