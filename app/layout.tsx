import type { Metadata } from "next";
import Script from "next/script";
import {
  getYandexMetrikaCounterId,
  yandexMetrikaHeadScript,
} from "@/lib/analytics/yandex-metrika";
import { CRITICAL_CSS } from "@/lib/critical-css";
import { SafariStylesRecovery } from "@/components/safari-styles-recovery";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOGOOD — streetwear с принтом вашего питомца",
  description:
    "Стильные футболки с портретом питомца. 15% прибыли — в приют на ваш выбор.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fdf4ff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const ymCounterId = getYandexMetrikaCounterId();

  return (
    <html lang="ru" className="h-full antialiased">
      <head>
        <meta httpEquiv="Cache-Control" content="max-age=0, must-revalidate" />
        <style dangerouslySetInnerHTML={{ __html: CRITICAL_CSS }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground antialiased">
        <SafariStylesRecovery />
        {ymCounterId ? (
          <>
            <Script
              id="yandex-metrika"
              strategy="lazyOnload"
              dangerouslySetInnerHTML={{
                __html: yandexMetrikaHeadScript(ymCounterId),
              }}
            />
            <noscript>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://mc.yandex.ru/watch/${ymCounterId}`}
                  style={{ position: "absolute", left: "-9999px" }}
                  alt=""
                />
              </div>
            </noscript>
          </>
        ) : null}
        {children}
      </body>
    </html>
  );
}
