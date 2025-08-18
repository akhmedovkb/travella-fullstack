// frontend/src/ui/toast.js
// Единая обёртка для уведомлений на базе react-hot-toast.
// Экспортируем ОРИГИНАЛЬНЫЙ toast, чтобы были доступны .success/.error/.promise/…

import hotToast, { Toaster } from "react-hot-toast";

// Оригинальный toast-инстанс со всеми методами
export const toast = hotToast;
export { Toaster };

// Необязательные алиасы (если где-то удобнее короткие имена)
export const toastSuccess = (msg, opts) => hotToast.success(msg, opts);
export const toastError   = (msg, opts) => hotToast.error(msg, opts);
export const toastInfo    = (msg, opts) => hotToast(msg, opts);
export const toastWarn    = (msg, opts) => hotToast(msg, { icon: "⚠️", ...opts });
export const toastPromise = (promise, labels, opts) =>
  hotToast.promise(promise, labels, opts);

// На случай импорта по умолчанию
export default toast;
