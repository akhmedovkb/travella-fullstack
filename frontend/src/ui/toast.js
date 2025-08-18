// unified toast wrapper for the whole app (react-toastify underneath)
// Pages/components should always import from "../ui/toast"
import { toast as _toast } from "react-toastify";

export const toast = (msg, opts) => _toast(msg, opts);
export const toastSuccess = (msg, opts) => _toast.success(msg, opts);
export const toastError   = (msg, opts) => _toast.error(msg, opts);
export const toastInfo    = (msg, opts) => _toast.info(msg, opts);
export const toastWarn    = (msg, opts) => _toast.warn(msg, opts);

export const toastPromise = (promise, { loading, success, error }, opts) =>
  _toast.promise(promise, { loading, success, error }, opts);

export default {
  toast,
  success: toastSuccess,
  error: toastError,
  info: toastInfo,
  warn: toastWarn,
  promise: toastPromise,
};
