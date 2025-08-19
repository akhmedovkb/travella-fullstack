import { ToastContainer, toast, ToastOptions } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export const TOAST_OPTS: ToastOptions = {
  position: "top-right",
  autoClose: 2500,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
  theme: "colored",
  // если в register/client/register используются классы — оставь те же:
  className: "toast-app",
  progressClassName: "toast-app__progress",
};

export const ToastMount = () => <ToastContainer {...TOAST_OPTS} />;

// единые обёртки
export const tSuccess = (msg: string, opts?: ToastOptions) =>
  toast.success(msg, { ...TOAST_OPTS, ...opts });

export const tError = (msg: string, opts?: ToastOptions) =>
  toast.error(msg, { ...TOAST_OPTS, ...opts });

export const tInfo = (msg: string, opts?: ToastOptions) =>
  toast.info(msg, { ...TOAST_OPTS, ...opts });

export const tWarn = (msg: string, opts?: ToastOptions) =>
  toast.warn(msg, { ...TOAST_OPTS, ...opts });
