# Longbridge Official Skills

Vendored from https://github.com/longbridge/skills (MIT License, © 2026 Longbridge Inc.).

- `index.json` — metadata index shipped by the upstream repo.
- Each `<name>/` directory is a skill package: `SKILL.md` + `references/` (+ optional `scripts/`, `assets/`).
- Skills are loaded by `@finagent/skill-hub` (SkillHub V2) and consumed progressively by the agent.

## Update procedure

```bash
rm -rf skills/*
git clone --depth 1 https://github.com/longbridge/skills /tmp/lb-skills
cp -r /tmp/lb-skills/skills/* skills/
cp /tmp/lb-skills/index.json /tmp/lb-skills/LICENSE skills/
```

Upstream version: cloned 2026-08-13 from `main`.
