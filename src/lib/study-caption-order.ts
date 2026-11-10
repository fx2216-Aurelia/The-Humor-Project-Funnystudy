export const STUDY_CAPTION_BATCH_SIZE = 200;

export function shuffleStudyCaptionIds(captionIds: readonly string[]) {
  const shuffled = [...captionIds];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function stableHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function orderStudyCaptionIdsForParticipant(
  captionIds: readonly string[],
  profileId: string,
  studyId: number
) {
  const seed = `${profileId}:${studyId}:`;

  return [...new Set(captionIds)].sort((left, right) => {
    const leftHash = stableHash(`${seed}${left}`);
    const rightHash = stableHash(`${seed}${right}`);

    return leftHash - rightHash || left.localeCompare(right);
  });
}
