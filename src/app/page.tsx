import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon } from "@heroicons/react/24/outline";

import { AccountMenu } from "@/components/AccountMenu";
import { LocalDateTime } from "@/components/LocalDateTime";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { buildDemographicsPath, hasPendingDemographicQuestions } from "@/lib/demographics";
import { DEMOGRAPHIC_SKIPS_COOKIE, readDemographicSkips } from "@/lib/demographic-skips";
import { buildNotificationPreferencesPath, fetchNotificationPreferences, NOTIFICATION_SKIPS_COOKIE, readNotificationSkips } from "@/lib/notification-preferences";
import {
  fetchCompletedPublicStudyIdentities,
  fetchPublicActiveStudyIdentities,
  type StudyRow,
} from "@/lib/studies";
import { createClient } from "@/lib/supabase/server";
import { fetchStudyParticipations, isStudyCompleted } from "@/lib/study-participation";
import type { TablesUpdate } from "@/types/supabase";

type Profile = {
  first_name: string | null;
  last_name: string | null;
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const messageRaw = resolvedParams.message;
  const message = Array.isArray(messageRaw) ? messageRaw[0] : messageRaw;

  const supabase = await createClient();
  const studyNow = new Date();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const skippedNotifications = readNotificationSkips(cookieStore.get(NOTIFICATION_SKIPS_COOKIE)?.value, user.id);
  if ((await fetchNotificationPreferences(supabase, user.id, skippedNotifications)).pending.length) {
    redirect(buildNotificationPreferencesPath("/"));
  }

  const skippedQuestionIds = readDemographicSkips(
    cookieStore.get(DEMOGRAPHIC_SKIPS_COOKIE)?.value,
    user.id
  );

  if (await hasPendingDemographicQuestions(supabase, user.id, skippedQuestionIds)) {
    redirect(buildDemographicsPath({ next: "/", skippedQuestionIds }));
  }

  const [
    { data: profileData },
    { studies: activeStudyIdentities, error: activeStudyIdentitiesError },
    { studies: completedStudyIdentities, error: completedStudyIdentitiesError },
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", user.id)
        .single(),
      fetchPublicActiveStudyIdentities(supabase, studyNow),
      fetchCompletedPublicStudyIdentities(supabase, user.id),
    ]);
  const studyIdentityById = new Map(
    [...activeStudyIdentities, ...completedStudyIdentities].map((study) => [
      study.id,
      study,
    ])
  );
  const studyIdentities = Array.from(studyIdentityById.values()).sort(
    (left, right) => left.id - right.id
  );
  const studyIdentityError = activeStudyIdentitiesError;

  const profile = profileData as Profile | null;

  const fullName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayName = fullName || user.email || "your account";

  if (!profile?.first_name || !profile?.last_name) {
    return (
      <CompleteProfileForm
        userEmail={user.email}
        initialFirst={profile?.first_name ?? ""}
        initialLast={profile?.last_name ?? ""}
        message={message}
      />
    );
  }

  if (studyIdentityError) {
    console.error("[Home] load study identities failed", studyIdentityError);
  }

  const { participations, error: participationError } = await fetchStudyParticipations(
    supabase, user.id, studyIdentities.map((study) => study.id)
  );
  const participationByStudy = new Map(participations.map((row) => [row.study_id, row]));
  const completionStatusError = participationError ?? completedStudyIdentitiesError;
  if (participationError) {
    console.error("[Home] load study participation failed", participationError);
  }
  if (completedStudyIdentitiesError) {
    console.error("[Home] load completed studies failed", completedStudyIdentitiesError);
  }

  return (
    <div
      id="home-root"
      className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden px-4 pt-8 pb-24 text-[var(--foreground)] sm:px-6 sm:pt-12"
    >
      <main
        id="home-content"
        className="relative mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain p-1"
      >
        {!studyIdentityError ? <StudiesHeader /> : null}
        {studyIdentityError ? (
          <div className="glass-panel rounded-2xl p-6 text-center sm:p-8">
            <h1 className="text-2xl font-bold text-[var(--error-text)]">
              We couldn&apos;t load studies
            </h1>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Please refresh and try again.
            </p>
          </div>
        ) : studyIdentities.length === 0 ? (
          <div className="glass-panel rounded-2xl p-6 text-center sm:p-8">
            <h1 className="text-2xl font-bold sm:text-3xl">No active studies</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Your next study will appear here when it is ready.
            </p>
          </div>
        ) : (
          <>
            {completionStatusError ? (
              <p role="alert" className="mb-4 text-sm text-[var(--error-text)]">
                We couldn&apos;t load your study completion status. Please refresh to try again.
              </p>
            ) : null}
            <ul className="space-y-3">
              {studyIdentities.map((study) => {
                const participation = participationByStudy.get(study.id);
                const completed = isStudyCompleted(participation);
                const studyHref = `/study/${study.id}`;

                return (
                  <li key={study.id}>
                    {completed ? (
                      <article className="glass-panel flex flex-col gap-4 rounded-2xl p-5 transition hover:border-amber-300/70 hover:shadow-md hover:shadow-stone-950/5 sm:flex-row sm:items-center sm:p-6">
                        <StudyCardDetails study={study} completed />
                        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
                          <Link
                            href={`${studyHref}/recap`}
                            prefetch={false}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#91b5a6] to-[#7fa894] px-5 py-2 text-xs font-semibold tracking-wide text-[#24352d] shadow-[0_4px_14px_rgba(136,175,160,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(136,175,160,0.38)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
                          >
                            <span aria-hidden>✿</span>
                            View Recap / Report
                          </Link>
                          <Link
                            href={studyHref}
                            prefetch={false}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#dcdad2] bg-[#fbfbf9] px-5 py-2 text-xs font-semibold tracking-wide text-[#4b6356] transition-all duration-200 hover:border-[#cbd9d0] hover:bg-[#eef4f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-100 dark:hover:bg-stone-800"
                          >
                            Edit Responses
                            <ArrowRightIcon aria-hidden className="h-4 w-4" />
                          </Link>
                        </div>
                      </article>
                    ) : (
                      <Link
                        href={studyHref}
                        prefetch={false}
                        className="glass-panel flex items-center gap-4 rounded-2xl p-5 transition hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] sm:p-6"
                      >
                        <StudyCardDetails
                          study={study}
                          inProgress={Boolean(participation?.started_at)}
                        />
                        <ArrowRightIcon
                          aria-hidden
                          className="h-5 w-5 shrink-0 text-[var(--accent-strong)]"
                        />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
      <AccountMenu displayName={displayName} email={user.email} signOutAction={signOut} />
    </div>
  );
}

function StudiesHeader() {
  return (
    <header className="mb-6 space-y-4 sm:mb-8 sm:space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Studies</h1>
        <RainbowClouds />
      </div>
      <div className="max-w-2xl space-y-3 rounded-2xl border border-[#eee8df] bg-[#fffefa]/85 px-4 py-4 shadow-[0_6px_20px_-14px_rgba(104,91,76,0.12)] sm:px-5 sm:py-5">
        <p className="text-sm leading-6 text-[var(--muted)] sm:text-base">
          Welcome to our study hub. We believe in{" "}
          <span className="font-semibold text-[#527967]">
            Engineering for Humanity
          </span>
          —using technology to create meaningful, human-centered experiences.
        </p>
        <div>
          <h2 className="text-sm font-bold text-[var(--foreground)]">
            How to participate
          </h2>
          <ol className="mt-2 grid gap-1.5 text-sm leading-5 text-[var(--muted)] sm:grid-cols-3 sm:gap-3">
            <li className="flex gap-2">
              <span className="font-semibold text-[#527967]">1.</span>
              <span>Browse your active studies below.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-[#527967]">2.</span>
              <span>Share your thoughts and feelings.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-[#527967]">3.</span>
              <span>Your contributions help us build tools that care.</span>
            </li>
          </ol>
        </div>
      </div>
    </header>
  );
}

function RainbowClouds() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 112 64"
      className="studies-rainbow-float h-12 w-[84px] shrink-0 sm:h-14 sm:w-[98px]"
      fill="none"
    >
      <path d="M25 47a31 31 0 0 1 62 0" stroke="#EBA6AE" strokeWidth="7" strokeLinecap="round" />
      <path d="M32 47a24 24 0 0 1 48 0" stroke="#F2C36E" strokeWidth="7" strokeLinecap="round" />
      <path d="M39 47a17 17 0 0 1 34 0" stroke="#A8CDB5" strokeWidth="7" strokeLinecap="round" />
      <path d="M46 47a10 10 0 0 1 20 0" stroke="#A9CDE2" strokeWidth="7" strokeLinecap="round" />
      <path d="M24 45c-1-5-5-8-10-8-6 0-10 4-10 9 0 5 4 8 10 8h13c4 0 7-3 7-7 0-4-3-7-7-7-1 0-2 0-3 1Z" fill="#FFFDF8" stroke="#E9E5DD" strokeWidth="1.5" />
      <path d="M88 45c1-5 5-8 10-8 6 0 10 4 10 9 0 5-4 8-10 8H85c-4 0-7-3-7-7 0-4 3-7 7-7 1 0 2 0 3 1Z" fill="#FFFDF8" stroke="#E9E5DD" strokeWidth="1.5" />
      <circle cx="19" cy="47" r="1" fill="#8A756B" />
      <circle cx="97" cy="47" r="1" fill="#8A756B" />
    </svg>
  );
}

function StudyCardDetails({
  study,
  completed = false,
  inProgress = false,
}: {
  study: StudyRow;
  completed?: boolean;
  inProgress?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-2 break-words">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold sm:text-xl">Study {study.id}</h2>
        {completed ? (
          <span className="rounded-full border border-[#efe4c6] bg-[#f9f3e3] px-3 py-1 text-xs font-semibold text-[#8c6721] dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-100">
            Completed
          </span>
        ) : inProgress ? (
          <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
            In progress
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm leading-6 text-[var(--muted)]">
        <dt>Start</dt>
        <dd>
          {study.start_datetime_utc ? (
            <LocalDateTime value={study.start_datetime_utc} />
          ) : "No start date"}
        </dd>
        <dt>End</dt>
        <dd>
          {study.end_datetime_utc ? (
            <LocalDateTime value={study.end_datetime_utc} />
          ) : "No end date"}
        </dd>
      </dl>
    </div>
  );
}

function CompleteProfileForm({
  userEmail,
  initialFirst,
  initialLast,
  message,
}: {
  userEmail: string | undefined | null;
  initialFirst: string;
  initialLast: string;
  message?: string | null;
}) {
  return (
    <div
      id="profile-complete-root"
      className="relative flex h-[100svh] min-h-[100svh] items-start justify-center overflow-hidden px-4 py-10 text-[var(--foreground)] sm:items-center sm:px-6 sm:py-16"
    >
      <div
        id="profile-bg-shell"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          id="profile-bg-orb-1"
          className="absolute -left-16 top-10 h-64 w-64 rounded-full bg-[#6b9080]/10 blur-[110px] animate-orb"
        />
        <div
          id="profile-bg-orb-2"
          className="absolute bottom-6 right-8 h-56 w-56 rounded-full bg-amber-200/15 blur-[110px] animate-orb-reverse"
        />
        <div
          id="profile-bg-orb-3"
          className="absolute left-12 top-1/2 h-60 w-60 -translate-y-1/2 rounded-full bg-[#a3b18a]/10 blur-[100px] animate-orb-sway"
        />
        <div
          id="profile-bg-grid"
          className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(251,191,36,0.12),transparent_42%),radial-gradient(circle_at_80%_12%,rgba(253,224,71,0.12),transparent_35%)] animate-grid-drift"
        />
      </div>

      <div
        id="profile-complete-card"
        className="relative w-full max-w-2xl rounded-3xl border border-[var(--panel-border)] bg-[var(--card-surface)] p-8 shadow-[var(--panel-shadow)] backdrop-blur-sm animate-card-rise sm:p-10 max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-h-none"
      >
        <div
          id="profile-card-topline"
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--accent)] via-[var(--accent-strong)] to-[var(--accent)] animate-shine"
        />
        <div
          id="profile-card-topglow"
          className="absolute -left-16 top-0 h-28 w-28 rounded-full bg-amber-200/10 blur-3xl"
        />
        <div id="profile-card-body" className="space-y-7 relative">
          <header className="space-y-2">
            <p className="text-sm uppercase tracking-[0.2em] text-[var(--soft)]">
              Welcome
            </p>
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">
              <span className="bg-gradient-to-r from-[#587b6d] via-[#7fa894] to-[#b58b4b] bg-clip-text text-transparent animate-text-shimmer">
                Tell us who you are
              </span>
            </h1>
            <p className="text-sm text-[var(--muted)] sm:text-base">
              We need your first and last name before you can enter. You&apos;re
              signed in as {userEmail ?? "your account"}.
            </p>
            {message ? (
              <p className="rounded-xl bg-[color-mix(in_srgb,_var(--accent)_12%,_transparent)] px-4 py-3 text-sm font-medium text-[var(--foreground)] ring-1 ring-[color-mix(in_srgb,_var(--accent)_35%,_transparent)]">
                {message}
              </p>
            ) : null}
          </header>

          <form id="profile-name-form" action={updateProfileName} className="space-y-4">
            <div id="profile-name-grid" className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-[var(--foreground)]">
                First name
                <input
                  name="first_name"
                  defaultValue={initialFirst}
                  required
                  minLength={2}
                  className="mt-2 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-base text-[var(--foreground)] shadow-inner outline-none ring-1 ring-[var(--input-border)] transition focus:ring-2 focus:ring-[var(--input-ring)]"
                  placeholder="Jane"
                />
              </label>
              <label className="block text-sm font-semibold text-[var(--foreground)]">
                Last name
                <input
                  name="last_name"
                  defaultValue={initialLast}
                  required
                  minLength={2}
                  className="mt-2 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-base text-[var(--foreground)] shadow-inner outline-none ring-1 ring-[var(--input-border)] transition focus:ring-2 focus:ring-[var(--input-ring)]"
                  placeholder="Doe"
                />
              </label>
            </div>
            <div
              id="profile-action-row"
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end"
            >
              <SubmitButton
                formAction={updateProfileName}
                pendingLabel="Saving…"
                className="w-full rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-contrast)] shadow-[0_4px_14px_rgba(88,123,109,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] hover:shadow-[0_6px_20px_rgba(88,123,109,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] sm:w-auto"
              >
                Save and continue
              </SubmitButton>
              <SubmitButton
                pendingLabel="Signing out…"
                formAction={signOut}
                formNoValidate
                className="w-full rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] shadow-inner shadow-black/40 transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--panel-border)] sm:w-auto"
              >
                Log out
              </SubmitButton>
            </div>
          </form>
        </div>
      </div>
      <ThemeMenu />
    </div>
  );
}

async function signOut() {
  "use server";

  const supabase = await createClient({ allowCookieWrite: true });
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

async function updateProfileName(formData: FormData) {
  "use server";

  const supabase = await createClient({ allowCookieWrite: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const first = formData.get("first_name")?.toString().trim() ?? "";
  const last = formData.get("last_name")?.toString().trim() ?? "";

  if (first.length < 2 || last.length < 2) {
    redirect(
      "/?message=" + encodeURIComponent("Please enter a valid first and last name.")
    );
  }

  const updatePayload: TablesUpdate<"profiles"> = {
    first_name: first,
    last_name: last,
    modified_by_user_id: user.id,
  };
  const { error } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", user.id);

  if (error) {
    redirect(
      "/?message=" +
        encodeURIComponent("We could not save your name. Please try again.")
    );
  }

  redirect("/");
}
