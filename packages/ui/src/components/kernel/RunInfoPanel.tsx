/**
 * Run Info view (#21).
 *
 * Renders an immutable run-config manifest (RunManifest) in a human-readable
 * form, offers a secret-free JSON export, and can show a structured two-run
 * diff. The manifest never contains credentials — redaction happens at capture
 * time in `@finagent/shared`, so the JSON shown here is safe to copy/share.
 */
import React, { useEffect, useState } from 'react';
import type { RunManifest, RunManifestDiff } from '@finagent/core';
import { Dialog } from '../primitives/Dialog';
import { useFinagentClient } from '../../client';

const RUNTIME_MODE_LABEL: Record<RunManifest['runtimeMode'], string> = {
  local: '本地运行时',
  pi: 'Pi 运行时',
  demo: '演示数据',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 py-[3px] text-[12px]">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 break-words text-foreground">{value}</span>
    </div>
  );
}

function modelParamsText(params?: RunManifest['modelParams']): string | undefined {
  if (!params) return undefined;
  const parts: string[] = [];
  if (params.api) parts.push(`api=${params.api}`);
  if (params.baseUrl) parts.push(`baseUrl=${params.baseUrl}`);
  if (params.thinkingLevel) parts.push(`thinking=${params.thinkingLevel}`);
  if (params.contextWindow) parts.push(`ctx=${params.contextWindow}`);
  if (params.maxTokens) parts.push(`max=${params.maxTokens}`);
  if (params.reasoning !== undefined) parts.push(`reasoning=${params.reasoning}`);
  return parts.length ? parts.join(' · ') : undefined;
}

function featureFlagsText(flags?: RunManifest['featureFlags']): string | undefined {
  if (!flags || Object.keys(flags).length === 0) return undefined;
  return Object.entries(flags)
    .map(([key, value]) => `${key}=${value}`)
    .join(' · ');
}

function toolsText(tools?: RunManifest['tools']): string | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => tool.name).join(', ');
}

const JsonExport: React.FC<{ manifest: RunManifest }> = ({ manifest }) => {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(manifest, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-text-muted">JSON 导出（已脱敏）</span>
        <button
          type="button"
          onClick={copy}
          className="rounded-[6px] bg-foreground/8 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-foreground/14"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="max-h-56 overflow-auto rounded-[6px] bg-foreground/6 p-2.5 text-[10.5px] leading-relaxed text-foreground/90">
        {text}
      </pre>
    </div>
  );
};

const ManifestView: React.FC<{ manifest: RunManifest }> = ({ manifest: m }) => (
  <div>
    <div className="mb-3 flex items-center gap-2">
      <span className="rounded-[6px] bg-accent/14 px-2 py-0.5 text-[11px] font-medium text-accent">
        {RUNTIME_MODE_LABEL[m.runtimeMode]}
      </span>
      <span className="text-[12px] text-text-muted">
        {m.provider ?? '—'} · {m.model ?? '—'}
      </span>
    </div>
    <Field label="模型" value={m.model} />
    <Field label="Provider" value={m.provider} />
    <Field label="模型参数" value={modelParamsText(m.modelParams)} />
    <Field
      label="策略"
      value={
        m.strategy
          ? `${m.strategy.id ?? '—'}${m.strategy.version ? ` · ${m.strategy.version}` : ''}`
          : undefined
      }
    />
    <Field label="提示词版本" value={m.prompt?.version} />
    <Field label="提示词哈希" value={m.prompt?.hash} />
    <Field label="提示词来源" value={m.prompt?.source} />
    <Field label="工具" value={toolsText(m.tools)} />
    <Field
      label="检索"
      value={
        m.search?.providerId
          ? `${m.search.providerId}${m.search.configured ? '（已配置）' : '（未配置）'}`
          : undefined
      }
    />
    <Field
      label="检索路由"
      value={
        m.search?.routing ? `${m.search.routing.primary ?? '—'} → ${m.search.routing.fallback ?? '—'}` : undefined
      }
    />
    <Field label="App 版本" value={m.appVersion} />
    <Field label="构建版本" value={m.buildVersion} />
    <Field label="Git 修订" value={m.gitRevision} />
    <Field label="语言" value={m.locale} />
    <Field label="功能开关" value={featureFlagsText(m.featureFlags)} />
    <JsonExport manifest={m} />
  </div>
);

const DiffView: React.FC<{ diff: RunManifestDiff }> = ({ diff }) => (
  <div>
    <div
      className={`mb-3 rounded-[6px] px-2 py-1 text-[12px] font-medium ${
        diff.changed ? 'bg-accent/14 text-accent' : 'bg-foreground/8 text-text-muted'
      }`}
    >
      {diff.changed ? '两次运行配置存在差异' : '两次运行配置一致'}
    </div>
    {diff.changed && (
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        {diff.groups.model && <Badge label="模型" />}
        {diff.groups.prompt && <Badge label="提示词" />}
        {diff.groups.tools && <Badge label="工具" />}
        {diff.groups.config && <Badge label="配置" />}
        {diff.groups.versions && <Badge label="版本" />}
      </div>
    )}
    {diff.changed ? (
      <div className="max-h-72 overflow-auto">
        {diff.fields.map((field) => (
          <div key={field.path} className="border-b border-border/60 py-2 text-[12px]">
            <div className="mb-1 font-medium text-foreground">{field.path}</div>
            <div className="grid grid-cols-[1fr_16px_1fr] items-start gap-1 text-[11px]">
              <span className="break-words text-text-muted">{formatValue(field.before)}</span>
              <span className="text-center text-text-muted">→</span>
              <span className="break-words text-foreground">{formatValue(field.after)}</span>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-[12px] text-text-muted">没有检测到模型、提示词、工具或配置层面的差异。</p>
    )}
  </div>
);

const Badge: React.FC<{ label: string }> = ({ label }) => (
  <span className="rounded-[6px] bg-accent/12 px-1.5 py-0.5 text-accent">{label}</span>
);

function formatValue(value: unknown): string {
  if (value === undefined) return '（无）';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function fetchManifest(
  client: ReturnType<typeof useFinagentClient>,
  kind: 'research' | 'agent',
  runId: string,
  sessionId: string | undefined
): Promise<RunManifest | undefined> {
  const res =
    kind === 'research'
      ? await client.research!.getManifest({ runId })
      : await client.kernel.getManifest({ sessionId: sessionId ?? '', runId });
  return res.ok ? res.data : undefined;
}

/**
 * The diff is computed in the main process (`diffRunManifests` lives in
 * `@finagent/shared`, which must never be imported by the renderer). The UI
 * only consumes the structured result over IPC.
 */
async function fetchDiff(
  client: ReturnType<typeof useFinagentClient>,
  kind: 'research' | 'agent',
  runIdA: string,
  runIdB: string,
  sessionId: string | undefined
): Promise<RunManifestDiff> {
  const res =
    kind === 'research'
      ? await client.research!.compareManifests({ runIdA, runIdB })
      : await client.kernel.compareManifests({ sessionId: sessionId ?? '', runIdA, runIdB });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

/** Single-run Run Info dialog (#21). */
export const RunInfoDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  kind: 'research' | 'agent';
  runId: string;
  sessionId?: string;
}> = ({ open, onClose, kind, runId, sessionId }) => {
  const client = useFinagentClient();
  const [manifest, setManifest] = useState<RunManifest | undefined>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setManifest(undefined);
    setMissing(false);
    (async () => {
      const data = await fetchManifest(client, kind, runId, sessionId);
      if (cancelled) return;
      if (data) setManifest(data);
      else setMissing(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, kind, runId, sessionId, client]);

  return (
    <Dialog open={open} onClose={onClose} title="运行信息 (Run Info)">
      {missing ? (
        <p className="text-[12px] text-text-muted">该运行没有可显示的清单（manifest）。</p>
      ) : manifest ? (
        <ManifestView manifest={manifest} />
      ) : (
        <p className="text-[12px] text-text-muted">加载中…</p>
      )}
    </Dialog>
  );
};

/** Two-run diff dialog (#21). */
export const RunInfoCompareDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  kind: 'research' | 'agent';
  runIdA: string;
  runIdB: string;
  sessionId?: string;
}> = ({ open, onClose, kind, runIdA, runIdB, sessionId }) => {
  const client = useFinagentClient();
  const [diff, setDiff] = useState<RunManifestDiff | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDiff(undefined);
    setError(undefined);
    (async () => {
      try {
        const result = await fetchDiff(client, kind, runIdA, runIdB, sessionId);
        if (cancelled) return;
        setDiff(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, kind, runIdA, runIdB, sessionId, client]);

  return (
    <Dialog open={open} onClose={onClose} title="运行配置对比 (Diff)">
      {error ? (
        <p className="text-[12px] text-negative">{error}</p>
      ) : diff ? (
        <DiffView diff={diff} />
      ) : (
        <p className="text-[12px] text-text-muted">加载中…</p>
      )}
    </Dialog>
  );
};

export { ManifestView, DiffView };
