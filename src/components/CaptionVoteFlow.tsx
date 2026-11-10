"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";
import { endStudy, startStudy } from "@/app/study/actions";
import type { StudyParticipation } from "@/lib/study-participation";
import type { StudyStats } from "@/lib/study-stats";
import {
  CompletedStudy,
  type StudyHighlight,
} from "@/components/CompletedStudy";
import { STUDY_CAPTION_BATCH_SIZE } from "@/lib/study-caption-order";

import {
  loadMoreCaptionVoteCaptions,
  saveCaptionNavigationEvent,
  saveCaptionVote,
} from "@/app/actions";
import {
  type StudyVoteValue,
  type VoteInputMethod,
} from "@/lib/caption-votes";

import { SwipeVoteCard } from "./SwipeVoteCard";

export type CaptionForVote = {
  id: string;
  isLiked: boolean;
  isSaved: boolean;
  rating: StudyVoteValue | null;
  content: string | null;
  imageSrc: string | null;
  studyCaptionMappingId: number | null;
};

const VOTE_SESSION_STORAGE_KEY = "captionVoteSessionId";
const TOUCH_NAVIGATION_THRESHOLD_PX = 52;
const WHEEL_NAVIGATION_THRESHOLD_PX = 32;
const WHEEL_GESTURE_IDLE_MS = 350;
const GESTURE_NAVIGATION_COOLDOWN_MS = 350;
const MILESTONE_CHEER = (milestoneCount: number) =>
  `${milestoneCount} down! You're on fire! 🦁🎉`;
const REGULAR_CHEERS = [
  "Great eye!",
  "Thanks for your insight!",
  "Roar-some work!",
] as const;
const STUDY_RATING_OPTIONS = [
  {
    score: 1,
    emoji: "🥱",
    label: "Boring",
    value: "not funny at all",
    color: "border-sky-100 bg-sky-50 text-[#405661] hover:bg-sky-100",
    selectedColor: "border-sky-300 bg-sky-100 text-[#29495b] ring-1.5 ring-sky-200",
  },
  {
    score: 2,
    emoji: "😐",
    label: "Neutral",
    value: "meh",
    color: "border-amber-100 bg-amber-50 text-[#62563e] hover:bg-amber-100",
    selectedColor: "border-amber-300 bg-amber-100 text-[#59451f] ring-1.5 ring-amber-200",
  },
  {
    score: 3,
    emoji: "😄",
    label: "Funny",
    value: "funny",
    color: "border-emerald-100 bg-emerald-50 text-[#3e594a] hover:bg-emerald-100",
    selectedColor: "border-emerald-300 bg-emerald-100 text-[#2e5540] ring-1.5 ring-emerald-200",
  },
  {
    score: 4,
    emoji: "🤣",
    label: "Hilarious",
    value: "very funny",
    color: "border-pink-100 bg-pink-50 text-[#63474d] hover:bg-pink-100",
    selectedColor: "border-pink-300 bg-pink-100 text-[#633843] ring-1.5 ring-pink-200",
  },
] as const satisfies readonly {
  score: number;
  emoji: string;
  label: string;
  value: StudyVoteValue;
  color: string;
  selectedColor: string;
}[];

type VoteEventDetails = {
  clientEventId: string;
  inputMethod: VoteInputMethod;
  sessionId: string;
  timeToVoteMs: number;
};

type NavigationEventDetails = {
  clientEventId: string;
  inputMethod: VoteInputMethod;
  sessionId: string;
  timeToNextCaptionMs: number;
};

type TouchGestureState = {
  active: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
};

type VoteStatus = "saving" | "saved";
type SessionStudyStatsState = {
  likedCaptionTimeMsByKey: Record<string, number>;
  navigationTimeMsByKey: Record<string, number>;
  viewedCaptionKeys: Record<string, true>;
};
type CaptionFlipDirection = "backward" | "forward";

function createEmptySessionStudyStats(): SessionStudyStatsState {
  return {
    likedCaptionTimeMsByKey: {},
    navigationTimeMsByKey: {},
    viewedCaptionKeys: {},
  };
}

function getMedianValue(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex];
  }

  return Math.round(
    (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2
  );
}

function summarizeCompletionStats(
  sessionStudyStats: SessionStudyStatsState,
  ratingsByKey: Record<string, StudyVoteValue>,
  viewedCountFloor = 0
): StudyStats {
  const likedCount = Object.values(ratingsByKey).filter(
    (rating) => rating === "funny" || rating === "very funny"
  ).length;
  const viewedCount = Math.max(
    viewedCountFloor,
    Object.keys(sessionStudyStats.viewedCaptionKeys).length,
    Object.keys(ratingsByKey).length
  );
  const medianVoteTimeMs = getMedianValue(
    Object.values(sessionStudyStats.likedCaptionTimeMsByKey)
  );
  const medianNavigationTimeMs = getMedianValue(
    Object.values(sessionStudyStats.navigationTimeMsByKey)
  );

  return {
    likedCount,
    medianNavigationTimeMs,
    medianVoteTimeMs,
    viewedCount,
  };
}

function getNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeWheelDeltaX(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaX * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaX * (window.innerWidth || 1);
  }

  return event.deltaX;
}

function isCaptionTimerActive() {
  if (typeof document === "undefined") {
    return false;
  }

  return document.visibilityState === "visible" && document.hasFocus();
}

function createClientUuid() {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getCaptionVoteKey(caption: CaptionForVote | undefined) {
  if (!caption) {
    return null;
  }

  if (
    typeof caption.studyCaptionMappingId === "number" &&
    Number.isSafeInteger(caption.studyCaptionMappingId) &&
    caption.studyCaptionMappingId > 0
  ) {
    return `mapping:${caption.studyCaptionMappingId}`;
  }

  return `caption:${caption.id}`;
}

function createPersistedVoteStatusLookup(captions: readonly CaptionForVote[]) {
  return captions.reduce<Record<string, VoteStatus>>((lookup, caption) => {
    if (!caption.rating && !caption.isLiked) {
      return lookup;
    }

    const voteKey = getCaptionVoteKey(caption);

    if (voteKey) {
      lookup[voteKey] = "saved";
    }

    return lookup;
  }, {});
}

function createCaptionRatingLookup(captions: readonly CaptionForVote[]) {
  return captions.reduce<Record<string, StudyVoteValue>>((lookup, caption) => {
    const voteKey = getCaptionVoteKey(caption);
    const rating = caption.rating ?? (caption.isLiked ? "funny" : null);

    if (voteKey && rating) {
      lookup[voteKey] = rating;
    }

    return lookup;
  }, {});
}

function shouldIgnoreKeyboardNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], #account-menu-root, #theme-menu-root, [data-native-scroll-region='true'], [data-rating-scale='true']"
    )
  );
}

function shouldIgnoreWheelNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], #account-menu-root, #theme-menu-root, [data-native-scroll-region='true']"
    )
  );
}

function shouldIgnoreTouchNavigationTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], #account-menu-root, #theme-menu-root, [data-native-scroll-region='true']"
    )
  );
}

export function CaptionVoteFlow({
  captionOrder,
  captions,
  includeExpired,
  includePrivateStudies,
  initialNextOffset,
  initialTotalCaptionCount,
  initialParticipation,
  studyId,
  onPendingChange,
}: {
  captionOrder: string[];
  captions: CaptionForVote[];
  includeExpired?: boolean;
  includePrivateStudies?: boolean;
  initialNextOffset: number | null;
  initialTotalCaptionCount: number;
  initialParticipation: StudyParticipation | null;
  studyId?: number | null;
  onPendingChange?: (count: number) => void;
}) {
  const [isStartPageVisible, setIsStartPageVisible] = useState(
    captions.length > 0
  );
  const [queue, setQueue] = useState(captions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isShortViewport, setIsShortViewport] = useState(false);
  const [isLoadingMoreCaptions, setIsLoadingMoreCaptions] = useState(false);
  const [nextCaptionOffset, setNextCaptionOffset] = useState(initialNextOffset);
  const [pendingCount, setPendingCount] = useState(0);
  const [participation, setParticipation] = useState(initialParticipation);
  const [participationPending, setParticipationPending] = useState(false);
  const participationPendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [captionFlipDirection, setCaptionFlipDirection] =
    useState<CaptionFlipDirection>("forward");
  const [isWheelNavigationOverlayVisible, setIsWheelNavigationOverlayVisible] =
    useState(false);
  const [ratingsByKey, setRatingsByKey] = useState<Record<string, StudyVoteValue>>(
    () => createCaptionRatingLookup(captions)
  );
  const [isCompletionPageVisible, setIsCompletionPageVisible] = useState(false);
  const [hasSubmittedCompletion, setHasSubmittedCompletion] = useState(false);
  const [mascotMessage, setMascotMessage] = useState(
    "You're doing amazing! Every vote counts ✨"
  );
  const [isMilestoneMessage, setIsMilestoneMessage] = useState(false);
  const [sessionStudyStats, setSessionStudyStats] =
    useState<SessionStudyStatsState>(() => createEmptySessionStudyStats());
  const [voteStatuses, setVoteStatuses] = useState<Record<string, VoteStatus>>(
    () => createPersistedVoteStatusLookup(captions)
  );
  const activeVoteTimeMs = useRef(0);
  const activeVoteStartedAtMs = useRef<number | null>(
    isCaptionTimerActive() ? getNowMs() : null
  );
  const activeNavigationTimeMs = useRef(0);
  const activeNavigationStartedAtMs = useRef<number | null>(
    isCaptionTimerActive() ? getNowMs() : null
  );
  const currentIndexRef = useRef(0);
  const touchGestureRef = useRef<TouchGestureState>({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });
  const voteSessionIdRef = useRef<string | null>(null);
  const wheelGestureRef = useRef<{
    accumulatedX: number;
    isLocked: boolean;
    lastEventTimeMs: number;
  }>({
    accumulatedX: 0,
    isLocked: false,
    lastEventTimeMs: 0,
  });
  const lastGestureNavigationTimeMsRef = useRef<number | null>(null);
  const regularCheerIndexRef = useRef(0);
  const mascotMessageTimeoutRef = useRef<number | null>(null);
  const requestedCaptionOffsetsRef = useRef<Set<number>>(new Set());
  const wheelNavigationOverlayTimeoutIdRef = useRef<number | null>(null);
  const wheelNavigationOverlayVisibleRef = useRef(false);

  useEffect(() => {
    onPendingChange?.(pendingCount);
  }, [onPendingChange, pendingCount]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    wheelNavigationOverlayVisibleRef.current = isWheelNavigationOverlayVisible;
  }, [isWheelNavigationOverlayVisible]);

  useEffect(() => {
    const maxIndex = Math.max(0, queue.length - 1);

    setCurrentIndex((previousIndex) => {
      const clampedIndex = Math.min(previousIndex, maxIndex);
      currentIndexRef.current = clampedIndex;
      return clampedIndex;
    });
  }, [queue.length]);

  useEffect(() => {
    setQueue(captions);
    setVoteStatuses(createPersistedVoteStatusLookup(captions));
    setRatingsByKey(createCaptionRatingLookup(captions));
    setIsCompletionPageVisible(false);
    setHasSubmittedCompletion(false);
    setNextCaptionOffset(initialNextOffset);
    requestedCaptionOffsetsRef.current.clear();
  }, [captions, initialNextOffset]);

  useEffect(() => {
    return () => {
      if (wheelNavigationOverlayTimeoutIdRef.current !== null) {
        window.clearTimeout(wheelNavigationOverlayTimeoutIdRef.current);
      }
      if (mascotMessageTimeoutRef.current !== null) {
        window.clearTimeout(mascotMessageTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const updateGutter = () => {
    const height = window.visualViewport?.height ?? window.innerHeight ?? 0;
    setIsShortViewport(height < 620);
    };

    updateGutter();
    window.addEventListener("resize", updateGutter);
    window.addEventListener("orientationchange", updateGutter);

    return () => {
    window.removeEventListener("resize", updateGutter);
    window.removeEventListener("orientationchange", updateGutter);
    };
  }, []);

  const current = queue[currentIndex];
  const currentVoteKey = getCaptionVoteKey(current);
  const currentVoteStatus = currentVoteKey ? voteStatuses[currentVoteKey] : null;
  const studyHighlights: StudyHighlight[] = queue.flatMap((caption) => {
    const voteKey = getCaptionVoteKey(caption);
    const rating = voteKey ? ratingsByKey[voteKey] : null;
    return rating === "funny" || rating === "very funny"
      ? [{
          id: caption.id,
          content: caption.content,
          imageSrc: caption.imageSrc,
          rating,
        }]
      : [];
  }).sort((left, right) => {
    if (left.rating === right.rating) return 0;
    return left.rating === "very funny" ? -1 : 1;
  });
  const isShowingCompletionPage =
    !isStartPageVisible && (queue.length === 0 || isCompletionPageVisible);
  const totalCaptionCount = Math.max(initialTotalCaptionCount, queue.length);
  const currentCaptionNumber =
    current && totalCaptionCount > 0
      ? Math.min(totalCaptionCount, currentIndex + 1)
      : null;
  const captionProgressLabel =
    currentCaptionNumber && totalCaptionCount > 0
      ? `${currentCaptionNumber.toLocaleString("en-US")} / ${totalCaptionCount.toLocaleString("en-US")}`
      : null;
  const shouldShowCaptionProgress =
    Boolean(captionProgressLabel) &&
    !isStartPageVisible &&
    !isShowingCompletionPage;
  const contentBottomPaddingPx = 20;
  const preloadImageUrls = queue
    .slice(currentIndex + 1, currentIndex + 3)
    .map((caption) => caption.imageSrc)
    .filter((url): url is string => Boolean(url));

  const getVoteSessionId = useCallback(() => {
    if (voteSessionIdRef.current) {
      return voteSessionIdRef.current;
    }

    const nextSessionId = createClientUuid();

    try {
      const existingSessionId = window.sessionStorage.getItem(
        VOTE_SESSION_STORAGE_KEY
      );

      if (existingSessionId) {
        voteSessionIdRef.current = existingSessionId;
        return existingSessionId;
      }

      window.sessionStorage.setItem(VOTE_SESSION_STORAGE_KEY, nextSessionId);
    } catch {
      // Storage access can fail in restricted browser contexts; fall back to memory.
    }

    voteSessionIdRef.current = nextSessionId;
    return nextSessionId;
  }, []);

  const pauseVoteTimer = useCallback(() => {
    if (activeVoteStartedAtMs.current === null) {
      return;
    }

    activeVoteTimeMs.current += Math.max(
      0,
      getNowMs() - activeVoteStartedAtMs.current
    );
    activeVoteStartedAtMs.current = null;
  }, []);

  const resumeVoteTimer = useCallback(() => {
    if (activeVoteStartedAtMs.current !== null) {
      return;
    }

    activeVoteStartedAtMs.current = getNowMs();
  }, []);

  const syncVoteTimer = useCallback(() => {
    if (isStartPageVisible || currentVoteStatus || isShowingCompletionPage) {
      pauseVoteTimer();
      return;
    }

    if (isCaptionTimerActive()) {
      resumeVoteTimer();
      return;
    }

    pauseVoteTimer();
  }, [
    isStartPageVisible,
    isShowingCompletionPage,
    currentVoteStatus,
    pauseVoteTimer,
    resumeVoteTimer,
  ]);

  const resetVoteTimer = useCallback(() => {
    activeVoteTimeMs.current = 0;
    activeVoteStartedAtMs.current = isCaptionTimerActive() ? getNowMs() : null;
  }, []);

  const getActiveVoteTimeMs = useCallback(() => {
    const activeSegmentMs =
      activeVoteStartedAtMs.current === null
        ? 0
        : Math.max(0, getNowMs() - activeVoteStartedAtMs.current);

    return Math.max(0, Math.round(activeVoteTimeMs.current + activeSegmentMs));
  }, []);

  const createVoteEventDetails = useCallback(
    (inputMethod: VoteInputMethod): VoteEventDetails => ({
      clientEventId: createClientUuid(),
      inputMethod,
      sessionId: getVoteSessionId(),
      timeToVoteMs: getActiveVoteTimeMs(),
    }),
    [getActiveVoteTimeMs, getVoteSessionId]
  );

  const pauseNavigationTimer = useCallback(() => {
    if (activeNavigationStartedAtMs.current === null) {
      return;
    }

    activeNavigationTimeMs.current += Math.max(
      0,
      getNowMs() - activeNavigationStartedAtMs.current
    );
    activeNavigationStartedAtMs.current = null;
  }, []);

  const resumeNavigationTimer = useCallback(() => {
    if (activeNavigationStartedAtMs.current !== null) {
      return;
    }

    activeNavigationStartedAtMs.current = getNowMs();
  }, []);

  const syncNavigationTimer = useCallback(() => {
    if (isStartPageVisible || isShowingCompletionPage) {
      pauseNavigationTimer();
      return;
    }

    if (isCaptionTimerActive()) {
      resumeNavigationTimer();
      return;
    }

    pauseNavigationTimer();
  }, [
    isStartPageVisible,
    isShowingCompletionPage,
    pauseNavigationTimer,
    resumeNavigationTimer,
  ]);

  const resetNavigationTimer = useCallback(() => {
    activeNavigationTimeMs.current = 0;
    activeNavigationStartedAtMs.current = isCaptionTimerActive()
      ? getNowMs()
      : null;
  }, []);

  const getActiveNavigationTimeMs = useCallback(() => {
    const activeSegmentMs =
      activeNavigationStartedAtMs.current === null
        ? 0
        : Math.max(0, getNowMs() - activeNavigationStartedAtMs.current);

    return Math.max(
      0,
      Math.round(activeNavigationTimeMs.current + activeSegmentMs)
    );
  }, []);

  const createNavigationEventDetails = useCallback(
    (inputMethod: VoteInputMethod): NavigationEventDetails => ({
      clientEventId: createClientUuid(),
      inputMethod,
      sessionId: getVoteSessionId(),
      timeToNextCaptionMs: getActiveNavigationTimeMs(),
    }),
    [getActiveNavigationTimeMs, getVoteSessionId]
  );

  const setVoteStatus = useCallback(
    (voteKey: string | null, status: VoteStatus | null) => {
      if (!voteKey) {
        return;
      }

      setVoteStatuses((prev) => {
        if (status === null) {
          const next = { ...prev };
          delete next[voteKey];
          return next;
        }

        return {
          ...prev,
          [voteKey]: status,
        };
      });
    },
    []
  );

  const appendCaptionBatch = useCallback((incomingCaptions: CaptionForVote[]) => {
    if (!incomingCaptions.length) {
      return;
    }

    const appendedCaptions: CaptionForVote[] = [];

    setQueue((previousQueue) => {
      const seenVoteKeys = new Set(
        previousQueue
          .map((caption) => getCaptionVoteKey(caption))
          .filter((voteKey): voteKey is string => Boolean(voteKey))
      );
      const nextQueue = [...previousQueue];

      incomingCaptions.forEach((caption) => {
        const voteKey = getCaptionVoteKey(caption);

        if (!voteKey || seenVoteKeys.has(voteKey)) {
          return;
        }

        seenVoteKeys.add(voteKey);
        nextQueue.push(caption);
        appendedCaptions.push(caption);
      });

      return nextQueue;
    });

    if (appendedCaptions.length) {
      setVoteStatuses((previousVoteStatuses) => {
        const nextVoteStatuses = { ...previousVoteStatuses };

        appendedCaptions.forEach((caption) => {
          if (!caption.rating && !caption.isLiked) {
            return;
          }

          const voteKey = getCaptionVoteKey(caption);

          if (voteKey) {
            nextVoteStatuses[voteKey] = "saved";
          }
        });

        return nextVoteStatuses;
      });

      setRatingsByKey((previousRatings) => {
        const nextRatings = { ...previousRatings };

        appendedCaptions.forEach((caption) => {
          const voteKey = getCaptionVoteKey(caption);
          const rating = caption.rating ?? (caption.isLiked ? "funny" : null);
          if (voteKey && rating) {
            nextRatings[voteKey] = rating;
          }
        });

        return nextRatings;
      });
    }
  }, []);

  const loadMoreCaptions = useCallback(
    async (offset: number) => {
      if (
        isLoadingMoreCaptions ||
        requestedCaptionOffsetsRef.current.has(offset)
      ) {
        return;
      }

      requestedCaptionOffsetsRef.current.add(offset);
      setIsLoadingMoreCaptions(true);

      try {
        const captionIds = captionOrder.slice(offset, offset + STUDY_CAPTION_BATCH_SIZE);
        const result = await loadMoreCaptionVoteCaptions({
          captionIds,
          includeExpired,
          includePrivateStudies,
          studyId,
        });

        if (!result.success) {
          requestedCaptionOffsetsRef.current.delete(offset);
          setError(
            result.error ?? "We couldn't load more captions. Please try again."
          );
          return;
        }

        appendCaptionBatch(result.captions);
        const consumedCount = offset + captionIds.length;
        setNextCaptionOffset(consumedCount < captionOrder.length ? consumedCount : null);
      } catch (err) {
        console.error("[CaptionVoteFlow] load more captions failed", err);
        requestedCaptionOffsetsRef.current.delete(offset);
        setError("We couldn't load more captions. Please try again.");
      } finally {
        setIsLoadingMoreCaptions(false);
      }
    },
    [appendCaptionBatch, captionOrder, includeExpired, includePrivateStudies, isLoadingMoreCaptions, studyId]
  );

  const showMascotCheer = useCallback((milestoneCount: number | null) => {
    const milestone = milestoneCount !== null;
    if (mascotMessageTimeoutRef.current !== null) {
      window.clearTimeout(mascotMessageTimeoutRef.current);
    }

    if (milestone) {
      setMascotMessage(MILESTONE_CHEER(milestoneCount));
      setIsMilestoneMessage(true);
    } else {
      const cheer =
        REGULAR_CHEERS[regularCheerIndexRef.current % REGULAR_CHEERS.length];
      regularCheerIndexRef.current += 1;
      setMascotMessage(cheer);
      setIsMilestoneMessage(false);
    }

    mascotMessageTimeoutRef.current = window.setTimeout(() => {
      mascotMessageTimeoutRef.current = null;
      setMascotMessage("You're doing amazing! Every vote counts ✨");
      setIsMilestoneMessage(false);
    }, milestone ? 4500 : 2200);
  }, []);

  const celebrateMilestone = useCallback(
    (milestoneCount: number) => {
      console.log("[Confetti] Triggered milestone at", milestoneCount);
      const confettiAnimation = confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#F59E0B", "#8EAF98", "#F2A7B5", "#67D5E8"],
        zIndex: 999999,
        disableForReducedMotion: false,
        ticks: 220,
      });
      if (confettiAnimation) {
        void confettiAnimation.catch((error: unknown) => {
          console.error("[CaptionVoteFlow] confetti failed", error);
        });
      }
      showMascotCheer(milestoneCount);
    },
    [showMascotCheer]
  );

  const moveToCaptionIndex = useCallback(
    (nextIndex: number) => {
      const maxIndex = queue.length - 1;

      if (maxIndex < 0) {
        return false;
      }

      const clampedIndex = Math.min(maxIndex, Math.max(0, nextIndex));

      if (clampedIndex === currentIndexRef.current) {
        return false;
      }

      const previousCompletedCount = currentIndexRef.current + 1;
      const completedCount = clampedIndex + 1;
      currentIndexRef.current = clampedIndex;
      setCurrentIndex(clampedIndex);
      if (completedCount > previousCompletedCount) {
        const firstMilestoneAfterPrevious =
          (Math.floor(previousCompletedCount / 10) + 1) * 10;
        for (
          let milestone = firstMilestoneAfterPrevious;
          milestone <= completedCount;
          milestone += 10
        ) {
          celebrateMilestone(milestone);
        }
      }
      return true;
    },
    [celebrateMilestone, queue.length]
  );

  const saveForwardNavigationTelemetry = useCallback(
    (inputMethod: VoteInputMethod) => {
      if (!current) {
        return;
      }

      const navigationTarget = current;
      const navigationVoteKey = getCaptionVoteKey(navigationTarget);
      const eventDetails = createNavigationEventDetails(inputMethod);

      if (navigationVoteKey) {
        setSessionStudyStats((previousStats) => ({
          likedCaptionTimeMsByKey: previousStats.likedCaptionTimeMsByKey,
          navigationTimeMsByKey: {
            ...previousStats.navigationTimeMsByKey,
            [navigationVoteKey]: eventDetails.timeToNextCaptionMs,
          },
          viewedCaptionKeys: {
            ...previousStats.viewedCaptionKeys,
            [navigationVoteKey]: true,
          },
        }));
      }

      void saveCaptionNavigationEvent({
        captionId: navigationTarget.id,
        clientEventId: eventDetails.clientEventId,
        inputMethod: eventDetails.inputMethod,
        sessionId: eventDetails.sessionId,
        studyCaptionMappingId: navigationTarget.studyCaptionMappingId,
        timeToNextCaptionMs: eventDetails.timeToNextCaptionMs,
      })
        .then((result) => {
          if (!result?.success) {
            console.error(
              "[CaptionVoteFlow] save navigation telemetry failed",
              result?.error
            );
          }
        })
        .catch((err) => {
          console.error("[CaptionVoteFlow] save navigation telemetry failed", err);
        });
    },
    [createNavigationEventDetails, current]
  );

  const handleStartStudy = useCallback(async () => {
    if (participationPendingRef.current || !studyId) return;
    if (participation?.started_at) {
      currentIndexRef.current = 0;
      setCurrentIndex(0);
      setIsCompletionPageVisible(false);
      setHasSubmittedCompletion(false);
      setCaptionFlipDirection("forward");
      setIsStartPageVisible(false);
      return;
    }
    participationPendingRef.current = true;
    setParticipationPending(true);
    setError(null);
    try {
      const result = await startStudy(studyId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setParticipation(result.participation);
      setHasSubmittedCompletion(false);
      setCaptionFlipDirection("forward");
      setIsStartPageVisible(false);
      setIsCompletionPageVisible(Boolean(result.participation.ended_at));
    } catch {
      setError("We couldn't start this study. Please try again.");
    } finally {
      participationPendingRef.current = false;
      setParticipationPending(false);
    }
  }, [participation, studyId]);

  const handleEndStudy = useCallback(async () => {
    if (
      !isShowingCompletionPage ||
      participationPendingRef.current ||
      pendingCount > 0 ||
      !studyId
    ) return;
    participationPendingRef.current = true;
    setParticipationPending(true);
    setError(null);
    try {
      const result = await endStudy(
        studyId,
        summarizeCompletionStats(sessionStudyStats, ratingsByKey)
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setParticipation(result.participation);
      setHasSubmittedCompletion(true);
    } catch {
      setError("We couldn't end this study. Please try again.");
    } finally {
      participationPendingRef.current = false;
      setParticipationPending(false);
    }
  }, [isShowingCompletionPage, pendingCount, ratingsByKey, sessionStudyStats, studyId]);

  const navigateToRelativeCaption = useCallback(
    (offset: -1 | 1, inputMethod: VoteInputMethod) => {
      if (participationPendingRef.current) return false;
      if (isStartPageVisible) {
        if (offset === 1 && current) {
          void handleStartStudy();
          return true;
        }

        return false;
      }

      if (isShowingCompletionPage) {
        if (offset === -1 && current) {
          setCaptionFlipDirection("backward");
          setIsCompletionPageVisible(false);
          return true;
        }

        return true;
      }

      const nextIndex = currentIndexRef.current + offset;

      if (offset === -1 && nextIndex < 0 && current) {
        setCaptionFlipDirection("backward");
        setIsStartPageVisible(true);
        return true;
      }

      if (offset === 1) {
        const maxIndex = queue.length - 1;

        if (maxIndex < 0) {
          setIsCompletionPageVisible(true);
          return true;
        }

        if (nextIndex > maxIndex) {
          if (nextCaptionOffset !== null && !isLoadingMoreCaptions) {
            void loadMoreCaptions(nextCaptionOffset);
            return false;
          }

          if (nextCaptionOffset === null) {
            saveForwardNavigationTelemetry(inputMethod);
            pauseVoteTimer();
            pauseNavigationTimer();
            setIsCompletionPageVisible(true);
            return true;
          }

          return false;
        }

        saveForwardNavigationTelemetry(inputMethod);
      }

      setCaptionFlipDirection(offset === 1 ? "forward" : "backward");
      return moveToCaptionIndex(nextIndex);
    },
    [
      current,
      handleStartStudy,
      isStartPageVisible,
      isShowingCompletionPage,
      isLoadingMoreCaptions,
      loadMoreCaptions,
      moveToCaptionIndex,
      nextCaptionOffset,
      pauseNavigationTimer,
      pauseVoteTimer,
      queue.length,
      saveForwardNavigationTelemetry,
    ]
  );

  const handleWheelNavigation = useCallback(
    (event: WheelEvent) => {
      const deltaX = normalizeWheelDeltaX(event);

      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        shouldIgnoreWheelNavigationTarget(event.target) ||
        Math.abs(deltaX) < 4 ||
        Math.abs(deltaX) < Math.abs(event.deltaY) ||
        queue.length === 0
      ) {
        return;
      }

      event.preventDefault();

      const wheelGesture = wheelGestureRef.current;
      const nowMs = getNowMs();
      const timeSinceLastEventMs = nowMs - wheelGesture.lastEventTimeMs;

      const scheduleWheelNavigationOverlay = () => {
        if (wheelNavigationOverlayTimeoutIdRef.current !== null) {
          window.clearTimeout(wheelNavigationOverlayTimeoutIdRef.current);
        }

        if (!wheelNavigationOverlayVisibleRef.current) {
          wheelNavigationOverlayVisibleRef.current = true;
          setIsWheelNavigationOverlayVisible(true);
        }

        wheelNavigationOverlayTimeoutIdRef.current = window.setTimeout(() => {
          wheelNavigationOverlayTimeoutIdRef.current = null;
          wheelNavigationOverlayVisibleRef.current = false;
          setIsWheelNavigationOverlayVisible(false);
        }, WHEEL_GESTURE_IDLE_MS);
      };

      if (wheelGesture.isLocked) {
        if (timeSinceLastEventMs > WHEEL_GESTURE_IDLE_MS) {
          wheelGesture.isLocked = false;
          wheelGesture.accumulatedX = 0;
        } else {
          wheelGesture.lastEventTimeMs = nowMs;
          if (wheelNavigationOverlayVisibleRef.current) {
            scheduleWheelNavigationOverlay();
          }
          return;
        }
      } else if (timeSinceLastEventMs > WHEEL_GESTURE_IDLE_MS) {
        wheelGesture.accumulatedX = 0;
      }

      wheelGesture.lastEventTimeMs = nowMs;
      wheelGesture.accumulatedX += deltaX;

      if (Math.abs(wheelGesture.accumulatedX) < WHEEL_NAVIGATION_THRESHOLD_PX) {
        return;
      }

      // Respect the browser/OS direction setting for horizontal wheel input.
      const lastGestureNavigationTimeMs =
        lastGestureNavigationTimeMsRef.current;
      const cooldownElapsed =
        lastGestureNavigationTimeMs === null ||
        nowMs - lastGestureNavigationTimeMs >=
          GESTURE_NAVIGATION_COOLDOWN_MS;
      const didHandleNavigation =
        cooldownElapsed &&
        navigateToRelativeCaption(
          wheelGesture.accumulatedX > 0 ? 1 : -1,
          "swipe"
        );

      wheelGesture.isLocked = true;
      wheelGesture.accumulatedX = 0;
      wheelGesture.lastEventTimeMs = nowMs;

      if (didHandleNavigation) {
        lastGestureNavigationTimeMsRef.current = nowMs;
        scheduleWheelNavigationOverlay();
      }
    },
    [navigateToRelativeCaption, queue.length]
  );

  const handleTouchStart = useCallback((event: TouchEvent) => {
    if (
      event.defaultPrevented ||
      shouldIgnoreTouchNavigationTarget(event.target) ||
      event.touches.length !== 1
    ) {
      touchGestureRef.current.active = false;
      return;
    }

    const touch = event.touches[0];

    touchGestureRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
    };
  }, []);

  const tryNavigateFromTouchGesture = useCallback(
    (endX: number, endY: number) => {
      const touchGesture = touchGestureRef.current;

      if (!touchGesture.active) {
        return false;
      }

      const deltaX = endX - touchGesture.startX;
      const deltaY = endY - touchGesture.startY;

      if (
        Math.abs(deltaX) < TOUCH_NAVIGATION_THRESHOLD_PX ||
        Math.abs(deltaX) < Math.abs(deltaY) * 1.15
      ) {
        return false;
      }

      touchGesture.active = false;
      const nowMs = getNowMs();
      const lastGestureNavigationTimeMs =
        lastGestureNavigationTimeMsRef.current;

      if (
        lastGestureNavigationTimeMs !== null &&
        nowMs - lastGestureNavigationTimeMs <
          GESTURE_NAVIGATION_COOLDOWN_MS
      ) {
        return false;
      }

      const didHandleNavigation = navigateToRelativeCaption(
        deltaX < 0 ? 1 : -1,
        "swipe"
      );
      if (didHandleNavigation) {
        lastGestureNavigationTimeMsRef.current = nowMs;
      }
      return didHandleNavigation;
    },
    [navigateToRelativeCaption]
  );

  const handleTouchMove = useCallback((event: TouchEvent) => {
    if (!touchGestureRef.current.active || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    touchGestureRef.current.lastX = touch.clientX;
    touchGestureRef.current.lastY = touch.clientY;

    tryNavigateFromTouchGesture(touch.clientX, touch.clientY);
  }, [tryNavigateFromTouchGesture]);

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      const touchGesture = touchGestureRef.current;

      if (!touchGesture.active) {
        return;
      }

      const touch = event.changedTouches[0];
      const endX = touch?.clientX ?? touchGesture.lastX;
      const endY = touch?.clientY ?? touchGesture.lastY;

      if (!tryNavigateFromTouchGesture(endX, endY)) {
        touchGesture.active = false;
      }
    },
    [tryNavigateFromTouchGesture]
  );

  const handleTouchCancel = useCallback(() => {
    touchGestureRef.current.active = false;
  }, []);

  const handleRatingSelect = useCallback((
    rating: StudyVoteValue,
    inputMethod: VoteInputMethod = "button"
  ) => {
    if (
      participationPendingRef.current ||
      !current ||
      !currentVoteKey ||
      currentVoteStatus === "saving" ||
      ratingsByKey[currentVoteKey] === rating
    ) {
      return;
    }

    const voteTarget = current;
    const previousRating = ratingsByKey[currentVoteKey];
    const eventDetails = createVoteEventDetails(inputMethod);
    setPendingCount((count) => count + 1);
    setError(null);
    setRatingsByKey((previousRatings) => ({
      ...previousRatings,
      [currentVoteKey]: rating,
    }));
    pauseVoteTimer();
    setVoteStatus(currentVoteKey, "saving");

    saveCaptionVote({
      captionId: voteTarget.id,
      clientEventId: eventDetails.clientEventId,
      inputMethod: eventDetails.inputMethod,
      sessionId: eventDetails.sessionId,
      studyCaptionMappingId: voteTarget.studyCaptionMappingId,
      timeToVoteMs: eventDetails.timeToVoteMs,
      value: rating,
    })
      .then((result) => {
        if (!result?.success) {
          setRatingsByKey((previousRatings) => {
            const nextRatings = { ...previousRatings };
            if (previousRating) {
              nextRatings[currentVoteKey] = previousRating;
            } else {
              delete nextRatings[currentVoteKey];
            }
            return nextRatings;
          });
          setVoteStatus(currentVoteKey, previousRating ? "saved" : null);
          setError(result?.error ?? "We couldn't save your rating. Please try again.");
          resumeVoteTimer();
          return;
        }

        setVoteStatus(currentVoteKey, "saved");
        const completedCount = currentIndexRef.current + 1;
        if (completedCount % 10 !== 0) {
          showMascotCheer(null);
        }
        setSessionStudyStats((previousStats) => {
          const nextLikedCaptionTimeMsByKey = {
            ...previousStats.likedCaptionTimeMsByKey,
          };
          if (rating === "funny" || rating === "very funny") {
            nextLikedCaptionTimeMsByKey[currentVoteKey] = eventDetails.timeToVoteMs;
          } else {
            delete nextLikedCaptionTimeMsByKey[currentVoteKey];
          }

          return {
            likedCaptionTimeMsByKey: nextLikedCaptionTimeMsByKey,
            navigationTimeMsByKey: previousStats.navigationTimeMsByKey,
            viewedCaptionKeys: {
              ...previousStats.viewedCaptionKeys,
              [currentVoteKey]: true,
            },
          };
        });
      })
      .catch((err) => {
        console.error("[CaptionVoteFlow] save vote failed", err);
        setRatingsByKey((previousRatings) => {
          const nextRatings = { ...previousRatings };
          if (previousRating) {
            nextRatings[currentVoteKey] = previousRating;
          } else {
            delete nextRatings[currentVoteKey];
          }
          return nextRatings;
        });
        setVoteStatus(currentVoteKey, previousRating ? "saved" : null);
        setError("We couldn't save your rating. Please try again.");
        resumeVoteTimer();
      })
      .finally(() => {
        setPendingCount((count) => Math.max(0, count - 1));
      });
  }, [
    createVoteEventDetails,
    current,
    currentVoteKey,
    currentVoteStatus,
    pauseVoteTimer,
    ratingsByKey,
    resumeVoteTimer,
    setVoteStatus,
    showMascotCheer,
  ]);

  const handleKeyboardNavigation = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat
      ) {
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        if (shouldIgnoreKeyboardNavigationTarget(event.target)) return;
        event.preventDefault();
        navigateToRelativeCaption(1, "keyboard");
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        if (shouldIgnoreKeyboardNavigationTarget(event.target)) return;
        event.preventDefault();
        navigateToRelativeCaption(-1, "keyboard");
        return;
      }

      const targetBlocksRatingShortcut =
        event.target instanceof HTMLElement &&
        Boolean(
          event.target.closest(
            "input, textarea, select, [contenteditable='true'], #account-menu-root, #theme-menu-root, [data-native-scroll-region='true']"
          )
        );
      const ratingOption = STUDY_RATING_OPTIONS.find(
        (option) => String(option.score) === event.key
      );
      if (ratingOption && !targetBlocksRatingShortcut) {
        event.preventDefault();
        handleRatingSelect(ratingOption.value, "keyboard");
      }
    },
    [handleRatingSelect, navigateToRelativeCaption]
  );

  useEffect(() => {
    resetVoteTimer();
    resetNavigationTimer();
  }, [current?.id, resetNavigationTimer, resetVoteTimer]);

  useEffect(() => {
    if (isStartPageVisible) {
      pauseVoteTimer();
      pauseNavigationTimer();
      return;
    }

    syncVoteTimer();
    syncNavigationTimer();
  }, [
    isStartPageVisible,
    pauseNavigationTimer,
    pauseVoteTimer,
    syncNavigationTimer,
    syncVoteTimer,
  ]);

  useEffect(() => {
    if (
      isStartPageVisible ||
      !currentVoteKey ||
      isShowingCompletionPage
    ) {
      return;
    }

    setSessionStudyStats((previousStats) =>
      previousStats.viewedCaptionKeys[currentVoteKey]
        ? previousStats
        : {
            likedCaptionTimeMsByKey: previousStats.likedCaptionTimeMsByKey,
            navigationTimeMsByKey: previousStats.navigationTimeMsByKey,
            viewedCaptionKeys: {
              ...previousStats.viewedCaptionKeys,
              [currentVoteKey]: true,
            },
          }
    );
  }, [
    currentVoteKey,
    isStartPageVisible,
    isShowingCompletionPage,
  ]);

  useEffect(() => {
    if (
      nextCaptionOffset === null ||
      isLoadingMoreCaptions ||
      queue.length === 0
    ) {
      return;
    }

    const remainingCaptions = queue.length - currentIndex - 1;

    if (remainingCaptions > 12) {
      return;
    }

    void loadMoreCaptions(nextCaptionOffset);
  }, [
    currentIndex,
    isLoadingMoreCaptions,
    loadMoreCaptions,
    nextCaptionOffset,
    queue.length,
  ]);

  const syncTimers = useCallback(() => {
    syncVoteTimer();
    syncNavigationTimer();
  }, [syncNavigationTimer, syncVoteTimer]);

  useEffect(() => {
    syncTimers();

    document.addEventListener("visibilitychange", syncTimers);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchCancel, {
      passive: true,
    });
    window.addEventListener("wheel", handleWheelNavigation, { passive: false });
    window.addEventListener("keydown", handleKeyboardNavigation);
    window.addEventListener("focus", syncTimers);
    window.addEventListener("blur", syncTimers);

    return () => {
      document.removeEventListener("visibilitychange", syncTimers);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
      window.removeEventListener("wheel", handleWheelNavigation);
      window.removeEventListener("keydown", handleKeyboardNavigation);
      window.removeEventListener("focus", syncTimers);
      window.removeEventListener("blur", syncTimers);
    };
  }, [
    handleKeyboardNavigation,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    handleWheelNavigation,
    syncTimers,
  ]);

  if (!current && !isShowingCompletionPage) {
    return (
      <div
        id="vote-empty-state"
        className="glass-panel rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] p-6 text-[var(--foreground)] shadow-inner"
      >
        <p className="text-lg font-semibold">You&apos;re all caught up</p>
        <p className="text-sm text-[var(--soft)]">
          We&apos;ll surface new in-study captions here as soon as they&apos;re
          ready.
        </p>
        {pendingCount > 0 ? (
          <p className="mt-3 text-xs text-[var(--soft)]">Saving your last vote...</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      id="vote-flow-frame"
      className={`relative flex h-full min-h-0 w-full flex-1 self-stretch flex-col items-center justify-start gap-4 text-center pt-2 sm:pt-3 ${
        isShortViewport ? "pb-1" : ""
      }`}
      style={{
        paddingBottom: `calc(${contentBottomPaddingPx}px + env(safe-area-inset-bottom, 0px))`,
        touchAction: isShowingCompletionPage ? "auto" : "pan-y",
      }}
    >
      {error ? (
        <p role="alert" className="relative z-10 w-full max-w-xl shrink-0 rounded-xl bg-[var(--error-bg)] px-4 py-3 text-sm font-semibold text-[var(--error-text)] ring-1 ring-[var(--error-border)]">
          {error}
        </p>
      ) : null}
      {hasSubmittedCompletion && participation ? (
        <CompletedStudy
          participation={participation}
          highlights={studyHighlights}
          onEdit={() => {
            currentIndexRef.current = 0;
            setCurrentIndex(0);
            setIsCompletionPageVisible(false);
            setHasSubmittedCompletion(false);
            setIsStartPageVisible(false);
            setCaptionFlipDirection("forward");
          }}
        />
      ) : isStartPageVisible ? (
        <StudyStartPage
          onStart={handleStartStudy}
          pending={participationPending}
          hasStarted={Boolean(participation?.started_at)}
          hasCompleted={Boolean(participation?.ended_at)}
        />
      ) : isShowingCompletionPage ? (
        <StudyEndPage
          pendingCount={pendingCount}
          onEnd={handleEndStudy}
          ending={participationPending}
        />
      ) : (
        <>
          {shouldShowCaptionProgress && currentCaptionNumber !== null ? (
            <StudyProgressIndicator
              current={currentCaptionNumber}
              total={totalCaptionCount}
              label={captionProgressLabel ?? ""}
              mascotMessage={mascotMessage}
              isMilestoneMessage={isMilestoneMessage}
              completedCount={currentCaptionNumber}
            />
          ) : null}
          <CaptionPrompt content={current.content} />
          <div className="flex min-h-[160px] w-full flex-1 items-stretch gap-1.5 sm:min-h-[220px] sm:gap-4">
            <button
              type="button"
              onClick={() => navigateToRelativeCaption(-1, "button")}
              aria-label="Previous caption"
              disabled={participationPending}
              className="flex h-9 w-9 shrink-0 self-center items-center justify-center rounded-full border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] text-lg text-[var(--foreground)] shadow-[0_3px_12px_rgba(87,75,64,0.06)] hover:-translate-x-0.5 hover:border-[var(--accent-strong)] disabled:opacity-40 sm:h-12 sm:w-auto sm:gap-2 sm:rounded-2xl sm:px-4 sm:text-sm sm:font-semibold"
            >
              <span aria-hidden>←</span>
              <span className="hidden sm:inline">Previous</span>
            </button>
            <div className="caption-flip-stage flex min-h-0 min-w-0 flex-1 items-stretch justify-center overflow-hidden">
            <div
              key={current.id}
              className={`caption-flip-card caption-flip-card--${captionFlipDirection} flex h-full min-h-0 w-full items-stretch`}
            >
              <SwipeVoteCard
                captionId={current.id}
                imageSrc={current.imageSrc}
                preloadImageUrls={preloadImageUrls}
              />
            </div>
          </div>
            <button
              type="button"
              onClick={() => navigateToRelativeCaption(1, "button")}
              aria-label={currentIndex >= totalCaptionCount - 1 ? "Finish study" : "Next caption"}
              disabled={participationPending || isLoadingMoreCaptions}
              className={`flex h-9 shrink-0 self-center items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold shadow-[0_3px_12px_rgba(87,75,64,0.06)] transition sm:h-12 sm:rounded-2xl sm:px-4 sm:text-sm ${
                currentIndex >= totalCaptionCount - 1 && nextCaptionOffset === null
                  ? "border-[var(--accent-strong)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:brightness-105"
                  : "border-[var(--panel-border)] bg-[var(--vote-panel-surface)] text-[var(--foreground)] hover:translate-x-0.5 hover:border-[var(--accent-strong)]"
              }`}
            >
              <span className="sm:hidden">
                {currentIndex >= totalCaptionCount - 1 && nextCaptionOffset === null
                  ? "Finish"
                  : "Next"}
              </span>
              <span className="hidden sm:inline">
                {currentIndex >= totalCaptionCount - 1 && nextCaptionOffset === null
                  ? "Finish / Submit Study"
                  : "Next"}
              </span>
              <span aria-hidden className="text-xl">{currentIndex >= totalCaptionCount - 1 && nextCaptionOffset === null ? "✓" : "→"}</span>
            </button>
          </div>
          <RatingScale
            selectedValue={currentVoteKey ? ratingsByKey[currentVoteKey] : undefined}
            pending={currentVoteStatus === "saving"}
            onSelect={(value) => handleRatingSelect(value)}
          />
        </>
      )}
      {isWheelNavigationOverlayVisible ? <WheelNavigationOverlay /> : null}
    </div>
  );
}

function CaptionPrompt({ content }: { content: string | null }) {
  return (
    <div
      id="caption-card-caption"
      className="mt-1 mb-2 max-h-[18svh] w-full max-w-3xl shrink-0 overflow-y-auto overscroll-contain px-3 text-center sm:mt-2 sm:mb-4 sm:max-h-[20svh] sm:px-5"
    >
      <p className="whitespace-pre-wrap break-words font-sans text-base font-medium leading-relaxed text-stone-800 sm:text-lg">
        {content?.trim() || "No caption text"}
      </p>
    </div>
  );
}

function StudyStartPage({ onStart, pending, hasStarted, hasCompleted }: {
  onStart: () => void;
  pending: boolean;
  hasStarted: boolean;
  hasCompleted: boolean;
}) {
  return (
    <div className="flex min-h-0 w-full max-w-xl flex-1 items-center sm:max-w-2xl">
      <div data-native-scroll-region="true" className="glass-panel relative max-h-full w-full overflow-y-auto overscroll-contain rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-6 text-left text-[var(--foreground)] shadow-[var(--vote-panel-shadow)] sm:p-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-20 top-8 h-36 w-36 rounded-full bg-[#6b9080]/10 blur-3xl" />
          <div className="absolute right-0 bottom-0 h-44 w-44 translate-x-[20%] translate-y-[20%] rounded-full bg-amber-200/15 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
        </div>
        <div className="relative flex flex-col gap-4 sm:gap-5">
          <h1 className="mb-2 text-center font-black uppercase tracking-[0.05em] text-[var(--foreground)] sm:mb-3">
            <span className="block text-2xl sm:text-3xl">Welcome To</span>
            <span className="mt-1 block whitespace-nowrap text-[clamp(1.1rem,6vw,2.5rem)] leading-none tracking-[0.03em] sm:text-4xl sm:tracking-[0.05em]">
              The Humor Study
              <span className="ml-0.5 inline-block align-super text-xs leading-none sm:ml-1 sm:text-lg">
                TM
              </span>
            </span>
          </h1>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            Rate each caption from boring to hilarious.
          </p>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            You&apos;ll see one caption at a time. Choose a rating, then use
            Previous and Next to move through the study.
          </p>
          <p className="text-base leading-8 text-[var(--foreground)]/92 sm:text-lg">
            When you reach the final caption, finish the study to save your
            responses and see your humor stats.
          </p>
          <button type="button" onClick={onStart} disabled={pending}
            className="mt-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-base font-semibold text-[var(--accent-contrast)] disabled:cursor-wait disabled:opacity-60">
            {pending ? "Starting…" : hasCompleted ? "Edit previous responses" : hasStarted ? "Continue Study" : "Start Study"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudyEndPage({ pendingCount, onEnd, ending }: {
  pendingCount: number;
  onEnd: () => void;
  ending: boolean;
}) {
  return (
    <div className="flex min-h-0 w-full max-w-xl flex-1 items-center sm:max-w-2xl">
      <div data-native-scroll-region="true" className="glass-panel max-h-full w-full overflow-y-auto overscroll-contain rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-6 text-center shadow-[var(--vote-panel-shadow)] sm:p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">You&apos;ve reached the end!</h1>
        <p className="mt-4 text-sm leading-6 text-[var(--soft)] sm:text-base">
          End the study to save your completion and see your humor stats.
        </p>
        {pendingCount > 0 ? (
          <p role="status" className="mt-4 text-sm text-[var(--soft)]">Saving your last vote…</p>
        ) : null}
        <button type="button" onClick={onEnd} disabled={ending || pendingCount > 0}
          className="mt-6 w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-contrast)] disabled:cursor-wait disabled:opacity-60">
          {ending ? "Submitting…" : "Finish / Submit Study"}
        </button>
      </div>
    </div>
  );
}

function WheelNavigationOverlay() {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
      <div className="absolute inset-0 bg-[var(--overlay)]/45 backdrop-blur-[6px]" />
      <div className="glass-panel relative rounded-2xl border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] px-5 py-4 text-[var(--foreground)] shadow-[var(--vote-panel-shadow)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--soft)]">
          Loading
        </p>
        <div className="mt-3 flex items-center justify-center gap-2" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]/80 animate-pulse [animation-delay:120ms]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]/60 animate-pulse [animation-delay:240ms]" />
        </div>
      </div>
    </div>,
    document.body
  );
}

function StudyProgressIndicator({
  current,
  total,
  label,
  mascotMessage,
  isMilestoneMessage,
  completedCount,
}: {
  current: number;
  total: number;
  label: string;
  mascotMessage: string;
  isMilestoneMessage: boolean;
  completedCount: number;
}) {
  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const milestoneCount = Math.floor(total / 10);

  return (
    <div className="w-full max-w-3xl shrink-0 px-1" aria-label="Study progress">
      <div className="mb-2 flex w-full items-center justify-center gap-2.5" aria-live="polite">
        <LionMascot />
        <p
          key={mascotMessage}
          className={`mascot-speech-pop relative max-w-[calc(100%-4.5rem)] rounded-2xl border px-3 py-1.5 text-left text-[11px] leading-4 shadow-sm sm:max-w-[min(34rem,calc(100%-5rem))] sm:px-4 sm:py-2 sm:text-sm sm:leading-5 ${
            isMilestoneMessage
              ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-200/30 dark:bg-amber-200/10 dark:text-amber-100"
              : "border-[var(--panel-border)] bg-[var(--vote-panel-surface)] text-[var(--muted)]"
          }`}
        >
          <span
            aria-hidden="true"
            className="absolute left-[-6px] top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border-b border-l border-[var(--panel-border)] bg-[var(--vote-panel-surface)]"
          />
          {mascotMessage}
        </p>
      </div>
      <div className="mb-2 flex items-center justify-between text-xs font-semibold tabular-nums text-[var(--muted)] sm:text-sm">
        <span>Study progress</span>
        <span>{label}</span>
      </div>
      <div className="relative h-5">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={current}
          aria-label={`${label} captions`}
          className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full bg-[var(--progress-track)] ring-1 ring-[var(--panel-border)]"
        >
          <div
            className="h-full rounded-full bg-[var(--progress-fill)] transition-[width] duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: milestoneCount }, (_, index) => {
            const milestone = (index + 1) * 10;
            const reached = completedCount >= milestone;
            return (
              <span
                key={milestone}
                aria-hidden="true"
                title={`${milestone} captions`}
                className={`absolute left-0 top-1/2 z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-all duration-500 ${
                  reached
                    ? "scale-[1.2] text-[#fbbf24] drop-shadow-[0_0_6px_rgba(245,158,11,0.75)]"
                    : "scale-100 text-[#d1d5db]"
                }`}
                style={{ left: `${(milestone / total) * 100}%` }}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" focusable="false">
                  <path
                    d="m12 2.8 2.8 5.7 6.3.9-4.55 4.43 1.08 6.27L12 17.14l-5.63 2.96 1.08-6.27L2.9 9.4l6.3-.9L12 2.8Z"
                    fill="currentColor"
                    stroke={reached ? "#f59e0b" : "#9ca3af"}
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            );
          })}
        </div>
      </div>
      <p className="sr-only">
        {label}
      </p>
    </div>
  );
}

function LionMascot() {
  return (
    <span className="relative inline-flex h-[60px] w-[60px] shrink-0 items-center justify-center sm:h-[70px] sm:w-[70px]">
      <svg
        aria-label="Roar-ee the study lion"
        role="img"
        viewBox="0 0 100 100"
        className="h-[60px] w-[60px] animate-[mascot-bob_2.8s_ease-in-out_infinite] sm:h-[70px] sm:w-[70px]"
      >
        <g fill="#F9C868" stroke="#F3B24D" strokeWidth="1.5">
          <circle cx="50" cy="17" r="15" />
          <circle cx="68" cy="22" r="15" />
          <circle cx="80" cy="37" r="15" />
          <circle cx="81" cy="57" r="15" />
          <circle cx="70" cy="74" r="15" />
          <circle cx="50" cy="81" r="15" />
          <circle cx="30" cy="74" r="15" />
          <circle cx="19" cy="57" r="15" />
          <circle cx="20" cy="37" r="15" />
          <circle cx="32" cy="22" r="15" />
        </g>
        <ellipse cx="29" cy="35" rx="10" ry="12" fill="#FFF1D8" />
        <ellipse cx="71" cy="35" rx="10" ry="12" fill="#FFF1D8" />
        <ellipse cx="29" cy="36" rx="5.5" ry="7" fill="#FFBDC7" />
        <ellipse cx="71" cy="36" rx="5.5" ry="7" fill="#FFBDC7" />
        <ellipse cx="50" cy="50" rx="30" ry="29" fill="#FFF9EB" stroke="#F1E5CD" strokeWidth="1.5" />
        <ellipse cx="38" cy="52" rx="6.3" ry="8.2" fill="#2D1F1D" />
        <ellipse cx="62" cy="52" rx="6.3" ry="8.2" fill="#2D1F1D" />
        <circle cx="36" cy="49" r="2.5" fill="#FFFFFF" />
        <circle cx="40.2" cy="55.3" r="1.2" fill="#FFFFFF" />
        <circle cx="60" cy="49" r="2.5" fill="#FFFFFF" />
        <circle cx="64.2" cy="55.3" r="1.2" fill="#FFFFFF" />
        <ellipse cx="30" cy="62" rx="7.5" ry="4.2" fill="#FF9AA2" opacity=".65" />
        <ellipse cx="70" cy="62" rx="7.5" ry="4.2" fill="#FF9AA2" opacity=".65" />
        <path d="M46.5 62.3c0-2 1.5-3.4 3.5-3.4s3.5 1.4 3.5 3.4c0 1.7-1.6 2.5-3.5 2.5s-3.5-.8-3.5-2.5Z" fill="#5D4037" />
        <path d="M50 64.8v2.1m0 0c-1.8 2.5-4.6 3.5-7.4 2m7.4-2c1.8 2.5 4.6 3.5 7.4 2" fill="none" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="mascot-floating-heart mascot-floating-heart--one"
      >
        <path d="M12 21s-8.5-5.2-8.5-11.2A4.7 4.7 0 0 1 12 7.3a4.7 4.7 0 0 1 8.5 2.5C20.5 15.8 12 21 12 21Z" />
      </svg>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="mascot-floating-heart mascot-floating-heart--two"
      >
        <path d="M12 21s-8.5-5.2-8.5-11.2A4.7 4.7 0 0 1 12 7.3a4.7 4.7 0 0 1 8.5 2.5C20.5 15.8 12 21 12 21Z" />
      </svg>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="mascot-floating-heart mascot-floating-heart--three"
      >
        <path d="M12 21s-8.5-5.2-8.5-11.2A4.7 4.7 0 0 1 12 7.3a4.7 4.7 0 0 1 8.5 2.5C20.5 15.8 12 21 12 21Z" />
      </svg>
    </span>
  );
}

function RatingScale({
  selectedValue,
  pending,
  onSelect,
}: {
  selectedValue: StudyVoteValue | undefined;
  pending: boolean;
  onSelect: (value: StudyVoteValue) => void;
}) {
  return (
    <div className="w-full max-w-3xl shrink-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
        How funny is this?
      </p>
      <div
        role="group"
        aria-label="Rate this caption"
        data-rating-scale="true"
        className="grid grid-cols-4 gap-1.5 sm:gap-2"
      >
        {STUDY_RATING_OPTIONS.map((option) => {
          const selected = selectedValue === option.value;
          return (
            <button
              key={option.score}
              type="button"
              onClick={() => onSelect(option.value)}
              disabled={pending}
              aria-pressed={selected}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 text-[11px] font-semibold transition-all duration-200 disabled:cursor-wait disabled:opacity-70 sm:px-3 sm:text-sm sm:py-2.5 ${
                selected
                  ? `${option.selectedColor} scale-[1.02]`
                  : `${option.color} hover:-translate-y-0.5`
              }`}
            >
              <span className="text-xl leading-none" aria-hidden>{option.emoji}</span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      {pending ? <p role="status" className="sr-only">Saving rating</p> : null}
    </div>
  );
}
