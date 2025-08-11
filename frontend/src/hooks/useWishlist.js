import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";

export function useWishlist() {
  const [ids, setIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await apiGet("/api/wishlist", true);
        if (mounted) setIds(new Set(res.ids || []));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const toggle = async (id) => {
    const has = ids.has(id);
    setIds(prev => {
      const next = new Set(prev);
      has ? next.delete(id) : next.add(id);
      return next;
    });
    try {
      await apiPost("/api/wishlist/toggle", { item_type: "service", item_id: id }, true);
    } catch {
      // rollback
      setIds(prev => {
        const next = new Set(prev);
        has ? next.add(id) : next.delete(id);
        return next;
      });
    }
  };

  return { ids, toggle, loading };
}
