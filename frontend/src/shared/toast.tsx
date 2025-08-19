// src/shared/toast.tsx
import React from "react";
import { ToastContainer, toast, Slide } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export const ToastMount: React.FC = () => (
  <ToastContainer
    position="top-right"
    autoClose={3500}
    hideProgressBar
    newestOnTop
    closeOnClick
    pauseOnFocusLoss
    draggable
    pauseOnHover
    theme="light"
    transition={Slide}
  />
);

// Единые обёртки — используй их для одинакового стиля
export const tSuccess = (msg: string, opts?: any) => toast.success(msg, opts);
export const tError   = (msg: string, opts?: any) => toast.error(msg, opts);
export const tInfo    = (msg: string, opts?: any) => toast.info(msg, opts);
export const tWarn    = (msg: string, opts?: any) => toast.warn(msg, opts);
