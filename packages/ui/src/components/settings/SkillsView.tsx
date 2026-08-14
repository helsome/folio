import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { useFinagentClient, type SkillListItem } from '../../client';
import { loadSkillReadiness, skillReadinessAtom } from '../../atoms/skillReadinessAtoms';
import { filterSkills, SKILL_STATUS_FILTERS, type SkillStatusFilter } from './skillFilters';
import { useSkillToggle } from './useSkillToggle';
import { SkillList } from './SkillList';
import { SkillDetailDrawer } from './SkillDetailDrawer';

/** Skills home: search + status chips + rows, with a detail drawer. */
export const SkillsView: React.FC = () => {
  const client = useFinagentClient();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skillReadiness, setSkillReadiness] = useAtom(skillReadinessAtom);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SkillStatusFilter>('all');

  const [openSkillId, setOpenSkillId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const { togglingId, toggleError, toggle } = useSkillToggle(client, setSkills);

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

  useEffect(() => {
    void loadSkillReadiness().then(setSkillReadiness);
  }, [setSkillReadiness]);

  const filtered = useMemo(
    () => filterSkills(skills, skillReadiness, query, status),
    [skills, skillReadiness, query, status]
  );

  const openSkill = openSkillId ? skills.find((skill) => skill.id === openSkillId) : undefined;

  const openDrawer = useCallback((skill: SkillListItem, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setOpenSkillId(skill.id);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpenSkillId(null);
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, []);

  const handleToggle = useCallback(
    (skill: SkillListItem) => {
      void toggle(skill);
    },
    [toggle]
  );

  return (
    <div className="max-w-3xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40"
            >
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills…"
              aria-label="Search skills"
              data-testid="skills-search"
              className="w-full rounded-[8px] border border-[var(--mac-border)] bg-background/60 py-1.5 pl-8 pr-3 text-[13px] text-foreground placeholder:text-foreground/40 transition-smooth hover:border-[var(--mac-border-strong)] focus:border-[var(--mac-blue)] focus:outline-none"
            />
          </div>
        </div>

        <div role="group" aria-label="Filter skills by status" className="flex flex-wrap gap-1.5">
          {SKILL_STATUS_FILTERS.map((filter) => {
            const active = status === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={active}
                data-testid={`skills-filter-${filter.value}`}
                onClick={() => setStatus(filter.value)}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)] ${
                  active
                    ? 'border-transparent bg-[var(--mac-blue)] text-white'
                    : 'border-[var(--mac-border)] text-foreground/64 hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="py-10 text-center text-[13px] text-foreground/48">Loading skills…</div>
        ) : error ? (
          <div className="py-10 text-center">
            <div role="alert" className="text-[13px] text-destructive">
              {error}
            </div>
            <button
              type="button"
              onClick={() => void loadSkills()}
              className="mt-3 rounded-[8px] border border-[var(--mac-border)] px-3 py-1.5 text-[12px] font-medium text-foreground/72 transition-smooth hover:border-[var(--mac-border-strong)] hover:text-foreground active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)]"
            >
              Retry
            </button>
          </div>
        ) : skills.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-foreground/48">No skills installed</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-foreground/48">
            No skills match your search or filter
          </div>
        ) : (
          <SkillList
            skills={filtered}
            readiness={skillReadiness}
            togglingId={togglingId}
            toggleError={toggleError}
            onToggle={handleToggle}
            onOpen={openDrawer}
          />
        )}
      </div>

      {openSkill && (
        <SkillDetailDrawer
          key={openSkill.id}
          skill={openSkill}
          readiness={skillReadiness.find((entry) => entry.skillId === openSkill.id)}
          onClose={closeDrawer}
          togglingId={togglingId}
          toggleError={toggleError}
          onToggle={handleToggle}
        />
      )}
    </div>
  );
};
