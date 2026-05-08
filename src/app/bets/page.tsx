import { BadgeDollarSign } from "lucide-react";

export default function BetsPage() {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/10 p-8">
      <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.25em] text-emerald-200">
        <BadgeDollarSign size={18} aria-hidden="true" /> Bets
      </p>
      <h1 className="text-4xl font-black">Bets hub coming soon</h1>
      <p className="mt-3 max-w-2xl text-slate-300">
        Odds integrations can land here next. This placeholder keeps the route live without client keys, paid feeds, or
        database requirements.
      </p>
    </section>
  );
}
