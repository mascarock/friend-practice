import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Budget · Paola",
  description: "Your approved budget, local spending, and remaining balance. Everything stays on this computer.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body className="antialiased">{children}</body></html>;
}
