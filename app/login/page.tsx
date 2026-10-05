import { login } from "@/app/auth-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Вхід — Craft Bakery by Dubova" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form action={login} className="w-full max-w-sm bg-white rounded-lg border border-stone-200 p-6 shadow-sm">
        <p className="font-serif text-lg leading-tight">Craft Bakery</p>
        <p className="font-serif text-lg leading-tight text-stone-400 italic mb-5">by Dubova</p>

        {error === "config" ? (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            Пароль дашборду не налаштований. Додайте змінну DASHBOARD_PASSWORD у Vercel і перерозгорніть проєкт.
          </p>
        ) : (
          <>
            <input type="hidden" name="next" value={next ?? "/"} />
            <label className="text-[12px] text-stone-500 block mb-1">Пароль</label>
            <input
              type="password"
              name="password"
              autoFocus
              required
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            />
            {error && <p className="text-[12px] text-rose-700 mt-2">Невірний пароль.</p>}
            <button className="mt-4 w-full text-sm bg-stone-900 text-white px-4 py-2 rounded hover:bg-stone-800">
              Увійти
            </button>
          </>
        )}
      </form>
    </div>
  );
}
