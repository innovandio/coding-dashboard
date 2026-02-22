# HEARTBEAT.md

- Check if a `claude` session is already running (e.g. `pgrep -f claude`)
- If no active session, start one in the project directory (see `TOOLS.md`)
- Check GSD progress with `/gsd:progress` — has execution completed or stalled?
- If idle and phases remain, resume the GSD workflow with `/gsd:resume-work`
