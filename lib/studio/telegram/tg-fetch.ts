import "server-only";

import net from "node:net";
import tls from "node:tls";

import { Agent, fetch as undiciFetch } from "undici";

/**
 * fetch для api.telegram.org с обходом DPI-блокировки.
 *
 * Хостинг VPS (Timeweb) режет исходящие TLS-соединения Node к Telegram по
 * отпечатку ClientHello: curl с того же сервера проходит стабильно, а обычный
 * fetch/undici зависает на connect (UND_ERR_CONNECT_TIMEOUT) в большинстве
 * попыток. Разбиение первой TLS-записи (ClientHello с plaintext SNI) на два
 * TCP-пакета обманывает DPI — проверено с VPS: plain Node флапает, а
 * фрагментированный вариант отвечает 6/6. Тот же приём, что в
 * `lib/payments/dpi-safe-fetch.ts` для lknpd.nalog.ru, но здесь полный fetch
 * (undici) — нужны FormData (sendPhoto) и бинарные ответы (скачивание фото).
 *
 * Дополняет пин IP в /etc/hosts (scripts/tg-ip-pin.sh): пин выбирает доступную
 * подсеть Telegram, фрагментация лечит DPI-фильтр на самом соединении.
 */
const fragmentedAgent = new Agent({
  connect(opts, callback) {
    const host = opts.hostname;
    const socket = net.connect({ host, port: Number(opts.port) || 443 });
    socket.setNoDelay(true);

    let helloSent = false;
    const rawWrite = socket.write.bind(socket);
    socket.write = ((data: unknown, encoding?: unknown, cb?: unknown) => {
      if (!helloSent && Buffer.isBuffer(data) && data.length > 20) {
        helloSent = true;
        rawWrite(data.subarray(0, 5));
        return rawWrite(data.subarray(5), encoding as BufferEncoding, cb as () => void);
      }
      return rawWrite(data as Buffer, encoding as BufferEncoding, cb as () => void);
    }) as typeof socket.write;

    const tlsSocket = tls.connect({
      socket,
      servername: opts.servername || host,
      ALPNProtocols: ["http/1.1"],
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      tlsSocket.destroy();
      callback(new Error("tgFetch: connect timeout"), null);
    }, 10_000);
    tlsSocket.once("secureConnect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(null, tlsSocket);
    });
    tlsSocket.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(err, null);
    });
  },
});

/**
 * Drop-in замена глобального fetch для запросов к api.telegram.org.
 *
 * Сетевые сбои ретраятся до 3 раз: даже с фрагментацией провайдер изредка
 * роняет сам TCP-connect (~1 раз в несколько минут), а потерянный ответ
 * клиенту (макет, ссылка на оплату, чек) стоит дороже пары секунд ожидания.
 * HTTP-ошибки (4xx/5xx от Telegram) не ретраятся — их разбирает вызывающий код.
 */
export async function tgFetch(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await undiciFetch(url, {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher: fragmentedAgent,
      } as Parameters<typeof undiciFetch>[1]);
      return res as unknown as Response;
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw lastError;
}
