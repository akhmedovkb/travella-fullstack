import React, { useRef, useState } from "react";

/**
 * Универсальный загрузчик изображений с превью, удалением и drag&drop сортировкой.
 *
 * props:
 * - images: string[] (dataURL'ы)
 * - setImages: (next: string[]) => void
 * - t: (key: string, vars?: any) => string   // опционально, для i18n
 * - label?: string                            // опционально, если без t
 */
export default function ImageUploader({ images, setImages, t, label }) {
  const inputRef = useRef(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [isOver, setIsOver] = useState(false);

  const tt = (key, fallback) => (t ? t(key) : (label && key === "upload_images" ? label : fallback));

  const readFilesAsDataUrl = (fileList) =>
    Promise.all(
      Array.from(fileList).map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(file);
          })
      )
    );

  const handleFileInput = async (e) => {
    if (!e.target.files?.length) return;
    const base64s = await readFilesAsDataUrl(e.target.files);
    setImages([...(images || []), ...base64s]);
    // очищаем value, чтобы повторный выбор тех же файлов срабатывал
    e.target.value = "";
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    const base64s = await readFilesAsDataUrl(files);
    setImages([...(images || []), ...base64s]);
  };

  const handleDragStart = (e, index) => {
    setDragFrom(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropReorder = (e, dropIndex) => {
    e.preventDefault();
    const from = dragFrom ?? Number(e.dataTransfer.getData("text/plain"));
    if (from === dropIndex || from == null || Number.isNaN(from)) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(dropIndex, 0, moved);
    setImages(next);
    setDragFrom(null);
  };

  const removeAt = (idx) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="mb-4">
      <label className="block font-medium mb-1">
        {tt("upload_images", "Изображения (можно несколько):")}
      </label>

      {/* Зона дропа + кнопка выбора */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={handleDrop}
        className={`mb-3 rounded-lg border-2 border-dashed ${
          isOver ? "border-orange-400 bg-orange-50" : "border-gray-300 bg-white"
        } p-4 flex flex-col items-center justify-center text-center`}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-block bg-orange-500 text-white px-4 py-2 rounded font-medium"
        >
          {tt("choose_files", "Выбрать файлы")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInput}
          className="hidden"
        />
        <div className="mt-2 text-sm text-gray-600">
          {(images?.length ?? 0) > 0
            ? (t ? t("file_chosen", { count: images.length }) : `Выбрано файлов: ${images.length}`)
            : tt("no_files_selected", "Файлы не выбраны")}
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Перетащите сюда файлы для загрузки или используйте кнопку
        </div>
      </div>

      {/* Превью + DnD reorder */}
      <div className="flex gap-2 flex-wrap">
        {images?.map((img, idx) => (
          <div
            key={idx}
            draggable
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropReorder(e, idx)}
            className="relative group w-24 h-24 rounded-lg overflow-hidden border bg-gray-50 cursor-move"
            title="Перетащите, чтобы изменить порядок"
          >
            {/* Номер */}
            <div className="absolute left-1 top-1 z-10 text-xs font-semibold bg-white/90 px-1.5 py-0.5 rounded shadow">
              {idx + 1}
            </div>

            {/* Удалить (hover) */}
            <button
              type="button"
              onClick={() => removeAt(idx)}
              className="absolute right-1 top-1 z-10 w-5 h-5 rounded-full bg-red-600 text-white text-xs leading-5 opacity-0 group-hover:opacity-100 transition"
              title="Удалить"
            >
              ×
            </button>

            {/* Превью */}
            <img
              src={img}
              alt={`preview-${idx}`}
              className="w-full h-full object-cover pointer-events-none select-none"
              draggable={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
