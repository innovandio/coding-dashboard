# TOOLS.md

## Project Source

The project source code is at `/projects/{{projectId}}`. Work in that directory.

## Claude Code (PTY)

You have access to a terminal (PTY). To delegate development work, run `claude` to start a Claude Code session in the project directory:

```bash
cd /projects/{{projectId}} && claude
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
