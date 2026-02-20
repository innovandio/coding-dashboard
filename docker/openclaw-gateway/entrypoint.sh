#!/bin/sh
set -e

# Save the HOME set by docker-compose (e.g. /Users/andreas) before gosu resets it
REAL_HOME="$HOME"

# Ensure HOME directory exists and is writable by the node user.
mkdir -p "$REAL_HOME"
chown node:node "$REAL_HOME"
# Fix permissions on bind-mounted/volume-mounted config dirs
for d in "$REAL_HOME/.openclaw" "$REAL_HOME/.claude"; do
  if [ -d "$d" ]; then
    chown -R node:node "$d"
  fi
done

# The gateway binary resolves home via /etc/passwd (/home/node) rather than $HOME,
# so it reads /home/node/.openclaw/ for devices/config. Symlink to the bind-mounted dir.
NODE_HOME=$(getent passwd node | cut -d: -f6)
if [ -n "$NODE_HOME" ] && [ "$NODE_HOME" != "$REAL_HOME" ]; then
  if [ -d "$REAL_HOME/.openclaw" ] && [ ! -L "$NODE_HOME/.openclaw" ]; then
    rm -rf "$NODE_HOME/.openclaw"
    ln -sf "$REAL_HOME/.openclaw" "$NODE_HOME/.openclaw"
    echo "[entrypoint] Symlinked $NODE_HOME/.openclaw -> $REAL_HOME/.openclaw"
  fi
fi

# Restore .claude.json from backup if missing (it lives in HOME which is ephemeral,
# but backups are inside the persisted .claude volume)
if [ ! -f "$REAL_HOME/.claude.json" ] && [ -d "$REAL_HOME/.claude/backups" ]; then
  LATEST_BACKUP=$(ls -t "$REAL_HOME/.claude/backups/.claude.json.backup."* 2>/dev/null | head -1)
  if [ -n "$LATEST_BACKUP" ]; then
    echo "[entrypoint] Restoring .claude.json from backup: $LATEST_BACKUP"
    cp "$LATEST_BACKUP" "$REAL_HOME/.claude.json"
    chown node:node "$REAL_HOME/.claude.json"
  fi
fi

# Update Claude Code as node user (non-blocking on failure)
echo "[entrypoint] Updating Claude Code..."
HOME="$REAL_HOME" gosu node npm update -g @anthropic-ai/claude-code --cache /tmp/.npm 2>&1 || echo "[entrypoint] Claude Code update failed, using installed version"
echo "[entrypoint] Claude Code version: $(HOME="$REAL_HOME" gosu node claude --version 2>/dev/null || echo 'unknown')"

# Run the CMD as node user, preserving HOME
export HOME="$REAL_HOME"
exec gosu node "$@"
