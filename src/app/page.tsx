import Link from "next/link";
import { CalendarDays, Clock, MapPin, RefreshCw } from "lucide-react";
import { flattenGames, gameHeadline, getTodaysSchedule, todayMlbDate } from "@/lib/mlb";

export const revalidate = 60;

function gameTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export default async function DashboardPage() {
  const date = todayMlbDate();
  const scheduleResult = await getTodaysSchedule(date)
    .then((schedule) => ({ schedule, error: null }))
    .catch((error: unknown) => ({ schedule: null, error }));
  const games = scheduleResult.schedule ? flattenGames(scheduleResult.schedule) : [];

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl shadow-black/20">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.25em] text-emerald-200">
          <CalendarDays size={18} /> Today&apos;s MLB slate
        </p>
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">Live board for show prep.</h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-300">
          Pulled server-side from the MLB Stats API with incremental revalidation. No snapshots, no database, no
          client secrets.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-ink/70 p-6">
          <p className="text-sm text-slate-400">Date</p>
          <p className="mt-2 text-2xl font-black">{date}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-ink/70 p-6">
          <p className="text-sm text-slate-400">Games</p>
          <p className="mt-2 text-2xl font-black">{scheduleResult.schedule?.totalGames ?? 0}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-ink/70 p-6">
          <p className="text-sm text-slate-400">Data source</p>
          <p className="mt-2 text-2xl font-black">MLB Stats API</p>
        </div>
      </section>

      {scheduleResult.error ? (
        <section className="rounded-3xl border border-amber-300/30 bg-amber-500/10 p-6">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-amber-200">
            <RefreshCw size={16} /> Slate temporarily unavailable
          </p>
          <h2 className="mt-3 text-2xl font-black text-white">Unable to load the live MLB schedule right now.</h2>
          <p className="mt-2 text-slate-300">
            Refresh in a minute. The app is still using the MLB Stats API directly and does not fall back to stored
            snapshots.
          </p>
        </section>
      ) : games.length === 0 ? (
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-black text-white">No MLB games scheduled for {date}.</h2>
          <p className="mt-2 text-slate-300">The dashboard is ready and will populate automatically when games appear.</p>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {games.map((game) => (
            <Link
              key={game.gamePk}
              href={`/game/${game.gamePk}`}
              className="group rounded-3xl border border-white/10 bg-white/5 p-6 hover:border-emerald-300 hover:bg-white/10"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">
                    {game.status.detailedState ?? "Scheduled"}
                  </p>
                  <h2 className="mt-2 text-2xl font-black text-white">{gameHeadline(game)}</h2>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold">#{game.gamePk}</span>
              </div>
              <div className="mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <p className="flex items-center gap-2">
                  <Clock size={16} /> {gameTime(game.gameDate)}
                </p>
                <p className="flex items-center gap-2">
                  <MapPin size={16} /> {game.venue?.name ?? "Venue TBA"}
                </p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Away</p>
                  <p className="text-lg font-bold">{game.teams.away.team.name}</p>
                  <p className="text-sm text-slate-300">SP: {game.teams.away.probablePitcher?.fullName ?? "TBD"}</p>
                </div>
                <div className="rounded-2xl bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Home</p>
                  <p className="text-lg font-bold">{game.teams.home.team.name}</p>
                  <p className="text-sm text-slate-300">SP: {game.teams.home.probablePitcher?.fullName ?? "TBD"}</p>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
