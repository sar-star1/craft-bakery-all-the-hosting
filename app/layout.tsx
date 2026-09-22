import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Craft Bakery by Dubova — Orders",
  description: "Admin CRM order pipeline for Craft Bakery by Dubova.",
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
