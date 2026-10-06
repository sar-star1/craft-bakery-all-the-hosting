import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Peremoga Bakery — Orders",
  description: "Admin CRM order pipeline for Peremoga Bakery.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body className="bg-[#FAF6EF] text-stone-900 antialiased">{children}</body>
    </html>
  );
}
