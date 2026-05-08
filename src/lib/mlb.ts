import { z } from "zod";

const MLB_BASE_URL = (process.env.MLB_STATS_API_BASE_URL ?? "https://statsapi.mlb.com").replace(/\/$/, "");
const DEFAULT_REVALIDATE_SECONDS = 60;

const OptionalStringSchema = z.preprocess((value) => (value === null ? undefined : value), z.string().optional());
const OptionalNumberSchema = z.preprocess((value) => (value === null ? undefined : value), z.number().optional());

function optionalObject<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === null ? undefined : value), schema.optional());
}

const TeamSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    abbreviation: OptionalStringSchema,
    teamName: OptionalStringSchema,
  })
  .passthrough();

const ProbablePitcherSchema = z.object({ fullName: z.string() }).passthrough();

const GameSchema = z
  .object({
    gamePk: z.number(),
    gameDate: z.string(),
    status: z
      .object({
        abstractGameState: OptionalStringSchema,
        detailedState: OptionalStringSchema,
      })
      .passthrough(),
    teams: z.object({
      away: z
        .object({
          team: TeamSchema,
          score: OptionalNumberSchema,
          probablePitcher: optionalObject(ProbablePitcherSchema),
        })
        .passthrough(),
      home: z
        .object({
          team: TeamSchema,
          score: OptionalNumberSchema,
          probablePitcher: optionalObject(ProbablePitcherSchema),
        })
        .passthrough(),
    }),
    venue: optionalObject(z.object({ name: z.string() }).passthrough()),
  })
  .passthrough();

const ScheduleSchema = z
  .object({
    totalGames: z.number().default(0),
    dates: z
      .array(
        z
          .object({
            date: z.string(),
            games: z.array(GameSchema).default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const GamePkSchema = z.coerce.number().int().positive();
const LiveFeedSchema = z.record(z.unknown());

export type MlbGame = z.infer<typeof GameSchema>;
export type MlbSchedule = z.infer<typeof ScheduleSchema>;

export class MlbApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MlbApiError";
  }
}

export function todayMlbDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function parseGamePk(gamePk: string) {
  const parsed = GamePkSchema.safeParse(gamePk);
  return parsed.success ? parsed.data : null;
}

export function teamLabel(team: MlbGame["teams"]["home"]["team"]) {
  return team.abbreviation ?? team.teamName ?? team.name;
}

async function mlbFetch(path: string, revalidate = DEFAULT_REVALIDATE_SECONDS): Promise<unknown> {
  const response = await fetch(`${MLB_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate },
  });

  if (!response.ok) {
    throw new MlbApiError(`MLB Stats API request failed: ${response.status} ${response.statusText}`, response.status);
  }

  return response.json();
}

export async function getTodaysSchedule(date = todayMlbDate()) {
  const params = new URLSearchParams({
    sportId: "1",
    date,
    hydrate: "team,probablePitcher,linescore,venue",
  });
  const payload = await mlbFetch(`/api/v1/schedule?${params.toString()}`);
  return ScheduleSchema.parse(payload);
}

export async function getLiveFeed(gamePk: string) {
  const id = parseGamePk(gamePk);

  if (id === null) {
    throw new MlbApiError("Invalid MLB game id.", 400);
  }

  const payload = await mlbFetch(`/api/v1.1/game/${id}/feed/live`, 15);
  return LiveFeedSchema.parse(payload);
}

export function flattenGames(schedule: MlbSchedule) {
  return schedule.dates.flatMap((date) => date.games);
}

export function gameHeadline(game: MlbGame) {
  return `${teamLabel(game.teams.away.team)} at ${teamLabel(game.teams.home.team)}`;
}
