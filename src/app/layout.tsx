import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HarnessLab",
  description: "Find what actually broke your coding agent.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
