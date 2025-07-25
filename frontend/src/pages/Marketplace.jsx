import React, { useState } from "react";
import { useTranslation } from "react-i18next";

const boardBlocks = [
  { id: "guide", label: "ГИД" },
  { id: "transport", label: "ТРАНСПОРТ" },
  { id: "tour", label: "ОТКАЗНОЙ ТУР" },
  { id: "hotel", label: "ОТКАЗНОЙ ОТЕЛЬ" },
  { id: "flight", label: "ОТКАЗНОЙ АВИАБИЛЕТ" },
  { id: "event", label: "ОТКАЗНОЙ БИЛЕТ" },
];

const MarketplaceBoard = () => {
  const { t } = useTranslation();
  const [activeBlock, setActiveBlock] = useState(null);
  const [filters, setFilters] = useState({ start: "", end: "", location: "", people: 1 });

  const handleBlockClick = (id) => {
    setActiveBlock(activeBlock === id ? null : id);
  };

  const handleChange = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleSearch = () => {
    console.log("🔎 Search filters:", { category: activeBlock, ...filters });
    // Добавим логику фильтрации
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-4 text-center">🎯 Доска объявлений</h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-6">
        {boardBlocks.map((block) => (
          <div
            key={block.id}
            className={`cursor-pointer border rounded-xl py-4 px-2 text-center font-semibold shadow-sm hover:shadow-md transition-all duration-200 ${
              activeBlock === block.id ? "bg-orange-500 text-white" : "bg-white"
            }`}
            onClick={() => handleBlockClick(block.id)}
          >
            {block.label}
          </div>
        ))}
      </div>

      {activeBlock && (
        <div className="bg-white border rounded-xl p-4 shadow-md">
          <h3 className="text-xl font-semibold mb-4">🔍 Поиск по категории: {boardBlocks.find(b => b.id === activeBlock)?.label}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium">Дата начала</label>
              <input
                type="date"
                name="start"
                value={filters.start}
                onChange={handleChange}
                className="border px-3 py-2 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Дата окончания</label>
              <input
                type="date"
                name="end"
                value={filters.end}
                onChange={handleChange}
                className="border px-3 py-2 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Локация</label>
              <input
                type="text"
                name="location"
                placeholder="Например: Самарканд"
                value={filters.location}
                onChange={handleChange}
                className="border px-3 py-2 rounded w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Количество человек</label>
              <input
                type="number"
                min={1}
                name="people"
                value={filters.people}
                onChange={handleChange}
                className="border px-3 py-2 rounded w-full"
              />
            </div>
          </div>

          <button
            onClick={handleSearch}
            className="bg-orange-500 text-white px-6 py-2 rounded font-bold hover:bg-orange-600"
          >
            Искать
          </button>
        </div>
      )}
    </div>
  );
};

export default MarketplaceBoard;
