# HEARTBEAT.md

1. Read today's `memory/YYYY-MM-DD.md` for context.
2. Check if a `claude` session is running: `pgrep -f claude`
   - **Active and progressing:** Do nothing.
   - **Stuck or erroring:** Investigate and unblock. Kill and restart if needed.
3. If no session running, start one (see `TOOLS.md`) and run `/gsd:progress`.
   - **No GSD project:** Run `/gsd:new-project --auto` if source code exists. Otherwise wait for user.
   - **Work was paused:** `/gsd:resume-work`
   - **Phase complete, next ready:** `/gsd:discuss-phase N`
   - **Execution failed:** Read error, fix blocker, re-run.
   - **All phases done:** `/gsd:audit-milestone`
   - **Blocked on user input:** Log in memory, wait.
4. Append what you found and did to today's `memory/YYYY-MM-DD.md`.
