# 10 Tips on Using Claude Code — From the Claude Code Team
## Source: Anthropic internal practices (infographic captured 2026-03-09)

---

## 1. PARALLEL SESSIONS (Git Worktrees)

```
MAIN REPO → WORKTREE 2a (Claude Session 1)
          → WORKTREE 2b (Claude Session 2)
          → WORKTREE 2e (Claude Session 5)
```

Run multiple Claude Code sessions simultaneously using git worktrees. Each worktree gets its own Claude session — true parallelism on different features/fixes.

---

## 2. PLAN MODE FOR COMPLEX TASKS

```
CLAUDE 1: WRITES PLAN → CLAUDE 2: REVIEWS (Staff Eng level)
                         ↓
              IF SIDEWAYS → RE-PLAN
```

**Invest in planning before coding. Also for verification.**

Use one Claude instance to write the plan, another to review it at staff engineer level. If execution goes sideways, re-plan rather than patching.

---

## 3. TREAT CLAUDE.md LIKE A MEMORY SYSTEM

After every correction, tell Claude:
> "Update CLAUDE.md so you don't make that mistake again."

Over time, **mistake rates actually drop** if you keep editing ruthlessly.

```
CORRECTION (Mistake Made) → Tell Claude: Update CLAUDE.md → CLAUDE.md (Memory System)
```

**RUTHLESSLY EDIT** — mistake rates DROP over time.

*This directly maps to our tiered memory architecture and AGENTS.md approach.*

---

## 4. TURN REPEAT WORK INTO SKILLS

```
REPEAT TASK (>1x/day) → CUSTOM SKILL (Command/Agent)
```

**Examples:**
- `/techdebt` to kill duplicated code
- Sync Slack/GDrive/Asana/GitHub in one context
- Analytics agents (dbt, reviews, tests)

**Automate frequent tasks.** If you do it more than once a day, make it a skill.

---

## 5. AUTONOMOUS BUG FIXING

```
SLACK BUG THREAD  ─┐
FAILING CI TESTS  ─┼→ CLAUDE (Fix Agent) 
DOCKER LOGS       ─┘
```

Paste thread, say "fix". Point at logs. **Use Claude autonomously.**

Feed bug reports, CI failures, and logs directly to Claude and let it fix autonomously.

---

## 6. HARSH REVIEWER

```
MY CHANGES (Diff) → CLAUDE (Grill Master) → "Grill me..."
                                            → "Prove this works..."
                                            → "Scrap this & implement elegant version."
```

**Demand rigorous reviews before PR.** Use Claude as a brutal code reviewer that challenges your work.

---

## 7. TERMINAL SETUP MATTERS

- **Ghostty terminal** (with tabs: 2a, 2b, 2c)
- `/statusline` (Contact Usage + Branch)
- **Voice Dictation (~3x faster)**

**Optimize environment with tools.** Terminal choice, status displays, and voice input dramatically improve throughput.

---

## 8. USE SUBAGENTS

```
MAIN CLAUDE → SUBAGENT 1 (Narrow Task)
            → SUBAGENT 2 (Narrow Task)
```

**Offload tasks to keep context.** Route permissions to Opus via hooks.

Don't pollute your main session with side tasks. Spawn narrow subagents and keep the main context clean.

---

## 9. CLAUDE FOR ANALYTICS

```
BigQuery CLI      ─┐
Any DB with       ─┼→ CLAUDE (SQL Skill)
CLI/MCP/API       ─┘
```

**One engineer hasn't written SQL in 6+ months!**

Connect Claude to your databases and let it handle all analytics queries.

---

## 10. LEARN WITH CLAUDE

```
Explanatory Output (/config) → HTML Presentations
         ↑
    ASCII Diagrams → Spaced-Repetition Skill
```

**Explain understanding. Claude fills gaps, stores result. Master new concepts.**

Use Claude to generate explanatory content, presentations, diagrams — and build spaced-repetition systems for learning.

---

## Key Patterns for Salish Forge CTO

These tips map directly to our architecture:

| Anthropic Tip | Our Equivalent |
|---------------|----------------|
| Parallel sessions (worktrees) | Sub-agent spawning per task |
| CLAUDE.md as memory | SOUL.md + MEMORY.md + tiered memory API |
| Plan before code | Opus thinking mode for architecture |
| Turn repeats into skills | OpenClaw skills system |
| Autonomous bug fixing | CI integration + auto-fix agents |
| Harsh reviewer | Code review sub-agent before merge |
| Subagents | sessions_spawn with task decomposition |
| Terminal setup | CTO defines dev environment standards |

**Priority for CTO's first week:** Implement tips #1 (parallel sessions), #3 (memory system), #4 (custom skills), and #8 (subagents) as organizational standards.
