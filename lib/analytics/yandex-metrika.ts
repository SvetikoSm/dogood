/** Идентификатор цели в Метрике: Настройки → Цели → JavaScript-событие */
export const YM_GOAL_ORDER_SUBMIT = "order_submit";

export function getYandexMetrikaCounterId(): string {
  return process.env.NEXT_PUBLIC_YM_COUNTER_ID?.trim() || "110047642";
}

/** Инлайн-скрипт в <head> — так проверку проходит робот Метрики/Директа. */
export function yandexMetrikaHeadScript(counterId: string): string {
  return `(function(m,e,t,r,i,k,a){
m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${counterId}', 'ym');
ym(${counterId}, 'init', {ssr:true, webvisor:false, clickmap:true, ecommerce:"dataLayer", accurateTrackBounce:true, trackLinks:true});`;
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
