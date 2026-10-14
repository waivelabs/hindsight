import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // ccc(brand): Cortana title and favicon.
  title: "Cortana",
  description: "Cortana memory control plane",
  icons: {
    icon: "/ccc/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The root layout is a minimal shell. Locale-aware content,
  // providers, and <html lang> are handled in [locale]/layout.tsx.
  return children;
}
