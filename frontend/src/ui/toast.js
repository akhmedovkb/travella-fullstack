// Unified toast wrapper (react-hot-toast)
import { toast as _toast } from "react-hot-toast";

export const toast = (msg, opts) => _toast(msg, opts);
export const toastSuccess = (msg, opts) => _toast.success(msg, opts);
export const toastError   = (msg, opts) => _toast.error(msg, opts);
export const toastInfo    = (msg, opts) => _toast(msg, opts);
export const toastWarn    = (msg, opts) => _toast(msg, opts);
export const toastPromise = (p, labels, opts) => _toast.promise(p, labels, opts);
export const toastCustom  = (render, opts) => _toast.custom(render, opts);

export default {
  toast,
  success: toastSuccess,
  error: toastError,
  info: toastInfo,
  warn: toastWarn,
  promise: toastPromise,
  custom: toastCustom,
};
