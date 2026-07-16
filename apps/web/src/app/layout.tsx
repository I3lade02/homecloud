import type { Metadata } from "next";

import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "PiCloud",

  description: "A private cloud that lives on your hardware.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
