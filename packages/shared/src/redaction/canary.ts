import { SECRET_PATTERNS, REDACTED } from './patterns.ts';

/**
 * Canary secret scanner (issue #19).
 *
 * Scans arbitrary data (strings, JSON, files, artifacts) for known secret
 * patterns. Used in tests and CI to prove that no secrets leaked into
 * logs, diagnostics, traces, eval artifacts, or pending telemetry payloads.
 *
 * Usage in tests:
 *   const scanner = new CanaryScanner();
 *   scanner.injectCanaries(testContext);
 *   // ... run the system ...
 *   const leaks = scanner.scanAll(producedArtifacts);
 *   expect(leaks).toHaveLength(0);
 */

export interface CanarySecret {
  /** Unique identifier for this canary (e.g., 'test-openai-key'). */
  id: string;
  /** The fake secret value to inject and scan for. */
  value: string;
  /** Where it was injected (for reporting). */
  source?: string;
}

export interface ScanResult {
  /** Total items scanned. */
  scanned: number;
  /** Any canary secrets that were found (leaked). */
  leaks: CanarySecret[];
  /** Whether any known secret patterns were detected in the content. */
  patternLeaks: Array<{ pattern: string; sample: string; path?: string }>;
}

/**
 * Generate a set of realistic-looking fake secrets for testing.
 * These are deterministic, obviously fake, and must never be real credentials.
 */
export function generateCanarySeeds(): CanarySecret[] {
  return [
    {
      id: 'openai-api-key',
      value: 'sk-test-' + 'a'.repeat(24),
      source: 'environment',
    },
    {
      id: 'anthropic-api-key',
      value: 'sk-ant-test-' + 'b'.repeat(24),
      source: 'tool-input',
    },
    {
      id: 'aws-access-key',
      value: 'AKIA' + 'C'.repeat(16),
      source: 'environment',
    },
    {
      id: 'bearer-token',
      value: 'Bearer ' + 'd'.repeat(32),
      source: 'http-header',
    },
    {
      id: 'jwt-token',
      value:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiJ0ZXN0IiwibmFtZSI6IkNhbmFyeSJ9.' +
        'e' + 'f'.repeat(43),
      source: 'cookie',
    },
    {
      id: 'github-pat',
      value: 'ghp_' + 'g'.repeat(36),
      source: 'git-config',
    },
    {
      id: 'langsmith-key',
      value: 'lsv2_pt_' + 'h'.repeat(48),
      source: 'environment',
    },
    {
      id: 'connection-string',
      value: 'postgresql://testuser:testpass@localhost:5432/testdb',
      source: 'config',
    },
    {
      id: 'url-secret',
      value: 'https://api.example.com/data?api_key=test_' + 'i'.repeat(20),
      source: 'tool-result',
    },
  ];
}

/**
 * Scanner that checks data for leaked canary secrets and known secret patterns.
 */
export class CanaryScanner {
  private readonly canaries: CanarySecret[];

  constructor(canaries?: CanarySecret[]) {
    this.canaries = canaries ?? generateCanarySeeds();
  }

  /**
   * Scan a string for canary secrets and known patterns.
   */
  scanString(text: string, path = '<root>'): ScanResult {
    const leaks: CanarySecret[] = [];
    const patternLeaks: Array<{ pattern: string; sample: string; path?: string }> = [];

    // Check for canary secrets
    for (const canary of this.canaries) {
      if (text.includes(canary.value)) {
        leaks.push({ ...canary, source: canary.source ?? path });
      }
    }

    // Check for known secret patterns (make sure redaction actually happened)
    for (const [pattern, replacement] of SECRET_PATTERNS) {
      // Skip if the pattern would match the REDACTED placeholder itself
      if (pattern.source.includes(REDACTED)) continue;
      const matches = text.match(pattern);
      if (matches) {
        patternLeaks.push({
          pattern: pattern.source.slice(0, 60),
          sample: matches[0].slice(0, 80),
          path,
        });
      }
    }

    return { scanned: 1, leaks, patternLeaks };
  }

  /**
   * Recursively scan an arbitrary JSON value (object, array, string, …).
   */
  scanValue(value: unknown, path = '<root>'): ScanResult {
    const result: ScanResult = { scanned: 0, leaks: [], patternLeaks: [] };

    const walk = (node: unknown, currentPath: string) => {
      result.scanned++;
      if (typeof node === 'string') {
        const sub = this.scanString(node, currentPath);
        result.leaks.push(...sub.leaks);
        result.patternLeaks.push(...sub.patternLeaks);
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${currentPath}[${i}]`));
        return;
      }
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, `${currentPath}.${key}`);
      }
    };

    walk(value, path);
    return result;
  }

  /**
   * Scan multiple artifacts and combine results.
   * Artifacts can be strings, objects, or { name, data } pairs.
   */
  scanAll(artifacts: Array<{ name: string; data: unknown }>): ScanResult {
    const combined: ScanResult = { scanned: 0, leaks: [], patternLeaks: [] };
    for (const artifact of artifacts) {
      const result = this.scanValue(artifact.data, artifact.name);
      combined.scanned += result.scanned;
      combined.leaks.push(...result.leaks);
      combined.patternLeaks.push(...result.patternLeaks);
    }
    return combined;
  }

  /**
   * Check if the scan found any leaks.
   */
  hasLeaks(result: ScanResult): boolean {
    return result.leaks.length > 0 || result.patternLeaks.length > 0;
  }
}
