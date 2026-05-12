import Link from "next/link";

import { isStudioAuthConfigured } from "@/lib/studio/auth-password";

import { StudioLoginForm } from "@/components/studio/studio-login-form";

/** Env читается на сервере при каждом запросе — иначе при сборке/кэше форма могла «залипнуть» выключенной. */
export const dynamic = "force-dynamic";

export default function StudioLoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-xl">
        <div>
          <h1 className="font-semibold tracking-tight text-xl">DoGood Studio</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Внутренняя панель пайплайна. Пароль задаётся в переменной{" "}
            <code className="rounded bg-zinc-800 px-1">STUDIO_ADMIN_PASSWORD</code> (файл{" "}
            <code className="rounded bg-zinc-800 px-1">.env.local</code> в корне проекта).
          </p>
        </div>
        {!isStudioAuthConfigured() ? (
          <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-amber-100 text-sm leading-relaxed">
            <p className="font-medium text-amber-200">
              Сервер пока не видит <code className="rounded bg-zinc-900 px-1">STUDIO_ADMIN_PASSWORD</code> — проверь{" "}
              <code className="rounded bg-zinc-900 px-1">.env.local</code> в той же папке, откуда запускаешь{" "}
              <code className="rounded bg-zinc-900 px-1">npm run dev</code>, и перезапусти dev. Поле пароля ниже всё
              равно можно попробовать.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-amber-100/90">
              <li>
                Открой в проекте файл <code className="rounded bg-zinc-900 px-1">.env.local</code>
              </li>
              <li>
                Добавь строку:{" "}
                <code className="block mt-1 rounded bg-zinc-900 px-2 py-1 text-xs">
                  STUDIO_ADMIN_PASSWORD=твой_секретный_пароль
                </code>
              </li>
              <li>
                Добавь секрет для cookie (любая длинная случайная строка):{" "}
                <code className="block mt-1 rounded bg-zinc-900 px-2 py-1 text-xs">
                  STUDIO_SESSION_SECRET=ещё_одна_длинная_случайная_строка
                </code>
                <span className="text-amber-200/80"> или используй уже заданный </span>
                <code className="rounded bg-zinc-900 px-1">REVIEW_SESSION_SECRET</code>
              </li>
              <li>
                Останови и снова запусти <code className="rounded bg-zinc-900 px-1">npm run dev</code>
              </li>
              <li>Обнови эту страницу и войди паролем из шага 2</li>
            </ol>
            <p className="mt-2 text-xs text-amber-200/70">
              Если открываешь не localhost, а сайт на хостинге — те же переменные нужно добавить в
              панели хостинга (Environment variables), не только в .env.local.
            </p>
          </div>
        ) : null}
        <StudioLoginForm />
        <p className="text-center text-xs text-zinc-500">
          <Link href="/" className="underline hover:text-zinc-300">
            ← Back to site
          </Link>
        </p>
      </div>
    </div>
  );
}
