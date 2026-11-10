"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { buildThumbnailVariants } from "@/lib/thumbnails";

export function SwipeVoteCard({
  captionId,
  imageSrc,
  preloadImageUrls,
}: {
  captionId: string;
  imageSrc: string | null;
  preloadImageUrls?: string[];
}) {
  const preloadedImages = useRef<Set<string>>(new Set());
  const [loadedImageSrc, setLoadedImageSrc] = useState<string | null>(null);
  const [failedThumbnailSrc, setFailedThumbnailSrc] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const thumbSources = useMemo(
    () => buildThumbnailVariants(imageSrc),
    [imageSrc]
  );
  const activeThumbSources = failedThumbnailSrc === imageSrc ? null : thumbSources;
  const displaySrc = activeThumbSources?.src ?? imageSrc ?? undefined;
  const displaySrcSet = activeThumbSources?.srcSet;
  const displaySizes = activeThumbSources?.sizes;
  const isContentVisible = !displaySrc || loadedImageSrc === displaySrc;

  const handleImageError = useCallback(() => {
    if (activeThumbSources) {
      setFailedThumbnailSrc(imageSrc);
      return;
    }

    setLoadedImageSrc(displaySrc ?? "__error__");
  }, [activeThumbSources, displaySrc, imageSrc]);

  useEffect(() => {
    let resetFrameId: number | null = null;

    if (!displaySrc) {
      resetFrameId = window.requestAnimationFrame(() => {
        setLoadedImageSrc(null);
      });
      return () => {
        if (resetFrameId !== null) {
          window.cancelAnimationFrame(resetFrameId);
        }
      };
    }

    resetFrameId = window.requestAnimationFrame(() => {
      setLoadedImageSrc(null);
    });

    const img = imageRef.current;

    if (!img) {
      return () => {
        if (resetFrameId !== null) {
          window.cancelAnimationFrame(resetFrameId);
        }
      };
    }

    const syncLoadedImageState = () => {
      if (!img.complete) {
        return false;
      }

      if (!img.naturalWidth) {
        handleImageError();
        return true;
      }

      setLoadedImageSrc(displaySrc);
      return true;
    };

    const syncFrameId = window.requestAnimationFrame(() => {
      syncLoadedImageState();
    });

    return () => {
      if (resetFrameId !== null) {
        window.cancelAnimationFrame(resetFrameId);
      }
      window.cancelAnimationFrame(syncFrameId);
    };
  }, [displaySrc, handleImageError]);

  useEffect(() => {
    if (!preloadImageUrls?.length) return;

    type PreloadTarget = {
      key: string;
      src: string;
      srcSet?: string;
      sizes?: string;
    };

    const preloadTargets = preloadImageUrls
      .map((url): PreloadTarget | null => {
        const variants = buildThumbnailVariants(url);
        if (variants) {
          return {
            key: variants.original ?? variants.src ?? variants.grid ?? url,
            src: variants.src ?? variants.grid ?? url,
            srcSet: variants.srcSet,
            sizes: variants.sizes,
          };
        }

        if (!url) return null;
        return { key: url, src: url };
      })
      .filter((target): target is PreloadTarget => Boolean(target));

    preloadTargets.forEach(({ key, src, srcSet, sizes }) => {
      if (!key || preloadedImages.current.has(key)) return;

      preloadedImages.current.add(key);
      preloadedImages.current.add(key);
      const img = new window.Image();

      if (srcSet) {
        img.onerror = () => {
          img.onerror = null;
          img.removeAttribute("srcset");
          img.removeAttribute("sizes");
          img.src = key;
        };
      }

      if (srcSet) {
        img.srcset = srcSet;
      }
      if (sizes) {
        img.sizes = sizes;
      }

      img.src = src;
    });
  }, [preloadImageUrls]);

  return (
    <div
      id="caption-card"
      className="relative mx-auto flex h-full min-h-[144px] w-full max-w-3xl flex-1 items-stretch"
      data-caption-id={captionId}
    >
      <div
        id="caption-card-stack"
        className="flex h-full min-h-[144px] w-full flex-col items-center overflow-hidden rounded-3xl border border-[#ece8df] bg-[#fffefa] p-3 shadow-[0_8px_26px_-8px_rgba(104,91,76,0.08)] sm:p-5"
      >
        {displaySrc ? (
          <div
            id="caption-card-image-frame"
            className="relative mx-auto flex min-h-[112px] w-full max-w-3xl flex-1 overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-surface)]"
          >
            <div
              id="caption-card-skeleton"
              className={`pointer-events-none absolute inset-0 overflow-hidden bg-[var(--surface-muted)] transition-opacity duration-300 ${
                isContentVisible ? "opacity-0" : "opacity-100"
              }`}
              aria-hidden
            >
              <div className="skeleton-shine absolute inset-0" />
            </div>
            <img
              key={displaySrc}
              ref={imageRef}
              src={displaySrc}
              srcSet={displaySrcSet}
              sizes={displaySizes}
              alt="Caption related"
              fetchPriority="high"
              loading="eager"
              decoding="async"
              className={`absolute inset-0 block h-full max-h-full w-full max-w-full object-contain transition-opacity duration-300 ${
                isContentVisible ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => {
                setLoadedImageSrc(displaySrc);
              }}
              onError={handleImageError}
            />
          </div>
        ) : (
          <div
            id="caption-card-image-frame"
            className="flex min-h-[140px] w-full max-w-3xl flex-1 items-center justify-center rounded-2xl border border-[var(--card-border)] bg-[var(--card-surface)] text-sm text-[var(--muted)]"
          >
            Image unavailable
          </div>
        )}
      </div>
    </div>
  );
}
