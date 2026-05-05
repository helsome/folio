# Finance Agent

AI-powered personal investment assistant desktop application.

---

## MUST READ Before Any Work

### Required Skills

**Always load these skills when working on this project:**

| Skill | Purpose | Trigger |
|-------|---------|---------|
| `pi-coding-agent` | Pi Agent extension development | Tool/extension work |
| `craft-agent-template` | Electron + React + Tailwind patterns | Frontend/architecture |
| LongBridge skill | LongBridge CLI integration | Market data queries |

**Install LongBridge skill:**
```bash
npx skills add longbridge/developers -g -y
```

### Critical Rules

1. **LongBridge CLI is user-installed** — NEVER bundle it in the app
2. **Symbol validation** — Validate with `/^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/` before exec
3. **Use execa array params** — Never string concatenation for commands
4. **Session isolation** — Use `atomFamily` for per-session state

### Required Setup (User Must Do)

```bash
# Install LongBridge CLI
curl -sSL https://open.longbridge.com/longbridge/longbridge-terminal/install | sh
longbridge auth login
```

---

## Quick Commands

```bash
bun install          # Install dependencies
bun run dev          # Start development
bun run build         # Build project
bun run typecheck     # Type check
```

---

## Project Structure

```
finagent/
├── packages/
│   ├── longbridge-tools/   # CLI wrapper (executor, validator)
│   ├── pi-extension/        # Pi Agent tools (get_quote, get_portfolio)
│   └── ui/                   # React components
└── apps/
    └── electron/            # Desktop app
```

---

## Detailed Documentation (On-Demand)

| Need | Document |
|------|----------|
| Full requirements | `docs/PRD.md` |
| System architecture | `docs/architecture.md` |
| LongBridge setup | `docs/longbridge-skill-setup.md` |
| CLI command reference | `docs/api-reference.md` |
| Coding patterns | `docs/coding-guide.md` |
| Pi Agent skill | `~/.claude/skills/pi-coding-agent/SKILL.md` |
| Electron patterns | `~/.claude/skills/craft-agent-template/SKILL.md` |

---

## Verification Before Completion

- [ ] TypeScript passes (`bun run typecheck`)
- [ ] Symbol validation before any LongBridge call
- [ ] execa uses array parameters (no shell injection)
- [ ] Error handling covers: not installed, timeout, invalid symbol

---

## Getting Help

1. **LongBridge integration** → `docs/longbridge-skill-setup.md`
2. **Pi Agent tools** → `docs/coding-guide.md` + `pi-coding-agent` skill
3. **UI/Architecture** → `craft-agent-template` skill
4. **Ask for clarification** → Don't guess