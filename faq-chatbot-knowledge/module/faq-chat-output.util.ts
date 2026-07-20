/** Deduplicate citation ids while preserving first-seen order. */
export function dedupeCitationIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * If the model answered in-scope but omitted citations, attach top retrieved section ids
 * for audit (content was still grounded on those chunks in the prompt).
 */
export function applyRetrievalCitationFallback(
  outOfScope: boolean,
  citedFaqIds: string[],
  retrievedStableIdsInRankOrder: string[],
  maxFill: number,
  enabled: boolean,
): string[] {
  const deduped = dedupeCitationIds(citedFaqIds);
  if (outOfScope || !enabled || deduped.length > 0) return deduped;
  const k = Math.max(0, Math.min(maxFill, retrievedStableIdsInRankOrder.length));
  return dedupeCitationIds(retrievedStableIdsInRankOrder.slice(0, k));
}

/** Heuristic: user is asking for the compliance / certificates checklist in Section 7. */
export function wantsComplianceCertificateChecklist(userMessage: string): boolean {
  const u = userMessage.toLowerCase();
  if (!u.includes('compliance')) return false;
  if (!u.includes('certificate') && !u.includes('certificates')) return false;
  return (
    u.includes('checklist') ||
    u.includes('full list') ||
    u.includes('list from') ||
    u.includes('document only') ||
    u.includes('no extras')
  );
}
