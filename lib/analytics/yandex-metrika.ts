/** Идентификатор цели в Метрике: Настройки → Цели → JavaScript-событие */
export const YM_GOAL_ORDER_SUBMIT = "order_submit";

export function getYandexMetrikaCounterId(): string {
  return process.env.NEXT_PUBLIC_YM_COUNTER_ID?.trim() || "110047642";
}

export function reachYandexGoal(
  goal: string,
  counterId = getYandexMetrikaCounterId(),
): void {
  if (typeof window === "undefined" || !counterId) return;
  const ym = (
    window as Window & {
      ym?: (id: number, method: string, target: string) => void;
    }
  ).ym;
  if (!ym) return;
  ym(Number(counterId), "reachGoal", goal);
}
