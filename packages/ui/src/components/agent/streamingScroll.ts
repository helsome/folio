export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/** Keep following output only while the reader remains near the bottom. */
export function isNearScrollBottom(metrics: ScrollMetrics, threshold = 48): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

