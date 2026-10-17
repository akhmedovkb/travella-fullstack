import { useEffect, useState } from "react";
import axios from "axios";

export default function useProviderTelegramLink({ botUser, enabled }) {
  const [link, setLink] = useState(null);

  useEffect(() => {
    if (!botUser || !enabled) {
      setLink(null);
      return undefined;
    }

    const controller = new AbortController();
    axios
      .get("/api/providers/telegram-link", { signal: controller.signal })
      .then(({ data }) => {
        if (data?.payload) setLink(`https://t.me/${botUser}?start=${data.payload}`);
      })
      .catch((error) => {
        if (error?.code !== "ERR_CANCELED") {
          console.error("Telegram provider link error:", error);
        }
      });

    return () => controller.abort();
  }, [botUser, enabled]);

  return link;
}
