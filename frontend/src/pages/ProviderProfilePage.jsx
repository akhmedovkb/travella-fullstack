// frontend/src/pages/ProviderProfilePage.jsx
import React from "react";
import ProviderProfile from "../components/ProviderProfile";

export default function ProviderProfilePage() {
  return (
    <main className="p-4 md:p-6 bg-gray-50 min-h-[calc(var(--vh,1vh)*100)] pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-6xl mx-auto">
        <ProviderProfile />
      </div>
    </main>
  );
}
