import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getLiveFeed, parseGamePk } from "@/lib/mlb";

export const revalidate = 15;

type FeedGameData = {
  teams?: {
    away?: { name?: string };
    home?: { name?: string };
  };
  status?: { detailedState?: string };
};

function readGameData(feed: Record<string, unknown>) {
  return feed.gameData as FeedGameData | undefined;
}

function UnavailableGame({ id, message }: { id: string; message: string }) {
  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-200 hover:text-white">
        <ArrowLeft size={16} /> Back to dashboard
      </Link>
      <section className="rounded-3xl border border-amber-300/30 bg-amber-500/10 p-8">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.25em] text-amber-200">
          <AlertTriangle size={18} /> Game unavailable
        </p>
        <h1 className="mt-3 text-4xl font-black">Unable to load game {id}</h1>
        <p className="mt-3 max-w-2xl text-slate-300">{message}</p>
      </section>
    </div>
  );
}

export default async function GameDetailPage({ params }: { params: { id: string } }) {
  if (parseGamePk(params.id) === null) {
    return <UnavailableGame id={params.id} message="This route needs a positive numeric MLB game id." />;
  }

  const feedResult = await getLiveFeed(params.id)
    .then((feed) => ({ feed, error: null }))
    .catch((error: unknown) => ({ feed: null, error }));

  if (feedResult.error || !feedResult.feed) {
    return (
      <UnavailableGame
        id={params.id}
        message="The MLB Stats API did not return a live feed for this id. Check the dashboard for active games and try again."
      />
    );
  }

  const gameData = readGameData(feedResult.feed);
  const away = gameData?.teams?.away?.name ?? "Away team";
  const home = gameData?.teams?.home?.name ?? "Home team";

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-emerald-200 hover:text-white">
        <ArrowLeft size={16} /> Back to dashboard
      </Link>
      <section className="rounded-3xl border border-white/10 bg-white/10 p-8">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-emerald-200">Live feed JSON</p>
        <h1 className="mt-3 text-4xl font-black">
          {away} at {home}
        </h1>
        <p className="mt-3 text-slate-300">
          Status: {gameData?.status?.detailedState ?? "Unknown"} · Game ID {params.id}
        </p>
      </section>
      <pre className="max-h-[70vh] overflow-auto rounded-3xl border border-white/10 bg-black/60 p-5 text-xs leading-relaxed text-emerald-50">
        {JSON.stringify(feedResult.feed, null, 2)}
      </pre>
    </div>
  );
}
