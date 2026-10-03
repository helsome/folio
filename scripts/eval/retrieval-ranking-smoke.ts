import {
  rankRetrievalSources,
  type RetrievalSourceInput,
} from '../../packages/shared/src/retrieval/index.ts';

interface AlgoliaHit {
  objectID?: unknown;
  url?: unknown;
  title?: unknown;
  created_at_i?: unknown;
}

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim() || 'NVIDIA earnings';
  const endpoint = new URL('https://hn.algolia.com/api/v1/search');
  endpoint.searchParams.set('query', query);
  endpoint.searchParams.set('tags', 'story');
  endpoint.searchParams.set('hitsPerPage', '50');

  const response = await fetch(endpoint, {
    headers: { 'user-agent': 'Folio retrieval-ranking smoke test' },
  });
  if (!response.ok) {
    throw new Error(
      'Algolia search failed with HTTP ' + response.status + ' ' + response.statusText
    );
  }
  const payload = (await response.json()) as { hits?: AlgoliaHit[] };
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  const sources: RetrievalSourceInput[] = [];
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index];
    if (typeof hit.url !== 'string' || typeof hit.title !== 'string') continue;
    sources.push({
      id:
        typeof hit.objectID === 'string'
          ? 'hn-' + hit.objectID
          : 'hn-' + index,
      title: hit.title.trim(),
      url: hit.url,
      publishedAt:
        typeof hit.created_at_i === 'number'
          ? hit.created_at_i * 1000
          : undefined,
      provider: 'hn-algolia',
      available: true,
    });
  }

  const searchedAt = Date.now();
  const result = rankRetrievalSources(sources, {
    query,
    now: searchedAt,
    topK: 10,
    maxPerDomain: 2,
  });
  const evidence = {
    query,
    endpoint: endpoint.toString(),
    searchedAt,
    rawCount: sources.length,
    policyVersion: result.policyVersion,
    independentSourceCount: result.independentSourceCount,
    clusterCount: result.clusters.length,
    selectedCount: result.selected.length,
    selected: result.selected.map((item) => ({
      id: item.source.id,
      title: item.source.title,
      url: item.canonicalUrl,
      domain: item.domain,
      sourceClass: item.sourceClass,
      qualityScore: item.qualityScore,
      clusterId: item.clusterId,
      reason: item.decisionReason,
    })),
    dropped: result.dropped.map((item) => ({
      id: item.source.id,
      clusterId: item.clusterId,
      reason: item.decisionReason,
    })),
  };
  console.log(JSON.stringify(evidence, null, 2));
  if (sources.length === 0 || result.selected.length === 0) {
    process.exitCode = 1;
  }
}

await main();
