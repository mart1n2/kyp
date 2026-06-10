interface NoteLike {
  data: { date: Date; updated?: Date };
}

/** Newest first by effective date (updated wins over original publish). */
export function compareNotes(a: NoteLike, b: NoteLike): number {
  const aTime = (a.data.updated ?? a.data.date).getTime();
  const bTime = (b.data.updated ?? b.data.date).getTime();
  if (aTime !== bTime) return bTime - aTime;
  // tiebreak: a freshly-updated note ranks above a same-date original publish
  if (a.data.updated && !b.data.updated) return -1;
  if (!a.data.updated && b.data.updated) return 1;
  return 0;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function readingTime(markdown: string): string {
  const words = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 220))} min read`;
}
