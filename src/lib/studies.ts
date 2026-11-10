import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  orderStudyCaptionIdsForParticipant,
  STUDY_CAPTION_BATCH_SIZE,
} from "@/lib/study-caption-order";
import type { StudyVoteValue } from "@/lib/caption-votes";
import type { Tables } from "@/types/supabase";

const INITIAL_ACTIVE_STUDY_CAPTION_COUNT = 60;

type StudyCaptionMappingRow = {
  id: number;
  caption_id: string | null;
};

export type ActiveStudyCaption = {
  id: string;
  content: string | null;
  created_datetime_utc: string | null;
  image_id: string | null;
  like_count: number | null;
  study_caption_mapping_id: number | null;
  images:
    | {
        url: string | null;
      }
    | {
        url: string | null;
      }[]
    | null;
};

type StudyCaptionRow = Omit<ActiveStudyCaption, "study_caption_mapping_id">;

type StudyCaptionMappingWithCaptionRow = StudyCaptionMappingRow & {
  captions: StudyCaptionRow | StudyCaptionRow[] | null;
};

type CaptionIdRow = {
  caption_id: string;
};

type CaptionSaveRow = {
  caption_id: string;
};

type StudyRatingRow = Pick<
  Tables<"study_caption_vote_events">,
  "study_caption_mapping_id" | "vote_value"
>;

type CanonicalStudyRatingRow = Pick<
  Tables<"study_caption_ratings">,
  "study_caption_mapping_id" | "vote_value"
>;

export type StudyRow = {
  description: string | null;
  end_datetime_utc: string | null;
  id: number;
  is_private: boolean | null;
  slug: string | null;
  start_datetime_utc: string | null;
};

export type ViewerActiveStudyCaption = ActiveStudyCaption & {
  is_liked: boolean;
  is_saved: boolean;
  rating: StudyVoteValue | null;
};

export type NumericStudyLookupResult =
  | { error: null; status: "active"; study: StudyRow }
  | { error: null; status: "expired"; study: StudyRow }
  | { error: null; status: "missing"; study: null }
  | { error: PostgrestError; status: "error"; study: null };

type StudyCaptionScope = {
  includePrivateStudies?: boolean;
  includeExpired?: boolean;
  studyId?: number | null;
};

function normalizeStudyId(studyId: number | null | undefined) {
  return typeof studyId === "number" &&
    Number.isSafeInteger(studyId) &&
    studyId > 0
    ? studyId
    : null;
}

function isStudyInActiveDateRange(study: StudyRow, now: Date) {
  const nowTime = now.getTime();
  const startTime = study.start_datetime_utc
    ? new Date(study.start_datetime_utc).getTime()
    : null;
  const endTime = study.end_datetime_utc
    ? new Date(study.end_datetime_utc).getTime()
    : null;

  return (
    (startTime === null || startTime <= nowTime) &&
    (endTime === null || endTime >= nowTime)
  );
}

export async function resolveNumericStudy(
  supabase: SupabaseClient,
  studyId: number,
  now = new Date()
): Promise<NumericStudyLookupResult> {
  const normalizedStudyId = normalizeStudyId(studyId);

  if (normalizedStudyId === null) {
    return { error: null, status: "missing", study: null };
  }

  const { data, error } = await supabase
    .from("studies")
    .select("id, slug, description, is_private, start_datetime_utc, end_datetime_utc")
    .eq("id", normalizedStudyId)
    .maybeSingle();

  if (error) {
    return { error, status: "error", study: null };
  }

  const study = data as StudyRow | null;

  if (!study) {
    return { error: null, status: "missing", study: null };
  }

  if (!isStudyInActiveDateRange(study, now)) {
    return { error: null, status: "expired", study };
  }

  return { error: null, status: "active", study };
}

export async function fetchPublicActiveStudyIdentities(
  supabase: SupabaseClient,
  now = new Date()
): Promise<{ error: PostgrestError | null; studies: StudyRow[] }> {
  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from("studies")
    .select("id, slug, description, is_private, start_datetime_utc, end_datetime_utc")
    .or(`start_datetime_utc.lte.${nowIso},start_datetime_utc.is.null`)
    .or(`end_datetime_utc.gte.${nowIso},end_datetime_utc.is.null`)
    .eq("is_private", false)
    .order("id", { ascending: true });

  if (error) {
    return { error, studies: [] };
  }

  return { error: null, studies: (data ?? []) as StudyRow[] };
}

export async function fetchCompletedPublicStudyIdentities(
  supabase: SupabaseClient,
  profileId: string
): Promise<{ error: PostgrestError | null; studies: StudyRow[] }> {
  const completedStudyIds = new Set<number>();
  const participationPageSize = 1000;

  for (let from = 0; ; from += participationPageSize) {
    const { data, error } = await supabase
      .from("study_participations")
      .select("study_id")
      .eq("profile_id", profileId)
      .not("ended_at", "is", null)
      .order("study_id", { ascending: true })
      .range(from, from + participationPageSize - 1);

    if (error) {
      return { error, studies: [] };
    }

    const rows = (data ?? []) as Array<{ study_id: number }>;
    rows.forEach((row) => completedStudyIds.add(row.study_id));
    if (rows.length < participationPageSize) {
      break;
    }
  }

  if (!completedStudyIds.size) {
    return { error: null, studies: [] };
  }

  const studyIds = Array.from(completedStudyIds);
  const studies: StudyRow[] = [];
  const studyPageSize = 250;
  for (let start = 0; start < studyIds.length; start += studyPageSize) {
    const { data, error } = await supabase
      .from("studies")
      .select("id, slug, description, is_private, start_datetime_utc, end_datetime_utc")
      .eq("is_private", false)
      .in("id", studyIds.slice(start, start + studyPageSize))
      .order("id", { ascending: true });

    if (error) {
      return { error, studies: [] };
    }

    studies.push(...((data ?? []) as StudyRow[]));
  }

  return { error: null, studies };
}

async function fetchSavedCaptionIdsForProfile(
  supabase: SupabaseClient,
  profileId: string,
  captionIds: readonly string[]
): Promise<{ savedCaptionIds: Set<string>; error: PostgrestError | null }> {
  if (!captionIds.length) {
    return { savedCaptionIds: new Set<string>(), error: null };
  }

  const { data, error } = await supabase
    .from("caption_saves")
    .select("caption_id")
    .eq("profile_id", profileId)
    .in("caption_id", captionIds);

  if (error) {
    return { savedCaptionIds: new Set<string>(), error };
  }

  return {
    savedCaptionIds: new Set(
      ((data ?? []) as CaptionSaveRow[]).map((row) => row.caption_id)
    ),
    error: null,
  };
}

async function fetchLikedCaptionIdsForProfile(
  supabase: SupabaseClient,
  profileId: string,
  captionIds: readonly string[]
): Promise<{ likedCaptionIds: Set<string>; error: PostgrestError | null }> {
  if (!captionIds.length) {
    return { likedCaptionIds: new Set<string>(), error: null };
  }

  const { data, error } = await supabase
    .from("caption_votes")
    .select("caption_id")
    .eq("profile_id", profileId)
    .eq("is_from_study", true)
    .gt("vote_value", 0)
    .in("caption_id", captionIds);

  if (error) {
    return { likedCaptionIds: new Set<string>(), error };
  }

  return {
    likedCaptionIds: new Set(
      ((data ?? []) as CaptionIdRow[]).map((row) => row.caption_id)
    ),
    error: null,
  };
}

async function fetchStudyRatingsForProfile(
  supabase: SupabaseClient,
  profileId: string,
  mappingIds: readonly number[]
): Promise<{ ratingsByMappingId: Map<number, StudyVoteValue>; error: PostgrestError | null }> {
  if (!mappingIds.length) {
    return { ratingsByMappingId: new Map(), error: null };
  }

  const [{ data: eventData, error: eventError }, { data: ratingData, error: ratingError }] =
    await Promise.all([
      supabase
    .from("study_caption_vote_events")
    .select("study_caption_mapping_id, vote_value")
    .eq("profile_id", profileId)
    .in("study_caption_mapping_id", mappingIds)
        .order("id", { ascending: false }),
      supabase
        .from("study_caption_ratings")
        .select("study_caption_mapping_id, vote_value")
        .eq("profile_id", profileId)
        .in("study_caption_mapping_id", mappingIds),
    ]);

  if (eventError || ratingError) {
    return {
      ratingsByMappingId: new Map(),
      error: eventError ?? ratingError,
    };
  }

  const ratingsByMappingId = new Map<number, StudyVoteValue>();
  ((eventData ?? []) as StudyRatingRow[]).forEach((row) => {
    if (
      typeof row.study_caption_mapping_id === "number" &&
      !ratingsByMappingId.has(row.study_caption_mapping_id)
    ) {
      ratingsByMappingId.set(row.study_caption_mapping_id, row.vote_value);
    }
  });
  ((ratingData ?? []) as CanonicalStudyRatingRow[]).forEach((row) => {
    if (typeof row.study_caption_mapping_id === "number") {
      ratingsByMappingId.set(row.study_caption_mapping_id, row.vote_value);
    }
  });

  return { ratingsByMappingId, error: null };
}

export async function fetchActiveStudyCaptionTotalCount(
  supabase: SupabaseClient,
  _profileId: string,
  now = new Date(),
  scope: StudyCaptionScope = {}
): Promise<{ count: number; error: PostgrestError | null }> {
  const { ids: activeCaptionIds, error: activeCaptionIdsError } =
    await fetchActiveStudyCaptionIds(supabase, now, scope);

  if (activeCaptionIdsError) {
    return { count: 0, error: activeCaptionIdsError };
  }

  if (!activeCaptionIds.length) {
    return { count: 0, error: null };
  }
  return {
    count: activeCaptionIds.length,
    error: null,
  };
}

export async function fetchActiveStudyCaptionIds(
  supabase: SupabaseClient,
  now = new Date(),
  scope: StudyCaptionScope = {}
): Promise<{ ids: string[]; error: PostgrestError | null }> {
  const PAGE_SIZE = 1000;
  const nowIso = now.toISOString();
  const normalizedStudyId = normalizeStudyId(scope.studyId);
  const ids = new Set<string>();
  let from = 0;
  let error: PostgrestError | null = null;

  while (true) {
    let query = supabase
      .from("study_caption_mappings")
      .select("id, caption_id, studies!inner(id), captions!inner(id)")
      .order("id", { ascending: true });

    if (!scope.includeExpired) {
      query = query
        .or(`start_datetime_utc.lte.${nowIso},start_datetime_utc.is.null`, {
          referencedTable: "studies",
        })
        .or(`end_datetime_utc.gte.${nowIso},end_datetime_utc.is.null`, {
          referencedTable: "studies",
        });
    }

    if (!scope.includePrivateStudies) {
      query = query.eq("studies.is_private", false);
    }

    if (normalizedStudyId !== null) {
      query = query.eq("study_id", normalizedStudyId);
    }

    const { data, error: pageError } = await query
      .range(from, from + PAGE_SIZE - 1);

    if (pageError) {
      error = pageError;
      break;
    }

    const rows = (data ?? []) as StudyCaptionMappingRow[];
    rows.forEach((row) => {
      if (typeof row.caption_id === "string" && row.caption_id.length > 0) {
        ids.add(row.caption_id);
      }
    });

    if (rows.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return { ids: Array.from(ids), error };
}

export async function fetchActiveStudyCaptions(
  supabase: SupabaseClient,
  now = new Date(),
  scope: StudyCaptionScope = {}
): Promise<{ captions: ActiveStudyCaption[]; error: PostgrestError | null }> {
  const PAGE_SIZE = 1000;
  const nowIso = now.toISOString();
  const normalizedStudyId = normalizeStudyId(scope.studyId);
  const captionsById = new Map<string, ActiveStudyCaption>();
  let from = 0;
  let error: PostgrestError | null = null;

  while (true) {
    let query = supabase
      .from("study_caption_mappings")
      .select(
        "id, caption_id, studies!inner(id), captions!inner(id, content, created_datetime_utc, image_id, like_count, images(url))"
      )
      .or(`start_datetime_utc.lte.${nowIso},start_datetime_utc.is.null`, {
        referencedTable: "studies",
      })
      .or(`end_datetime_utc.gte.${nowIso},end_datetime_utc.is.null`, {
        referencedTable: "studies",
      })
      .order("id", { ascending: true });

    if (!scope.includePrivateStudies) {
      query = query.eq("studies.is_private", false);
    }

    if (normalizedStudyId !== null) {
      query = query.eq("study_id", normalizedStudyId);
    }

    const { data, error: pageError } = await query
      .range(from, from + PAGE_SIZE - 1);

    if (pageError) {
      error = pageError;
      break;
    }

    const rows = (data ?? []) as StudyCaptionMappingWithCaptionRow[];
    rows.forEach((row) => {
      const caption = Array.isArray(row.captions) ? row.captions[0] : row.captions;
      if (!caption?.id) {
        return;
      }

      captionsById.set(caption.id, {
        ...caption,
        study_caption_mapping_id: row.id,
      });
    });

    if (rows.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return { captions: Array.from(captionsById.values()), error };
}

export async function fetchActiveStudyCaptionPage(
  supabase: SupabaseClient,
  profileId: string,
  {
    now = new Date(),
    captionIds,
    includePrivateStudies = false,
    includeExpired = false,
    studyId = null,
  }: {
    includePrivateStudies?: boolean;
    includeExpired?: boolean;
    now?: Date;
    captionIds: readonly string[];
    studyId?: number | null;
  }
): Promise<{
  captions: ViewerActiveStudyCaption[];
  error: PostgrestError | null;
}> {
  const nowIso = now.toISOString();
  const normalizedStudyId = normalizeStudyId(studyId);
  if (!captionIds.length) {
    return { captions: [], error: null };
  }

  const captionsById = new Map<string, ActiveStudyCaption>();
  const mappingPageSize = 1000;
  for (let offset = 0; ; offset += mappingPageSize) {
    let query = supabase
      .from("study_caption_mappings")
      .select(
        "id, caption_id, studies!inner(id), captions!inner(id, content, created_datetime_utc, image_id, like_count, images(url))"
      )
      .in("caption_id", captionIds)
      .order("caption_id", { ascending: true })
      .order("id", { ascending: true });

    if (!includeExpired) {
      query = query
        .or(`start_datetime_utc.lte.${nowIso},start_datetime_utc.is.null`, {
          referencedTable: "studies",
        })
        .or(`end_datetime_utc.gte.${nowIso},end_datetime_utc.is.null`, {
          referencedTable: "studies",
        });
    }

    if (!includePrivateStudies) {
      query = query.eq("studies.is_private", false);
    }

    if (normalizedStudyId !== null) {
      query = query.eq("study_id", normalizedStudyId);
    }

    const { data, error } = await query.range(offset, offset + mappingPageSize - 1);

    if (error) {
      return { captions: [], error };
    }

    const rows = (data ?? []) as StudyCaptionMappingWithCaptionRow[];

    rows.forEach((row) => {
      const caption = Array.isArray(row.captions) ? row.captions[0] : row.captions;
      if (!caption?.id || captionsById.has(caption.id)) {
        return;
      }

      captionsById.set(caption.id, {
        ...caption,
        study_caption_mapping_id: row.id,
      });
    });

    if (rows.length < mappingPageSize) {
      break;
    }
  }

  // IN queries return database order; restore the order assigned at study entry.
  const candidateCaptions = Array.from(new Set(captionIds)).flatMap((id) => {
    const caption = captionsById.get(id);
    return caption ? [caption] : [];
  });
  const candidateCaptionIds = candidateCaptions.map((caption) => caption.id);

  if (!candidateCaptionIds.length) {
    return {
      captions: [],
      error: null,
    };
  }

  const [
    { likedCaptionIds, error: likedCaptionIdsError },
    { savedCaptionIds, error: savedCaptionIdsError },
    { ratingsByMappingId, error: ratingsError },
  ] = await Promise.all([
    fetchLikedCaptionIdsForProfile(supabase, profileId, candidateCaptionIds),
    fetchSavedCaptionIdsForProfile(supabase, profileId, candidateCaptionIds),
    fetchStudyRatingsForProfile(
      supabase,
      profileId,
      candidateCaptions.flatMap((caption) =>
        caption.study_caption_mapping_id === null
          ? []
          : [caption.study_caption_mapping_id]
      )
    ),
  ]);

  if (likedCaptionIdsError) {
    return { captions: [], error: likedCaptionIdsError };
  }

  if (savedCaptionIdsError) {
    return { captions: [], error: savedCaptionIdsError };
  }

  if (ratingsError) {
    return { captions: [], error: ratingsError };
  }

  return {
    captions: candidateCaptions.map((caption) => ({
      ...caption,
      is_liked: likedCaptionIds.has(caption.id),
      is_saved: savedCaptionIds.has(caption.id),
      rating:
        caption.study_caption_mapping_id === null
          ? null
          : ratingsByMappingId.get(caption.study_caption_mapping_id) ?? null,
    })),
    error: null,
  };
}

export async function fetchInitialActiveStudyCaptions(
  supabase: SupabaseClient,
  profileId: string,
  {
    includePrivateStudies = false,
    includeExpired = false,
    minimumCount = INITIAL_ACTIVE_STUDY_CAPTION_COUNT,
    now = new Date(),
    studyId = null,
  }: {
    includePrivateStudies?: boolean;
    includeExpired?: boolean;
    minimumCount?: number;
    now?: Date;
    studyId?: number | null;
  } = {}
): Promise<{
  captionOrder: string[];
  captions: ViewerActiveStudyCaption[];
  error: PostgrestError | null;
  nextOffset: number | null;
}> {
  const normalizedMinimumCount =
    Number.isSafeInteger(minimumCount) && minimumCount > 0
      ? minimumCount
      : INITIAL_ACTIVE_STUDY_CAPTION_COUNT;
  const { ids, error } = await fetchActiveStudyCaptionIds(supabase, now, {
    includePrivateStudies,
    includeExpired,
    studyId,
  });
  if (error) {
    return { captionOrder: [], captions: [], error, nextOffset: null };
  }

  // Keep the entire sequence stable for this participant and study across visits.
  // Later batches use this same snapshot even if mappings change during the run.
  const normalizedStudyId = normalizeStudyId(studyId);
  const captionOrder =
    normalizedStudyId === null
      ? [...new Set(ids)]
      : orderStudyCaptionIdsForParticipant(ids, profileId, normalizedStudyId);
  const captions: ViewerActiveStudyCaption[] = [];
  let nextOffset: number | null = captionOrder.length ? 0 : null;

  while (nextOffset !== null && captions.length < normalizedMinimumCount) {
    const batchIds = captionOrder.slice(
      nextOffset,
      nextOffset + Math.min(STUDY_CAPTION_BATCH_SIZE, normalizedMinimumCount - captions.length)
    );
    const page = await fetchActiveStudyCaptionPage(supabase, profileId, {
      captionIds: batchIds,
      includePrivateStudies,
      includeExpired,
      now,
      studyId,
    });

    if (page.error) {
      return {
        captionOrder: [],
        captions: [],
        error: page.error,
        nextOffset: null,
      };
    }

    captions.push(...page.captions);
    const consumedCount: number = nextOffset + batchIds.length;
    nextOffset = consumedCount < captionOrder.length ? consumedCount : null;
  }

  return {
    captionOrder,
    captions,
    error: null,
    nextOffset,
  };
}
