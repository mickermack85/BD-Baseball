import Link from "next/link";
import { Mic2, RefreshCw } from "lucide-react";
import { flattenGames, gameHeadline, getTodaysSchedule, todayMlbDate } from "@/lib/mlb";

export const revalidate = 60;

export default async function ShowPage() {
  const date = todayMlbDate();
  const scheduleResult = await getTodaysSchedule(date)
    .then((schedule) => ({ schedule, error: null }))
    .catch((error: unknown) => ({ schedule: null, error }));
  const games = scheduleResult.schedule ? flattenGames(scheduleResult.schedule) : [];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/10 p-8">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.25em] text-emerald-200">
          <Mic2 size={18} /> Show rundown
        </p>
        <h1 className="text-4xl font-black">Tonight&apos;s blocks</h1>
        <p className="mt-3 text-slate-300">A clean rundown scaffold generated from the live slate.</p>
      </section>

      {scheduleResult.error ? (
        <section className="rounded-3xl border border-amber-300/30 bg-amber-500/10 p-6">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-amber-200">
            <RefreshCw size={16} /> Slate temporarily unavailable
          </p>
          <p className="mt-3 text-slate-300">
            The live slate could not be loaded. Refresh shortly; no snapshot fallback is used.
          </p>
        </section>
      ) : null}

      <ol className="space-y-4">
        <li className="rounded-3xl border border-white/10 bg-ink/70 p-6">
          <strong>Open:</strong> Lead with slate size ({games.length}), weather/watch spots, and biggest public games.
        </li>
        {games.length === 0 ? (
          <li className="rounded-3xl border border-white/10 bg-ink/70 p-6">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">Empty slate</p>
            <p className="mt-2 text-slate-300">
              No MLB games are currently listed for {date}. Use this block for league-wide news, standings, injuries,
              and tomorrow&apos;s pitching probables.
            </p>
          </li>
        ) : (
          games.map((game, index) => (
            <li key={game.gamePk} className="rounded-3xl border border-white/10 bg-ink/70 p-6">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">Block {index + 1}</p>
              <Link href={`/game/${game.gamePk}`} className="mt-2 block text-2xl font-black hover:text-emerald-200">
                {gameHeadline(game)}
              </Link>
              <p className="mt-2 text-slate-300">
                Angle: pitching matchup, lineup context, injury/news check, then betting market watch.
              </p>
            </li>
          ))
        )}
        <li className="rounded-3xl border border-white/10 bg-ink/70 p-6">
          <strong>Close:</strong> Best audience questions, tomorrow tease, and final picks.
        </li>
      </ol>
    </div>
  );
}
