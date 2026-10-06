"use client";

// Last-resort screen for the ordering page: a friendly message instead of
// Next's generic "Application error" page.
export default function StorefrontError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <p className="text-lg mb-2">Щось пішло не так</p>
        <p className="text-sm text-neutral-500 mb-5">
          Якщо ви щойно надіслали замовлення, воно могло вже бути прийняте — перш ніж надсилати ще раз, звʼяжіться з
          нами. Інакше оновіть сторінку.
        </p>
        <button onClick={reset} className="text-sm border border-neutral-400 px-4 py-2 rounded">
          Спробувати знову
        </button>
      </div>
    </div>
  );
}
