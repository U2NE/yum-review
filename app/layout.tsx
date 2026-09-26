import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "한입기록",
    template: "%s · 한입기록",
  },
  description: "식당보다 메뉴를 중심으로, 먹어본 사람들의 기록을 모읍니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
