import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evidence Match",
  description: "Compare candidates against job requirements, with quoted evidence for every claim.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Evidence Match
            </Link>
            <Link
              href="/new"
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
            >
              New job
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
