import React, { useCallback, useEffect, useState } from 'react';
import { useFinagentClient, type SkillListItem, type SkillResourceItem } from '../../client';

const Toggle: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean }> = ({
  checked,
  onChange,
  disabled = false,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={onChange}
    disabled={disabled}
    className={`relative h-5 w-9 shrink-0 rounded-full transition-smooth disabled:cursor-not-allowed disabled:opacity-50 ${
      checked ? 'bg-[var(--mac-blue)]' : 'bg-foreground/18'
    }`}
  >
    <span
      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-0.5'
      }`}
    />
  </button>
);

/** Skill registry: list, enable/disable, expand resources, read markdown. */
export const SkillsView: React.FC = () => {
  const client = useFinagentClient();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resources, setResources] = useState<SkillResourceItem[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);

  const [activeResource, setActiveResource] = useState<{ skillId: string; path: string } | null>(null);
  const [resourceContent, setResourceContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await client.skills.list();
    setLoading(false);
    if (result.ok) {
      setSkills(result.data);
    } else {
      setError(result.error.message);
    }
  }, [client]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const toggleEnabled = async (skill: SkillListItem) => {
    const next = !skill.enabled;
    const result = await client.skills.setEnabled(skill.id, next);
    if (result.ok) {
      setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, enabled: next } : s)));
    }
  };

  const toggleExpand = async (skillId: string) => {
    if (expandedId === skillId) {
      setExpandedId(null);
      setResources([]);
      setActiveResource(null);
      setResourceContent(null);
      return;
    }
    setExpandedId(skillId);
    setResourcesLoading(true);
    setResourcesError(null);
    setResources([]);
    setActiveResource(null);
    setResourceContent(null);
    const result = await client.skills.listResources(skillId);
    setResourcesLoading(false);
    if (result.ok) {
      setResources(result.data);
    } else {
      setResourcesError(result.error.message);
    }
  };

  const openResource = async (skillId: string, path: string) => {
    setActiveResource({ skillId, path });
    setContentLoading(true);
    setContentError(null);
    setResourceContent(null);
    const result = await client.skills.readResource(skillId, path);
    setContentLoading(false);
    if (result.ok) {
      setResourceContent(result.data);
    } else {
      setContentError(result.error.message);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-[13px] text-foreground/48">Loading skills…</div>;
  }

  if (error) {
    return (
      <div className="py-10 text-center">
        <div className="text-[13px] text-destructive">{error}</div>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="py-10 text-center text-[13px] text-foreground/48">
        No skills installed
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-2">
      {skills.map((skill) => {
        const isExpanded = expandedId === skill.id;
        const mdResources = resources.filter((r) => r.path.toLowerCase().endsWith('.md'));
        return (
          <div key={skill.id} className="mac-stock-tile overflow-hidden rounded-[14px]">
            <div
              role="button"
              tabIndex={0}
              onClick={() => void toggleExpand(skill.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void toggleExpand(skill.id);
                }
              }}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-smooth hover:bg-[var(--mac-sidebar-hover)]"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                className={`shrink-0 text-foreground/42 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                aria-hidden="true"
              >
                <path d="M4 2.5 6.5 5 4 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">{skill.name}</div>
                {skill.description && (
                  <div className="truncate text-[12px] text-foreground/54">{skill.description}</div>
                )}
              </div>
              <span className="shrink-0 rounded-[6px] bg-foreground/[0.05] px-1.5 py-0.5 text-[11px] text-foreground/56">
                {skill.keywords.length} keywords
              </span>
              {skill.riskLevel && (
                <span className="shrink-0 rounded-[6px] border border-[var(--mac-border)] px-1.5 py-0.5 text-[11px] text-foreground/56">
                  {skill.riskLevel}
                </span>
              )}
              {skill.tier && (
                <span className="shrink-0 rounded-[6px] border border-[var(--mac-border)] px-1.5 py-0.5 text-[11px] text-foreground/56">
                  {skill.tier}
                </span>
              )}
              <span onClick={(e) => e.stopPropagation()}>
                <Toggle checked={skill.enabled} onChange={() => void toggleEnabled(skill)} />
              </span>
            </div>

            {isExpanded && (
              <div className="border-t mac-section-divider px-4 py-3">
                {resourcesLoading && (
                  <div className="text-[12px] text-foreground/48">Loading resources…</div>
                )}
                {resourcesError && <div className="text-[12px] text-destructive">{resourcesError}</div>}
                {!resourcesLoading && !resourcesError && mdResources.length === 0 && (
                  <div className="text-[12px] text-foreground/48">No markdown resources</div>
                )}
                {!resourcesLoading && !resourcesError && mdResources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {mdResources.map((resource) => (
                      <button
                        key={resource.path}
                        type="button"
                        onClick={() => void openResource(skill.id, resource.path)}
                        className={`rounded-[8px] border px-2 py-1 font-mono text-[11px] transition-smooth ${
                          activeResource?.path === resource.path
                            ? 'border-[rgba(var(--accent-rgb),0.3)] bg-[var(--mac-blue-soft)] text-foreground'
                            : 'border-[var(--mac-border)] text-foreground/64 hover:text-foreground'
                        }`}
                      >
                        {resource.path}
                      </button>
                    ))}
                  </div>
                )}

                {activeResource && activeResource.skillId === skill.id && (
                  <div className="mt-3">
                    {contentLoading && (
                      <div className="text-[12px] text-foreground/48">Loading {activeResource.path}…</div>
                    )}
                    {contentError && <div className="text-[12px] text-destructive">{contentError}</div>}
                    {resourceContent !== null && (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[10px] border border-[var(--mac-border)] bg-background/60 p-3 font-mono text-[12px] leading-relaxed text-foreground/80">
                        {resourceContent}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
