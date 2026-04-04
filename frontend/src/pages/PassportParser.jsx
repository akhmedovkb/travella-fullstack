//frontend/src/pages/PassportParser.jsx
  
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000";

export default function PassportParser() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const successCount = useMemo(
    () => results.filter((item) => item.success && item.row).length,
    [results]
  );

  const failCount = useMemo(
    () => results.filter((item) => !item.success).length,
    [results]
  );

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles(selected);
    setResults([]);
    setError("");
  };

  const handleParse = async () => {
    if (!files.length) {
      setError("Сначала выбери файлы паспортов.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file);
      });

      const res = await fetch(`${API_BASE}/api/passport/parse`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Ошибка при распознавании");
      }

      setResults(Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      setError(err.message || "Не удалось обработать файлы");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadExcel = () => {
    const rows = results
      .filter((item) => item.success && item.row)
      .map((item) => ({
        TYPE: item.row.TYPE || "",
        TITLE: item.row.TITLE || "",
        "FIRST NAME": item.row.FIRST_NAME || "",
        "LAST NAME": item.row.LAST_NAME || "",
        DOB: item.row.DOB || "",
        GENDER: item.row.GENDER || "",
        CITIZENSHIP: item.row.CITIZENSHIP || "",
        "DOCUMENT TYPE": item.row.DOCUMENT_TYPE || "",
        "DOCUMENT NUMBER": item.row.DOCUMENT_NUMBER || "",
        "DOCUMENT ISSUE COUNTRY": item.row.DOCUMENT_ISSUE_COUNTRY || "",
        NATIONALITY: item.row.NATIONALITY || "",
        "ISSUE DATE": item.row.ISSUE_DATE || "",
        "EXPIRY DATE": item.row.EXPIRY_DATE || "",
        "SOURCE FILE": item.fileName || "",
      }));

    if (!rows.length) {
      setError("Нет данных для экспорта.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Passports");
    XLSX.writeFile(workbook, "passports_result.xlsx");
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">
            Passport Parser
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Загрузи фото паспортов, распознай данные и скачай результат в Excel.
          </p>

          <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-4">
              <input
                id="passport-files"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />

              <label
                htmlFor="passport-files"
                className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Выбрать файлы
              </label>

              <span className="text-sm text-gray-600">
                {files.length
                  ? `Выбрано файлов: ${files.length}`
                  : "Файл не выбран"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={handleParse}
                disabled={loading}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Распознаём..." : "Распознать"}
              </button>

              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={!successCount}
                className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Скачать Excel
              </button>
            </div>
          </div>

          {!!error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Всего результатов</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">
              {results.length}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Успешно</div>
            <div className="mt-2 text-3xl font-semibold text-emerald-600">
              {successCount}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">Ошибки</div>
            <div className="mt-2 text-3xl font-semibold text-red-600">
              {failCount}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left">Файл</th>
                  <th className="px-4 py-3 text-left">Статус</th>
                  <th className="px-4 py-3 text-left">Имя</th>
                  <th className="px-4 py-3 text-left">Фамилия</th>
                  <th className="px-4 py-3 text-left">Дата рождения</th>
                  <th className="px-4 py-3 text-left">Пол</th>
                  <th className="px-4 py-3 text-left">Номер паспорта</th>
                  <th className="px-4 py-3 text-left">Гражданство</th>
                  <th className="px-4 py-3 text-left">Срок действия</th>
                </tr>
              </thead>

              <tbody>
                {!results.length ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-gray-500"
                    >
                      Пока нет результатов
                    </td>
                  </tr>
                ) : (
                  results.map((item, index) => {
                    const row = item.row || {};
                    return (
                      <tr
                        key={`${item.fileName || "row"}-${index}`}
                        className="border-t"
                      >
                        <td className="px-4 py-3">{item.fileName || "-"}</td>
                        <td className="px-4 py-3">
                          {item.success ? (
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                              OK
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                              Ошибка
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">{row.FIRST_NAME || "-"}</td>
                        <td className="px-4 py-3">{row.LAST_NAME || "-"}</td>
                        <td className="px-4 py-3">{row.DOB || "-"}</td>
                        <td className="px-4 py-3">{row.GENDER || "-"}</td>
                        <td className="px-4 py-3">
                          {row.DOCUMENT_NUMBER || "-"}
                        </td>
                        <td className="px-4 py-3">
                          {row.CITIZENSHIP || "-"}
                        </td>
                        <td className="px-4 py-3">{row.EXPIRY_DATE || "-"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {!!results.length && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              Ошибки распознавания
            </h2>
            <div className="mt-4 space-y-3">
              {results.filter((item) => !item.success).length === 0 ? (
                <div className="text-sm text-gray-500">Ошибок нет.</div>
              ) : (
                results
                  .filter((item) => !item.success)
                  .map((item, index) => (
                    <div
                      key={`${item.fileName || "error"}-${index}`}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                    >
                      <div className="font-medium">{item.fileName || "-"}</div>
                      <div className="mt-1">
                        {item.message || "Ошибка обработки"}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
