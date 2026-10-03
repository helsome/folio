/**
 * Deterministic retrieval normalization, deduplication and diversity ranking.
 *
 * LLMs may enrich source metadata later, but they are never the only ranking
 * signal. Every decision records the policy version and an explainable reason.
 */

export const RETRIEVAL_RANKING_POLICY_VERSION = 'folio-retrieval-v1';

export type SourceClass =
  | 'regulator'
  | 'exchange'
  | 'issuer'
  | 'established_news'
  | 'aggregator'
  | 'other';

export type DuplicateRelation =
  | 'same_url'
  | 'same_title'
  | 'same_content'
  | 'near_duplicate';

export interface RetrievalSourceInput {
  id: string;
  title: string;
  url: string;
  excerpt?: string;
  publishedAt?: number;
  provider?: string;
  canonicalUrl?: string;
  available?: boolean;
}

export interface RankedSource {
  source: RetrievalSourceInput;
  originalRank: number;
  canonicalUrl: string;
  domain: string;
  normalizedTitle: string;
  contentHash?: string;
  sourceClass: SourceClass;
  qualityScore: number;
  clusterId: string;
  selected: boolean;
  decisionReason: string;
}

export interface SourceCluster {
  id: string;
  representativeId: string;
  memberIds: string[];
  duplicateRelations: Array<{
    sourceId: string;
    relation: DuplicateRelation;
  }>;
  sourceClass: SourceClass;
  qualityScore: number;
}

export interface RetrievalRankingResult {
  policyVersion: string;
  selected: RankedSource[];
  dropped: RankedSource[];
  clusters: SourceCluster[];
  independentSourceCount: number;
}

export interface RetrievalRankingOptions {
  query?: string;
  now?: number;
  topK?: number;
  maxPerDomain?: number;
  issuerDomains?: string[];
  nearDuplicateThreshold?: number;
}

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'source',
]);

const REGULATOR_DOMAINS = [
  'sec.gov',
  'fca.org.uk',
  'sfc.hk',
  'mas.gov.sg',
  'csrc.gov.cn',
];

const EXCHANGE_DOMAINS = [
  'hkex.com.hk',
  'hkexnews.hk',
  'nasdaq.com',
  'nyse.com',
  'sgx.com',
  'sse.com.cn',
  'szse.cn',
];

const ESTABLISHED_NEWS_DOMAINS = [
  'reuters.com',
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'apnews.com',
  'cnbc.com',
];

const AGGREGATOR_DOMAINS = [
  'finance.yahoo.com',
  'news.google.com',
  'msn.com',
  'marketscreener.com',
];

const CLASS_SCORE: Record<SourceClass, number> = {
  regulator: 50,
  exchange: 48,
  issuer: 45,
  established_news: 35,
  aggregator: 15,
  other: 20,
};

function isDomain(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith('.' + candidate);
}

export function canonicalizeSourceUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
        url.searchParams.delete(key);
      }
    }
    const sorted = [...url.searchParams.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    );
    url.search = '';
    for (const [key, value] of sorted) url.searchParams.append(key, value);
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

export function normalizeSourceTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    normalizeSourceTitle(text)
      .split(' ')
      .filter((token) => token.length > 1)
  );
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function classifySource(
  domain: string,
  issuerDomains: readonly string[]
): SourceClass {
  if (REGULATOR_DOMAINS.some((candidate) => isDomain(domain, candidate))) {
    return 'regulator';
  }
  if (EXCHANGE_DOMAINS.some((candidate) => isDomain(domain, candidate))) {
    return 'exchange';
  }
  if (issuerDomains.some((candidate) => isDomain(domain, candidate.toLowerCase()))) {
    return 'issuer';
  }
  if (ESTABLISHED_NEWS_DOMAINS.some((candidate) => isDomain(domain, candidate))) {
    return 'established_news';
  }
  if (AGGREGATOR_DOMAINS.some((candidate) => isDomain(domain, candidate))) {
    return 'aggregator';
  }
  return 'other';
}

function qualityScore(
  source: RetrievalSourceInput,
  sourceClass: SourceClass,
  query: string,
  now: number
): number {
  let score = CLASS_SCORE[sourceClass];
  if (source.available === false) score -= 30;
  if (source.publishedAt !== undefined && Number.isFinite(source.publishedAt)) {
    const ageDays = Math.max(0, now - source.publishedAt) / 86_400_000;
    if (ageDays <= 1) score += 15;
    else if (ageDays <= 7) score += 10;
    else if (ageDays <= 30) score += 5;
  }
  const queryTokens = tokens(query);
  const sourceTokens = tokens(source.title + ' ' + (source.excerpt ?? ''));
  let matches = 0;
  for (const token of queryTokens) if (sourceTokens.has(token)) matches += 1;
  score += Math.min(15, matches * 5);
  return score;
}

function duplicateRelation(
  left: RankedSource,
  right: RankedSource,
  threshold: number
): DuplicateRelation | undefined {
  if (left.canonicalUrl === right.canonicalUrl) return 'same_url';
  if (
    left.normalizedTitle.length > 0 &&
    left.normalizedTitle === right.normalizedTitle &&
    isWithinSyndicationWindow(left.source.publishedAt, right.source.publishedAt)
  ) {
    return 'same_title';
  }
  if (
    left.contentHash !== undefined &&
    left.contentHash === right.contentHash
  ) {
    return 'same_content';
  }
  const leftText = left.source.excerpt || left.source.title;
  const rightText = right.source.excerpt || right.source.title;
  if (
    similarity(leftText, rightText) >= threshold &&
    isWithinSyndicationWindow(left.source.publishedAt, right.source.publishedAt)
  ) {
    return 'near_duplicate';
  }
  return undefined;
}

function isWithinSyndicationWindow(
  left: number | undefined,
  right: number | undefined
): boolean {
  if (
    left === undefined ||
    right === undefined ||
    !Number.isFinite(left) ||
    !Number.isFinite(right)
  ) {
    return true;
  }
  return Math.abs(left - right) <= 7 * 86_400_000;
}

function makeRanked(
  source: RetrievalSourceInput,
  originalRank: number,
  options: Required<Pick<RetrievalRankingOptions, 'query' | 'now'>> &
    Pick<RetrievalRankingOptions, 'issuerDomains'>
): RankedSource {
  const canonicalUrl = canonicalizeSourceUrl(source.canonicalUrl ?? source.url);
  const domain = domainOf(canonicalUrl);
  const normalizedTitle = normalizeSourceTitle(source.title);
  const content = source.excerpt?.trim();
  const sourceClass = classifySource(domain, options.issuerDomains ?? []);
  return {
    source,
    originalRank,
    canonicalUrl,
    domain,
    normalizedTitle,
    contentHash: content ? stableHash(normalizeSourceTitle(content)) : undefined,
    sourceClass,
    qualityScore: qualityScore(source, sourceClass, options.query, options.now),
    clusterId: '',
    selected: false,
    decisionReason: '',
  };
}

/**
 * Cluster duplicate sources, rank one representative per independent source,
 * then apply a deterministic per-domain diversity limit.
 */
export function rankRetrievalSources(
  sources: readonly RetrievalSourceInput[],
  options: RetrievalRankingOptions = {}
): RetrievalRankingResult {
  const query = options.query ?? '';
  const now = options.now ?? Date.now();
  const topK = Math.max(1, Math.floor(options.topK ?? 10));
  const maxPerDomain = Math.max(1, Math.floor(options.maxPerDomain ?? 2));
  const threshold = options.nearDuplicateThreshold ?? 0.82;
  const ranked = sources.map((source, index) =>
    makeRanked(source, index, {
      query,
      now,
      issuerDomains: options.issuerDomains,
    })
  );

  const groups: Array<{
    members: RankedSource[];
    relations: Array<{ sourceId: string; relation: DuplicateRelation }>;
  }> = [];
  for (const candidate of ranked) {
    let match:
      | {
          group: (typeof groups)[number];
          relation: DuplicateRelation;
        }
      | undefined;
    for (const group of groups) {
      for (const member of group.members) {
        const relation = duplicateRelation(candidate, member, threshold);
        if (relation) {
          match = { group, relation };
          break;
        }
      }
      if (match) break;
    }
    if (match) {
      match.group.members.push(candidate);
      match.group.relations.push({
        sourceId: candidate.source.id,
        relation: match.relation,
      });
    } else {
      groups.push({ members: [candidate], relations: [] });
    }
  }

  const clusters: SourceCluster[] = [];
  const representatives: RankedSource[] = [];
  for (const group of groups) {
    group.members.sort(
      (left, right) =>
        right.qualityScore - left.qualityScore ||
        left.originalRank - right.originalRank
    );
    const representative = group.members[0];
    const clusterId =
      'cluster-' +
      stableHash(
        representative.canonicalUrl ||
          representative.normalizedTitle ||
          representative.source.id
      );
    for (const member of group.members) member.clusterId = clusterId;
    for (const duplicate of group.members.slice(1)) {
      duplicate.decisionReason = 'duplicate_of:' + representative.source.id;
    }
    representatives.push(representative);
    clusters.push({
      id: clusterId,
      representativeId: representative.source.id,
      memberIds: group.members.map((member) => member.source.id),
      duplicateRelations: group.relations,
      sourceClass: representative.sourceClass,
      qualityScore: representative.qualityScore,
    });
  }

  representatives.sort(
    (left, right) =>
      right.qualityScore - left.qualityScore ||
      left.originalRank - right.originalRank
  );

  const domainCounts = new Map<string, number>();
  const selected: RankedSource[] = [];
  for (const candidate of representatives) {
    const domainCount = domainCounts.get(candidate.domain) ?? 0;
    if (selected.length >= topK) {
      candidate.decisionReason = 'top_k_limit';
      continue;
    }
    if (candidate.domain && domainCount >= maxPerDomain) {
      candidate.decisionReason = 'domain_diversity_limit';
      continue;
    }
    candidate.selected = true;
    candidate.decisionReason = 'selected_by_quality_and_diversity';
    selected.push(candidate);
    if (candidate.domain) domainCounts.set(candidate.domain, domainCount + 1);
  }

  const dropped = ranked
    .filter((source) => !source.selected)
    .sort((left, right) => left.originalRank - right.originalRank);

  return {
    policyVersion: RETRIEVAL_RANKING_POLICY_VERSION,
    selected,
    dropped,
    clusters,
    independentSourceCount: clusters.length,
  };
}
