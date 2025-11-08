//frontend/src/hooks/useLockBodyScroll.js

import { useLayoutEffect } from "react";

export default function useLockBodyScroll(locked) {
  useLayoutEffect(() => {
    const { body } = document;
    if (!locked) return;
    const prev = body.style.overflow;
    body.style.overflow = "hidden";
    return () => { body.style.overflow = prev; };
  }, [locked]);
}
