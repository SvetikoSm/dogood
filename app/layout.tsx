import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  /* Меньше начертаний — быстрее первый рендер на мобильных сетях */
  weight: ["400", "600", "700"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "DOGOOD — streetwear с принтом вашего питомца",
  description:
    "Стильные футболки с портретом питомца. 20% прибыли — в приют на ваш выбор.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fdf4ff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${manrope.variable} ${oswald.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
