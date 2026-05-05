// Skill Hub - Deferred to Phase 4+
// This package will handle skill registration, prompt management, and skill metadata.

import type { Skill } from '@finagent/core';

export interface SkillHubConfig {
  skillsDirectory: string;
  enabledSkills: Set<string>;
}

export class SkillHub {
  private skills: Map<string, Skill> = new Map();
  private config: SkillHubConfig;

  constructor(config: Partial<SkillHubConfig> = {}) {
    this.config = {
      skillsDirectory: '~/.finagent/skills',
      enabledSkills: new Set(),
      ...config,
    };
  }

  async loadSkills(): Promise<void> {
    // TODO: Load skills from filesystem
    // await loadSkillsFromDirectory(this.config.skillsDirectory);
  }

  async registerSkill(skill: Skill): Promise<void> {
    this.skills.set(skill.id, skill);
  }

  async unregisterSkill(skillId: string): Promise<void> {
    this.skills.delete(skillId);
  }

  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  findSkillsByKeyword(keyword: string): Skill[] {
    return this.listSkills().filter((skill) =>
      skill.trigger.keywords.some((k) =>
        k.toLowerCase().includes(keyword.toLowerCase())
      )
    );
  }
}

export const skillHub = new SkillHub();