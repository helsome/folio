// Typed financial answer blocks (#31).
//
// Copilot answers may embed a small set of versioned, schema-validated blocks
// next to Markdown text. Blocks are carried inside the answer string as
// fenced code (`folio-block` language) so persistence and reload come free:
// the renderer parses, validates, and either renders deterministically or
// degrades to text. Renderers only read the typed fields below — a block can
// never cause arbitrary code to execute.

/** Current block schema version. Bump when the shape changes incompatibly. */
export const ANSWER_BLOCK_SCHEMA_VERSION = 1;

/** Fence language that marks a typed block inside an answer string. */
export const ANSWER_BLOCK_FENCE_LANG = 'folio-block';

/**
 * Canonical unit semantics. Values are plain numbers — units and currencies
 * are explicit fields, never free-text suffixes.
 * - `price`: amount of `currency` (ISO 4217).
 * - `percent`: percentage points, already ×100 (1.23 → "1.23%").
 * - `ratio`: 0–1 fraction, rendered ×100 (0.0123 → "1.23%").
 * - `count`: bare number.
 */
export type AnswerBlockUnit = 'price' | 'percent' | 'ratio' | 'count';

interface AnswerBlockBase {
  /** Must equal ANSWER_BLOCK_SCHEMA_VERSION; mismatched blocks degrade to text. */
  version: number;
  /** Optional display heading above the block. */
  title?: string;
  /** Data-source slug (e.g. `demo` for built-in sample data) shown in the footer. */
  source?: string;
  /** References into the run's tool-call / evidence records (#29/#30). */
  evidenceIds?: string[];
}

export interface AnswerBlockMetric {
  label: string;
  value: number;
  unit: AnswerBlockUnit;
  /** ISO 4217 code; required when unit is `price`. */
  currency?: string;
  /** ISO 8601 instant the value is valid at. */
  asOf?: string;
  change?: number;
  changePercent?: number;
  evidenceIds?: string[];
}

export interface MetricGridBlock extends AnswerBlockBase {
  type: 'metric_grid';
  metrics: AnswerBlockMetric[];
}

export interface AnswerBlockColumn {
  key: string;
  label: string;
  unit?: AnswerBlockUnit;
  currency?: string;
}

export interface DataTableBlock extends AnswerBlockBase {
  type: 'data_table';
  columns: AnswerBlockColumn[];
  rows: Array<Record<string, string | number | null>>;
}

export interface TimeSeriesChartBlock extends AnswerBlockBase {
  type: 'time_series_chart';
  unit: AnswerBlockUnit;
  currency?: string;
  /** ISO 8601 x-axis instants, in ascending order. */
  points: Array<{ t: string; v: number }>;
  asOf?: string;
}

export interface ComparisonTableBlock extends AnswerBlockBase {
  type: 'comparison_table';
  columns: Array<{ id: string; label: string }>;
  rows: Array<{
    label: string;
    unit?: AnswerBlockUnit;
    currency?: string;
    /** One value per column; null renders as an explicit gap. */
    values: Array<string | number | null>;
  }>;
}

export type AnswerBlock =
  | MetricGridBlock
  | DataTableBlock
  | TimeSeriesChartBlock
  | ComparisonTableBlock;

export type AnswerBlockType = AnswerBlock['type'];

// ── Runtime validation ──────────────────────────────────────────────────────
// Hand-written guards instead of a dependency: the shapes are small, and the
// validators double as the security boundary for model-authored JSON.

const MAX_METRICS = 12;
const MAX_COLUMNS = 12;
const MAX_ROWS = 50;
const MAX_POINTS = 400;
const MAX_STRING = 160;

export interface AnswerBlockParseResult {
  ok: boolean;
  block?: AnswerBlock;
  /** Machine-readable failure reason for telemetry/degraded rendering. */
  reason?: 'invalid_json' | 'invalid_schema' | 'unsupported_version' | 'unknown_type';
}

export function isAnswerBlockUnit(value: unknown): value is AnswerBlockUnit {
  return value === 'price' || value === 'percent' || value === 'ratio' || value === 'count';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

function isShortString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING;
}

function isEvidenceIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 8
    && value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_STRING);
}

/** Data-source slugs are short lowercase identifiers (`demo`, `longbridge`). */
function isSourceSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,39}$/.test(value);
}

/** Table cells may be empty strings; labels and headers may not. */
function isTableCell(value: unknown): value is string | number | null {
  return value === null || isFiniteNumber(value) || (typeof value === 'string' && value.length <= MAX_STRING);
}

function validateBase(value: Record<string, unknown>): 'unsupported_version' | 'invalid_schema' | true {
  if (value.version !== ANSWER_BLOCK_SCHEMA_VERSION) return 'unsupported_version';
  if (value.title !== undefined && !isShortString(value.title)) return 'invalid_schema';
  if (value.source !== undefined && !isSourceSlug(value.source)) return 'invalid_schema';
  if (value.evidenceIds !== undefined && !isEvidenceIds(value.evidenceIds)) return 'invalid_schema';
  return true;
}

function validateMetric(value: unknown): value is AnswerBlockMetric {
  if (!isRecord(value)) return false;
  if (!isShortString(value.label) || !isFiniteNumber(value.value) || !isAnswerBlockUnit(value.unit)) return false;
  if (value.unit === 'price' && !isCurrencyCode(value.currency)) return false;
  if (value.currency !== undefined && !isCurrencyCode(value.currency)) return false;
  if (value.asOf !== undefined && !isIsoString(value.asOf)) return false;
  if (value.change !== undefined && !isFiniteNumber(value.change)) return false;
  if (value.changePercent !== undefined && !isFiniteNumber(value.changePercent)) return false;
  if (value.evidenceIds !== undefined && !isEvidenceIds(value.evidenceIds)) return false;
  return true;
}

function validateMetricGrid(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.metrics) || value.metrics.length === 0 || value.metrics.length > MAX_METRICS) return false;
  return value.metrics.every((metric) => validateMetric(metric));
}

function validateDataTable(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.columns) || value.columns.length === 0 || value.columns.length > MAX_COLUMNS) return false;
  const keys = new Set<string>();
  for (const column of value.columns) {
    if (!isRecord(column)) return false;
    if (!isShortString(column.key) || !isShortString(column.label)) return false;
    if (column.unit !== undefined && !isAnswerBlockUnit(column.unit)) return false;
    if (column.currency !== undefined && !isCurrencyCode(column.currency)) return false;
    if (column.unit === 'price' && !isCurrencyCode(column.currency)) return false;
    keys.add(column.key);
  }
  if (!Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > MAX_ROWS) return false;
  for (const row of value.rows) {
    if (!isRecord(row)) return false;
    for (const cellValue of Object.values(row)) {
      if (!isTableCell(cellValue)) return false;
    }
  }
  // Every column must be representable, even if a row omits it (null gap).
  return keys.size === value.columns.length;
}

function validateTimeSeriesChart(value: Record<string, unknown>): boolean {
  if (!isAnswerBlockUnit(value.unit)) return false;
  if (value.unit === 'price' && !isCurrencyCode(value.currency)) return false;
  if (value.currency !== undefined && !isCurrencyCode(value.currency)) return false;
  if (value.asOf !== undefined && !isIsoString(value.asOf)) return false;
  if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > MAX_POINTS) return false;
  let previous = '';
  for (const point of value.points) {
    if (!isRecord(point)) return false;
    if (!isIsoString(point.t) || !isFiniteNumber(point.v)) return false;
    if (previous !== '' && point.t <= previous) return false; // ascending, strictly
    previous = point.t;
  }
  return true;
}

function validateComparisonTable(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.columns) || value.columns.length < 2 || value.columns.length > MAX_COLUMNS) return false;
  for (const column of value.columns) {
    if (!isRecord(column)) return false;
    if (!isShortString(column.id) || !isShortString(column.label)) return false;
  }
  if (!Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > MAX_ROWS) return false;
  for (const row of value.rows) {
    if (!isRecord(row)) return false;
    if (!isShortString(row.label)) return false;
    if (row.unit !== undefined && !isAnswerBlockUnit(row.unit)) return false;
    if (row.currency !== undefined && !isCurrencyCode(row.currency)) return false;
    if (row.unit === 'price' && !isCurrencyCode(row.currency)) return false;
    if (!Array.isArray(row.values) || row.values.length !== value.columns.length) return false;
    for (const cell of row.values) {
      if (!isTableCell(cell)) return false;
    }
  }
  return true;
}

/**
 * Validate one untrusted parsed-JSON value as an answer block. Returns a
 * discriminated result instead of throwing; every failure path is safe to
 * degrade to text.
 */
export function validateAnswerBlock(value: unknown): AnswerBlockParseResult {
  if (!isRecord(value)) return { ok: false, reason: 'invalid_schema' };
  const base = validateBase(value);
  if (base !== true) return { ok: false, reason: base === 'unsupported_version' ? 'unsupported_version' : 'invalid_schema' };
  if (!isShortString(value.type)) return { ok: false, reason: 'invalid_schema' };
  switch (value.type) {
    case 'metric_grid':
      if (validateMetricGrid(value)) return { ok: true, block: value as unknown as MetricGridBlock };
      return { ok: false, reason: 'invalid_schema' };
    case 'data_table':
      if (validateDataTable(value)) return { ok: true, block: value as unknown as DataTableBlock };
      return { ok: false, reason: 'invalid_schema' };
    case 'time_series_chart':
      if (validateTimeSeriesChart(value)) return { ok: true, block: value as unknown as TimeSeriesChartBlock };
      return { ok: false, reason: 'invalid_schema' };
    case 'comparison_table':
      if (validateComparisonTable(value)) return { ok: true, block: value as unknown as ComparisonTableBlock };
      return { ok: false, reason: 'invalid_schema' };
    default:
      return { ok: false, reason: 'unknown_type' };
  }
}

/** Parse and validate a raw block payload (the fenced JSON body). */
export function parseAnswerBlock(raw: string): AnswerBlockParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  return validateAnswerBlock(parsed);
}
