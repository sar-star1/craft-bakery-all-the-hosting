"use client";

import { useEffect } from "react";

// Last-resort screen for the dashboard: a clear message and a way back, instead of Next's blank
// "Application error" page. The usual cause is a save that the server refused (e.g. a photo over 4 MB).
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex items-center justify-center px-6 text-stone-900">
      <div className="max-w-md text-center">
        <p className="font-serif text-xl mb-2">Щось пішло не так</p>
        <p className="text-stone-600 text-sm mb-2">
          Зміни могли не зберегтися. Якщо ви щойно додавали товар із фото — фото могло бути завеликим (понад 4 МБ): оберіть
          менше або стисніть його.
        </p>
        <p className="text-stone-400 text-[12px] mb-5">Якщо помилка повторюється — зробіть знімок екрана й надішліть розробнику.</p>
        <div className="flex gap-2 justify-center">
          <button onClick={reset} className="text-sm bg-stone-900 text-white px-4 py-2 rounded hover:bg-stone-800">
            Спробувати знову
          </button>
          <a href="/menu" className="text-sm border border-stone-300 px-4 py-2 rounded hover:bg-stone-50">
            До меню сайту
          </a>
        </div>
      </div>
    </div>
  );
}
