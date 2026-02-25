# TOOLS.md

## Project Source

The project source code is at `/projects/{{projectId}}`. Work in that directory.

## File System

You can read any file directly to review code, check configs, or inspect output:

```bash
cat /projects/{{projectId}}/src/some-file.ts
ls -la /projects/{{projectId}}/
```

Use this for code review, understanding architecture, and verifying what Claude Code built.

## Git

The project uses git. Useful for reviewing what changed:

```bash
cd /projects/{{projectId}}
git log --oneline -20          # Recent commits
git diff HEAD~1                # Last commit's changes
git diff --stat                # Summary of uncommitted changes
git status                     # Working tree state
```

Don't make commits directly — delegate that to Claude Code via GSD.

## Claude Code (PTY)

To delegate development work, start a Claude Code session in the project directory:

```bash
cd /projects/{{projectId}} && IS_SANDBOX=1 claude --dangerously-skip-permissions
```

Inside the Claude Code session, GSD slash commands are available:

- `/gsd:progress` — check current status
- `/gsd:new-project --auto` — initialize a new GSD project
- `/gsd:discuss-phase N` — shape requirements for phase N
- `/gsd:plan-phase N` — create an execution plan
- `/gsd:execute-phase N` — execute the plan
- `/gsd:verify-work N` — review and validate output
- `/gsd:pause-work` / `/gsd:resume-work` — save/restore context across sessions
- `/gsd:help` — list all available commands

These commands are Claude Code slash commands — they only work inside a `claude` session, not in a regular shell.

### Session Management

- **One session at a time.** Don't start a new `claude` session if one is already running. Check first: `pgrep -f claude`
- **Graceful exit.** Let Claude Code finish its current task before exiting. Use `/gsd:pause-work` to save context if you need to stop mid-phase.
- **If a session crashes or hangs:** Kill it (`pkill -f claude`), then start fresh with `/gsd:resume-work` to restore context.

## Sandbox Browser

A browser is available for visual verification of web applications:

- **VNC viewer:** `http://localhost:6080` (noVNC web client)
- **Chrome DevTools:** `http://localhost:9222` (remote debugging)
- **VNC direct:** `localhost:5900`

Use this to verify UX, check layouts, test interactions, and catch visual regressions after implementation phases.

## Memory Files

Persistent memory lives in your agent directory:

- `memory/YYYY-MM-DD.md` — daily notes (what happened, decisions, blockers)
- `MEMORY.md` — curated long-term insights (update sparingly, only confirmed patterns)

Read today's memory at session start. Write to it after meaningful events.
