import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Radio } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BD Baseball v2",
  description: "Live MLB slate, game detail, and show prep dashboard.",
};

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/show", label: "Show" },
  { href: "/news", label: "News" },
  { href: "/bets", label: "Bets" },
];

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-8 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/20 backdrop-blur md:flex-row md:items-center md:justify-between">
            <Link href="/" className="flex items-center gap-3 text-xl font-black tracking-tight text-white">
              <span className="rounded-2xl bg-grass p-2 text-white">
                <Radio size={24} aria-hidden="true" />
              </span>
              <span>BD Baseball</span>
              <span className="text-sm font-semibold text-emerald-200">v2 live</span>
            </Link>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold text-slate-200" aria-label="Primary">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full border border-white/10 px-4 py-2 hover:border-emerald-300 hover:text-emerald-200"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
