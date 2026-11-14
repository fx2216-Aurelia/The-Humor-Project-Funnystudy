import {
  BoltIcon,
  LockClosedIcon,
  SparklesIcon,
  TrophyIcon,
} from "@heroicons/react/24/solid";
import Link from "next/link";
import type { StudyVoteValue } from "@/lib/caption-votes";
import type { StudyParticipation } from "@/lib/study-participation";
import { parseStudyStats } from "@/lib/study-stats";

export type StudyHighlight = {
  content: string | null;
  id: string;
  imageSrc: string | null;
  rating: StudyVoteValue;
};

const PERSONAS = [
  {
    id: "critic",
    icon: "🧐",
    name: "Tough Critic",
    description: "Hard to impress, but your standards are elite!",
    unlockHint: "Like fewer than 20% of the captions you explore.",
    accent: "from-amber-50/80 to-stone-50 dark:from-amber-200/10 dark:to-stone-900/20",
  },
  {
    id: "speed",
    icon: "⚡",
    name: "Speed Reader",
    description: "You process humor at the speed of light!",
    unlockHint: "Make decisions in under 1.5 seconds.",
    accent: "from-amber-50/70 to-stone-50 dark:from-amber-200/10 dark:to-stone-900/20",
  },
  {
    id: "joy",
    icon: "🌟",
    name: "Joy Spreader",
    description: "You bring positive energy and find humor everywhere!",
    unlockHint: "Like more than 60% of the captions you explore.",
    accent: "from-amber-50/70 to-yellow-50/60 dark:from-amber-200/10 dark:to-yellow-900/15",
  },
  {
    id: "connoisseur",
    icon: "🦉",
    name: "Humor Connoisseur",
    description: "Analytical, nuanced, and refined taste in jokes.",
    unlockHint: "Explore the full range with thoughtful, balanced ratings.",
    accent: "from-amber-50/60 to-emerald-50/40 dark:from-amber-200/10 dark:to-emerald-950/20",
  },
] as const;

function choosePersona(
  likeRate: number,
  viewedCount: number,
  medianDecisionMs: number | null
) {
  if (viewedCount > 0 && likeRate < 20) return "critic";
  if (medianDecisionMs !== null && medianDecisionMs < 1500) return "speed";
  if (likeRate > 60) return "joy";
  return "connoisseur";
}

export function CompletedStudy({
  participation,
  highlights,
  onEdit,
  editHref,
}: {
  participation: StudyParticipation;
  highlights: StudyHighlight[];
  onEdit?: () => void;
  editHref?: string;
}) {
  const stats = parseStudyStats(participation.completion_stats);
  const percentage = stats && stats.viewedCount > 0
    ? Math.round(stats.likedCount / stats.viewedCount * 1000) / 10
    : 0;
  const activePersona = stats
    ? choosePersona(percentage, stats.viewedCount, stats.medianVoteTimeMs)
    : null;

  return (
    <div className="flex h-full min-h-0 w-full max-w-xl flex-1 self-stretch items-stretch sm:max-w-3xl">
      <div className="glass-panel flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-4 text-left text-[var(--foreground)] shadow-[var(--vote-panel-shadow)] sm:p-6">
        <div
          id="completion-stats-scroll-region"
          data-native-scroll-region="true"
          tabIndex={0}
          aria-label="Study highlights and stats"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 pb-3 [-webkit-overflow-scrolling:touch] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
        >
          <div className="text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--surface-muted)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--soft)]">
              <TrophyIcon aria-hidden className="h-4 w-4 text-[var(--accent-gold)]" />
              Study completed
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-[var(--foreground)] sm:text-4xl">
              Your humor,{" "}
              <span className="text-[var(--foreground)]">
                recapped.
              </span>
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--soft)] sm:text-base">
              Thanks for exploring the laughs with us!
            </p>
          </div>

          {stats ? (
            <>
              <section aria-label="Your study stats" className="mt-5">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <StatCard
                    icon="⏱️"
                    label="Time to Smile"
                    value={formatSeconds(stats.medianVoteTimeMs)}
                    detail="Avg. decision speed"
                  />
                  <StatCard
                    icon="🌊"
                    label="Pacing Speed"
                    value={formatSeconds(stats.medianNavigationTimeMs)}
                    detail="Between captions"
                  />
                  <StatCard
                    icon="💛"
                    label="Humor Resonance"
                    value={`${percentage}%`}
                    detail="Funny or hilarious"
                  />
                  <StatCard
                    icon="⭐"
                    label="Favorites Found"
                    value={stats.likedCount.toLocaleString("en-US")}
                    detail="Captions you liked"
                  />
                  <StatCard
                    icon="🔎"
                    label="Total Explored"
                    value={stats.viewedCount.toLocaleString("en-US")}
                    detail="Captions in your journey"
                    className="sm:col-span-2"
                  />
                </div>
              </section>

              <section aria-labelledby="persona-wall-title" className="mt-6">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--soft)]">
                      Your study persona
                    </p>
                    <h2 id="persona-wall-title" className="mt-1 text-xl font-black sm:text-2xl">
                      Personality Trophy Wall
                    </h2>
                  </div>
                  {activePersona ? (
                    <span className="shrink-0 rounded-full border border-[#efe4c6] bg-[#f9f3e3] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[#8c6721] dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-100">
                      1 earned
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PERSONAS.map((persona) => {
                    const isUnlocked = persona.id === activePersona;
                    return (
                      <article
                        key={persona.id}
                        aria-current={isUnlocked ? "true" : undefined}
                        className={`relative overflow-hidden rounded-2xl border p-3 transition ${
                          isUnlocked
                            ? `border-amber-300/90 bg-gradient-to-br ${persona.accent} shadow-[0_8px_24px_rgba(181,139,75,0.12)] ring-1 ring-amber-200/70`
                            : "border-stone-200/70 bg-stone-50/50 text-[var(--muted)] grayscale-[0.55] dark:border-stone-700/70 dark:bg-stone-900/20"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-3xl leading-none" aria-hidden>{persona.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-extrabold">{persona.name}</h3>
                              {isUnlocked ? (
                                <span className="rounded-full border border-[#efe4c6] bg-[#f9f3e3] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#8c6721] dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-100">
                                  Active · Unlocked
                                </span>
                              ) : (
                                <LockClosedIcon aria-label="Locked" className="h-3.5 w-3.5 text-[var(--soft)]" />
                              )}
                            </div>
                            <p className={`mt-1 text-xs leading-5 ${isUnlocked ? "font-semibold text-[var(--foreground)]" : "text-[var(--soft)]"}`}>
                              {isUnlocked ? persona.description : persona.unlockHint}
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <p role="status" className="mt-6 rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">
              Stats weren&apos;t saved for this completed study.
            </p>
          )}

          <section aria-labelledby="highlights-title" className="mt-6">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--soft)]">
                  The ones that landed
                </p>
                <h2 id="highlights-title" className="mt-1 text-xl font-black sm:text-2xl">
                  Your Highlights
                </h2>
              </div>
              {highlights.length ? (
                <span className="text-xs font-semibold text-[var(--soft)]">
                  {highlights.length} top {highlights.length === 1 ? "rating" : "ratings"}
                </span>
              ) : null}
            </div>
            {highlights.length ? (
              <div className="flex snap-x gap-3 overflow-x-auto pb-2">
                {highlights.map((highlight) => (
                  <article
                    key={highlight.id}
                    className="w-[min(76vw,260px)] shrink-0 snap-start overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] shadow-sm"
                  >
                    {highlight.imageSrc ? (
                      <div className="relative flex h-36 items-center justify-center bg-black/5 p-2 dark:bg-white/5">
                        <div
                          role="img"
                          aria-label="Image for this highlighted caption"
                          className="h-full w-full bg-contain bg-center bg-no-repeat"
                          style={{ backgroundImage: `url("${highlight.imageSrc}")` }}
                        />
                      </div>
                    ) : (
                      <div className="flex h-24 items-center justify-center bg-gradient-to-br from-emerald-50 to-amber-50 text-3xl dark:from-emerald-950/30 dark:to-amber-950/30" aria-hidden>
                        <SparklesIcon className="h-8 w-8 text-[var(--accent-gold)]" />
                      </div>
                    )}
                    <div className="p-3">
                      <p className="line-clamp-3 min-h-[3.75rem] text-sm font-medium leading-5">
                        {highlight.content || "A top laugh from your study"}
                      </p>
                      <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-[#efe4c6] bg-[#f9f3e3] px-2.5 py-1 text-[11px] font-bold text-[#8c6721] dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-100">
                        {highlight.rating === "very funny" ? "🤣 Hilarious" : "😄 Funny"}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--panel-border)] bg-[var(--surface-muted)] px-4 py-5 text-center">
                <BoltIcon aria-hidden className="mx-auto h-6 w-6 text-[var(--accent-gold)]" />
                <p className="mt-2 text-sm font-bold">No favorites marked this round — tough crowd!</p>
                <p className="mt-1 text-xs text-[var(--soft)]">Every good critic needs high standards.</p>
              </div>
            )}
          </section>
        </div>

        <div className="shrink-0 space-y-2 border-t border-[var(--panel-border)] pt-3">
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex w-full justify-center rounded-full border border-[#dcdad2] bg-[#fbfbf9] px-5 py-2.5 text-sm font-semibold text-[#4b6356] transition-all duration-200 hover:bg-[#eef4f0] dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-100 dark:hover:bg-stone-800"
            >
              Edit responses
            </button>
          ) : editHref ? (
            <Link
              href={editHref}
              className="inline-flex w-full justify-center rounded-full border border-[#dcdad2] bg-[#fbfbf9] px-5 py-2.5 text-sm font-semibold text-[#4b6356] transition-all duration-200 hover:bg-[#eef4f0] dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-100 dark:hover:bg-stone-800"
            >
              Edit responses
            </Link>
          ) : null}
          <Link href="/" className="inline-flex w-full justify-center rounded-full border border-rose-100 bg-[#fff5f7] px-5 py-2.5 text-sm font-semibold tracking-wide text-[#514347] transition-all duration-200 hover:bg-[#ffedf1] dark:border-rose-300/30 dark:bg-rose-950/40 dark:text-rose-100 dark:hover:bg-rose-900/50">
            Back to studies
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatSeconds(milliseconds: number | null) {
  if (milliseconds === null) return "—";
  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function StatCard({
  detail,
  icon,
  label,
  value,
  className = "",
}: {
  detail: string;
  icon: string;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <article className={`rounded-2xl border border-rose-100/80 bg-[#fff5f7] p-3 shadow-[0_4px_16px_-10px_rgba(124,76,88,0.16)] dark:border-rose-300/25 dark:bg-rose-950/30 sm:p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--soft)]">{label}</p>
        <span aria-hidden className="text-lg">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-black leading-none tracking-tight text-[var(--foreground)] sm:text-3xl">{value}</p>
      <p className="mt-1.5 text-[11px] text-[var(--soft)]">{detail}</p>
    </article>
  );
}
