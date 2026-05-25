import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trade Analyzer",
  description: "Analyze MT4 trade ledgers for exploits and behavioural patterns",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
