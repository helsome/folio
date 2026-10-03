# Retrieval ranking and deduplication

Folio applies deterministic source normalization before news results enter
Deep Research synthesis. The policy implementation is in
`packages/shared/src/retrieval` and is versioned as `folio-retrieval-v1`.

The pipeline:

1. canonicalizes URLs, removes tracking parameters and fragments, and sorts
   meaningful query parameters;
2. normalizes titles and fingerprints excerpts;
3. clusters same-URL, same-title, same-content, and near-duplicate results;
4. scores cluster representatives using source class, freshness, query
   relevance, and availability;
5. selects Top-K with a per-domain diversity limit.

Regulators, exchanges, and configured issuer domains receive primary-source
priority. Established news outlets remain useful for independent reporting;
aggregators receive a lower deterministic base score. Every selected or
dropped result records its original rank, cluster id, decision reason, and the
ranking policy version in the Research data bundle.

## Live smoke run

The live smoke command calls the public Hacker News Algolia search API, then
runs the same ranking module used by `ResearchRunner`:

```sh
bun run eval:retrieval-ranking-live -- "NVIDIA earnings"
```

It prints machine-readable JSON containing the search endpoint, raw count,
clusters, selected source set, and dropped reasons. The command intentionally
fails when search returns no usable sources. This is an explicit live check,
not part of ordinary unit tests or CI.

## Boundaries

Version 1 does not fetch article bodies or resolve network redirects. Providers
may supply a resolved `canonicalUrl`; otherwise Folio uses deterministic URL,
title, and excerpt signals. UI display of clusters and claim-level citation
verification remain separate integration work.
