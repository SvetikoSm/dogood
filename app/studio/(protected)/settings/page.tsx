import { isStudioMockMode } from "@/lib/studio/env";
import { getGoogleOpsClients, getSpreadsheetId } from "@/lib/ops/google-client";

export default function StudioSettingsPage() {
  const google = Boolean(getGoogleOpsClients());
  const sheet = Boolean(getSpreadsheetId());
  const mock = isStudioMockMode();

  return (
    <div className="space-y-6">
      <h1 className="font-semibold text-2xl tracking-tight">Settings</h1>
      <p className="text-sm text-zinc-400">
        Здесь только индикаторы: что реально видит сервер из переменных окружения (см.{" "}
        <code className="text-zinc-300">.env.local</code> и{" "}
        <code className="text-zinc-300">.env.example</code>).
      </p>
      <ul className="space-y-3 text-sm text-zinc-300">
        <li>
          <span className="text-zinc-500">Google service account:</span>{" "}
          <span className={google ? "text-emerald-400" : "text-amber-400"}>
            {google ? "есть (GOOGLE_SERVICE_ACCOUNT_JSON)" : "нет"}
          </span>
          {!google ? (
            <span className="mt-1 block text-xs text-zinc-500">
              Без этого не будет синка таблицы и загрузки фото с Диска. Добавь JSON сервисного
              аккаунта в <code className="text-zinc-400">.env.local</code> и перезапусти{" "}
              <code className="text-zinc-400">npm run dev</code>.
            </span>
          ) : null}
        </li>
        <li>
          <span className="text-zinc-500">Spreadsheet id:</span>{" "}
          <span className={sheet ? "text-emerald-400" : "text-amber-400"}>
            {sheet ? "задан (GOOGLE_SHEETS_SPREADSHEET_ID)" : "нет"}
          </span>
          {!sheet ? (
            <span className="mt-1 block text-xs text-zinc-500">
              ID таблицы с заказами — в той же <code className="text-zinc-400">.env.local</code>.
            </span>
          ) : null}
        </li>
        <li>
          <span className="text-zinc-500">Studio mock AI:</span>{" "}
          <span className={mock ? "text-amber-300" : "text-emerald-400"}>
            {mock ? "ON (STUDIO_MOCK_AI=true)" : "выкл"}
          </span>
          {mock ? (
            <span className="mt-1 block text-xs text-zinc-500">
              Режим заглушек: без реальных вызовов к LLM/картинкам. Для боевого пайплайна убери или
              поставь <code className="text-zinc-400">false</code>, добавь{" "}
              <code className="text-zinc-400">OPENROUTER_API_KEY</code> и модели в{" "}
              <code className="text-zinc-400">.env.local</code>.
            </span>
          ) : null}
        </li>
      </ul>
    </div>
  );
}
