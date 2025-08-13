// frontend/src/pages/ProviderRequests.jsx
import ProviderInboxList from "../components/ProviderInboxList";

export default function ProviderRequests() {
  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <ProviderInboxList showHeader />
    </div>
  );
}
