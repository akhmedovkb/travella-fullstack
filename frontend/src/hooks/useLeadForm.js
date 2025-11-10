import React, { useMemo, useState } from "react";
import LeadFormModal from "../components/LeadFormModal";

export function useLeadForm(defaults) {
  const [open, setOpen] = useState(false);
  const modal = useMemo(
    () => (
      <LeadFormModal
        open={open}
        onClose={() => setOpen(false)}
        defaults={defaults}
      />
    ),
    [open, defaults]
  );
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    modal,
  };
}
