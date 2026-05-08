import { Newspaper } from "lucide-react";

export default function NewsPage() {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/10 p-8">
      <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.25em] text-emerald-200">
        <Newspaper size={18} aria-hidden="true" /> News
      </p>
      <h1 className="text-4xl font-black">News hub coming soon</h1>
      <p className="mt-3 max-w-2xl text-slate-300">
        This route is ready for live MLB news sources. The v2 preview keeps it as a stable, production-safe placeholder
        with no auth, database, AI, or snapshot dependency.
      </p>
    </section>
  );
}
