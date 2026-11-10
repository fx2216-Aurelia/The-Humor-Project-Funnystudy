import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { signOut } from "@/app/profile-actions";
import { AccountMenu } from "@/components/AccountMenu";
import { CompletedStudy, type StudyHighlight } from "@/components/CompletedStudy";
import { resolveStudyCaptionImageUrl } from "@/lib/caption-images";
import { fetchInitialActiveStudyCaptions, resolveNumericStudy } from "@/lib/studies";
import { createClient } from "@/lib/supabase/server";
import { fetchStudyParticipations, isStudyCompleted } from "@/lib/study-participation";

type PageParams = Promise<{ studyId: string }>;

function parseStudyId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const studyId = Number(value);
  return Number.isSafeInteger(studyId) && studyId > 0 ? studyId : null;
}

export default async function StudyRecapPage({ params }: { params: PageParams }) {
  const studyId = parseStudyId((await params).studyId);
  if (studyId === null) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const studyResult = await resolveNumericStudy(supabase, studyId);
  if (studyResult.status === "missing") notFound();
  if (studyResult.status === "error") {
    console.error("[StudyRecapPage] load study failed", studyResult.error);
    throw new Error("Could not load study recap");
  }

  const { participations, error: participationError } =
    await fetchStudyParticipations(supabase, user.id, [studyId]);
  if (participationError) {
    console.error("[StudyRecapPage] load participation failed", participationError);
    throw new Error("Could not verify completed study");
  }

  const participation = participations[0] ?? null;
  if (!isStudyCompleted(participation)) notFound();

  const { captions, error: captionsError } =
    await fetchInitialActiveStudyCaptions(supabase, user.id, {
      includePrivateStudies: true,
      includeExpired: true,
      minimumCount: Number.MAX_SAFE_INTEGER,
      studyId,
    });
  if (captionsError) {
    console.error("[StudyRecapPage] load rated captions failed", captionsError);
    throw new Error("Could not load study highlights");
  }

  const highlights: StudyHighlight[] = captions.flatMap((caption) =>
    caption.rating === "funny" || caption.rating === "very funny"
      ? [{
          id: caption.id,
          content: caption.content,
          imageSrc: resolveStudyCaptionImageUrl(caption),
          rating: caption.rating,
        }]
      : []
  ).sort((left, right) => {
    if (left.rating === right.rating) return 0;
    return left.rating === "very funny" ? -1 : 1;
  });

  const editHref = `/study/${studyId}`;

  return (
    <main className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden px-4 py-3 text-[var(--foreground)] sm:px-6 sm:py-4">
      <nav aria-label="Study recap navigation" className="flex shrink-0 items-center gap-3">
        <Link
          href="/"
          aria-label="Back to studies"
          className="flex h-12 w-12 items-center justify-center rounded-full transition hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
        >
          <span aria-hidden className="text-2xl">←</span>
        </Link>
        <span className="text-sm font-semibold text-[var(--muted)]">Study {studyId} · Your recap</span>
      </nav>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 items-stretch justify-center">
        <CompletedStudy
          participation={participation}
          highlights={highlights}
          editHref={editHref}
        />
      </div>
      <AccountMenu
        displayName={user.email || "your account"}
        email={user.email}
        signOutAction={signOut}
      />
    </main>
  );
}
