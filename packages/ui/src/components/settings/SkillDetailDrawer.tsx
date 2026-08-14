import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SkillReadiness } from '@finagent/core';
import { useFinagentClient, type SkillListItem, type SkillResourceItem } from '../../client';
import { SkillReadinessBadge } from './SkillReadinessBadge';
import { SkillToggle } from './SkillToggle';
import type { SkillToggleError } from './useSkillToggle';

export interface SkillDetailDrawerProps {
  skill: SkillListItem;
  readiness?: SkillReadiness;
  onClose: () => void;
  togglingId: string | null;
  toggleError: SkillToggleError | null;
  onToggle: (skill: SkillListItem) => void;
}

type AdvancedDoc = { status: 'loading' | 'error' | 'ready'; text?: string; error?: string };

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/44">{children}</h3>
);

/**
 * Right-hand detail panel for a skill. Metadata (description, capabilities,
 * triggers, references, version, author, risk level) is the primary content;
 * raw SKILL.md and reference markdown are tucked behind an "Advanced /
 * Developer Details" collapsible — never the main action.
 *
 * SkillHub refuses `listResources`/`readResource` for disabled skills, so the
 * resource sections degrade to an "enable to browse" hint instead of a
 * guaranteed failure.
 */
export const SkillDetailDrawer: React.FC<SkillDetailDrawerProps> = ({
  skill,
  readiness,
  onClose,
  togglingId,
  toggleError,
  onToggle,
}) => {
  const client = useFinagentClient();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [resources, setResources] = useState<SkillResourceItem[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourcesError, setResourcesError] = useState<string | null>(null);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedDocs, setAdvancedDocs] = useState<Record<string, AdvancedDoc>>({});
  const loadedAdvancedRef = useRef(new Set<string>());

  // Esc closes; focus lands in the dialog on open.
  useEffect(() => {
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!skill.enabled) {
        setResources([]);
        setResourcesLoading(false);
        setResourcesError(null);
        setActivePath(null);
        setContent(null);
        setContentLoading(false);
        setContentError(null);
        return;
      }
      setResourcesLoading(true);
      setResourcesError(null);
      const result = await client.skills.listResources(skill.id);
      if (cancelled) return;
      setResourcesLoading(false);
      if (result.ok) {
        setResources(result.data);
      } else {
        setResourcesError(result.error.message);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, skill.id, skill.enabled]);

  const openReference = async (path: string) => {
    setActivePath(path);
    setContentLoading(true);
    setContentError(null);
    setContent(null);
    const result = await client.skills.readResource(skill.id, path);
    setContentLoading(false);
    if (result.ok) {
      setContent(result.data);
    } else {
      setContentError(result.error.message);
    }
  };

  const loadAdvanced = async () => {
    const targets = resources.filter(
      (resource) =>
        resource.kind === 'skill' ||
        (resource.kind === 'reference' && resource.path.toLowerCase().endsWith('.md'))
    );
    for (const resource of targets) {
      if (loadedAdvancedRef.current.has(resource.path)) continue;
      loadedAdvancedRef.current.add(resource.path);
      setAdvancedDocs((prev) => ({ ...prev, [resource.path]: { status: 'loading' } }));
      const result = await client.skills.readResource(skill.id, resource.path);
      setAdvancedDocs((prev) => ({
        ...prev,
        [resource.path]: result.ok
          ? { status: 'ready', text: result.data }
          : { status: 'error', error: result.error.message },
      }));
    }
  };

  const toggleAdvanced = () => {
    const next = !advancedOpen;
    setAdvancedOpen(next);
    if (next) void loadAdvanced();
  };

  const referenceResources = resources.filter((resource) => resource.kind === 'reference');
  const drawerError = toggleError?.skillId === skill.id ? toggleError.message : null;
  const missingSet = new Set(readiness?.missing ?? []);

  return createPortal(
    <div className="fixed inset-0 z-(--z-index-modal)">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${skill.name} details`}
        data-testid="skill-detail-drawer"
        className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-[var(--mac-border-strong)] bg-background shadow-middle"
      >
        <header className="flex items-start gap-3 border-b mac-section-divider px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-foreground">{skill.name}</h2>
            <div className="mt-1.5">
              <SkillReadinessBadge readiness={readiness} />
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 rounded-[7px] p-1.5 text-foreground/48 transition-smooth hover:bg-[var(--mac-sidebar-hover)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 4L12 12M12 4L4 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            <section>
              <SectionLabel>Description</SectionLabel>
              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/72">
                {skill.description || '—'}
              </p>
            </section>

            <section>
              <SectionLabel>Capabilities</SectionLabel>
              {!readiness ? (
                <p className="mt-1.5 text-[12px] text-foreground/48">Capability requirements unavailable</p>
              ) : (
                <div className="mt-1.5 space-y-2">
                  {readiness.required.length > 0 && (
                    <div>
                      <div className="text-[11px] font-medium text-foreground/56">Required</div>
                      <ul className="mt-1 space-y-1">
                        {readiness.required.map((id) => {
                          const present = !missingSet.has(id);
                          return (
                            <li key={id} className="flex items-center gap-1.5 text-[12px]">
                              <span
                                aria-hidden="true"
                                className={present ? 'text-[var(--mac-green)]' : 'text-destructive'}
                              >
                                {present ? '✓' : '✕'}
                              </span>
                              <span className="font-mono text-foreground/72">{id}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {readiness.optional.length > 0 && (
                    <div>
                      <div className="text-[11px] font-medium text-foreground/56">
                        Optional ({readiness.availableOptional}/{readiness.optional.length} available)
                      </div>
                      <ul className="mt-1 space-y-1">
                        {readiness.optional.map((id) => (
                          <li key={id} className="flex items-center gap-1.5 text-[12px]">
                            <span aria-hidden="true" className="text-foreground/36">
                              ○
                            </span>
                            <span className="font-mono text-foreground/56">{id}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section>
              <SectionLabel>Triggers</SectionLabel>
              {skill.keywords.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-foreground/48">No trigger keywords</p>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {skill.keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-[6px] border border-[var(--mac-border)] px-2 py-0.5 font-mono text-[11px] text-foreground/64"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionLabel>Details</SectionLabel>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                <div>
                  <dt className="text-foreground/44">Version</dt>
                  <dd className="text-foreground/72">{skill.version ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-foreground/44">Author</dt>
                  <dd className="text-foreground/72">{skill.author ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-foreground/44">Risk level</dt>
                  <dd className="text-foreground/72">{skill.riskLevel ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-foreground/44">Tier</dt>
                  <dd className="text-foreground/72">{skill.tier ?? '—'}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-[10px] border border-[var(--mac-border)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-foreground">Enabled</div>
                  <div className="text-[11px] text-foreground/48">
                    {skill.enabled ? 'This skill is active' : 'This skill is disabled'}
                  </div>
                </div>
                <SkillToggle
                  checked={skill.enabled}
                  onChange={() => onToggle(skill)}
                  disabled={togglingId !== null}
                  loading={togglingId === skill.id}
                  label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`}
                />
              </div>
              {drawerError && (
                <div role="alert" data-testid="skill-drawer-toggle-error" className="mt-1.5 text-[12px] text-destructive">
                  {drawerError}
                </div>
              )}
            </section>

            <section>
              <SectionLabel>References</SectionLabel>
              {!skill.enabled ? (
                <p className="mt-1.5 text-[12px] text-foreground/48">Enable this skill to browse its resources.</p>
              ) : resourcesLoading ? (
                <p className="mt-1.5 text-[12px] text-foreground/48">Loading resources…</p>
              ) : resourcesError ? (
                <p className="mt-1.5 text-[12px] text-destructive">{resourcesError}</p>
              ) : referenceResources.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-foreground/48">No references</p>
              ) : (
                <div className="mt-1.5 space-y-1">
                  {referenceResources.map((resource) => (
                    <button
                      key={resource.path}
                      type="button"
                      data-testid={`skill-resource-${resource.path}`}
                      onClick={() => void openReference(resource.path)}
                      className={`block w-full truncate rounded-[7px] border px-2.5 py-1.5 text-left font-mono text-[11px] transition-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)] ${
                        activePath === resource.path
                          ? 'border-[rgba(var(--accent-rgb),0.3)] bg-[var(--mac-blue-soft)] text-foreground'
                          : 'border-[var(--mac-border)] text-foreground/64 hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-[0.99]'
                      }`}
                    >
                      {resource.path}
                    </button>
                  ))}
                </div>
              )}

              {activePath && (
                <div className="mt-2">
                  {contentLoading && (
                    <p className="text-[12px] text-foreground/48">Loading {activePath}…</p>
                  )}
                  {contentError && <p className="text-[12px] text-destructive">{contentError}</p>}
                  {content !== null && (
                    <pre
                      data-testid="skill-resource-content"
                      className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--mac-border)] bg-background/60 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/78"
                    >
                      {content}
                    </pre>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-[10px] border border-[var(--mac-border)]">
              <button
                type="button"
                data-testid="skill-advanced-toggle"
                aria-expanded={advancedOpen}
                onClick={toggleAdvanced}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-smooth hover:bg-[var(--mac-sidebar-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
              >
                <span className="text-[12px] font-medium text-foreground/72">
                  Advanced / Developer Details
                </span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  aria-hidden="true"
                  className={`shrink-0 text-foreground/42 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
                >
                  <path d="M4 2.5 6.5 5 4 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {advancedOpen && (
                <div className="space-y-2 border-t mac-section-divider px-3 py-3">
                  {!skill.enabled ? (
                    <p className="text-[12px] text-foreground/48">Enable this skill to view raw files.</p>
                  ) : (
                    resources
                      .filter(
                        (resource) =>
                          resource.kind === 'skill' ||
                          (resource.kind === 'reference' && resource.path.toLowerCase().endsWith('.md'))
                      )
                      .map((resource) => {
                        const doc = advancedDocs[resource.path];
                        return (
                          <div key={resource.path}>
                            <div className="font-mono text-[11px] text-foreground/56">{resource.path}</div>
                            {!doc && <p className="text-[12px] text-foreground/40">Queued…</p>}
                            {doc?.status === 'loading' && (
                              <p className="text-[12px] text-foreground/48">Loading…</p>
                            )}
                            {doc?.status === 'error' && (
                              <p className="text-[12px] text-destructive">{doc.error}</p>
                            )}
                            {doc?.status === 'ready' && (
                              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--mac-border)] bg-background/60 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/78">
                                {doc.text}
                              </pre>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </aside>
    </div>,
    document.body
  );
};
