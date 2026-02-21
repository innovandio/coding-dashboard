#!/bin/sh
set -e

# Persist .claude.json inside the volume-mounted .claude/ directory.
# The volume is at /root/.claude; symlink /root/.claude.json into it so
# claude reads config from the volume.
CLAUDE_JSON_REAL="/root/.claude/.claude.json"
CLAUDE_JSON_LINK="/root/.claude.json"

# Migrate: if a real file exists (not a symlink), move it into the volume
if [ -f "$CLAUDE_JSON_LINK" ] && [ ! -L "$CLAUDE_JSON_LINK" ]; then
  mv "$CLAUDE_JSON_LINK" "$CLAUDE_JSON_REAL"
  echo "[entrypoint] Migrated .claude.json into .claude/ volume"
fi

# Seed .claude.json if it doesn't exist yet (first run with fresh volume).
if [ ! -f "$CLAUDE_JSON_REAL" ] || [ ! -s "$CLAUDE_JSON_REAL" ]; then
  echo '{}' > "$CLAUDE_JSON_REAL"
fi

# Ensure the symlink exists
if [ ! -L "$CLAUDE_JSON_LINK" ]; then
  ln -sf "$CLAUDE_JSON_REAL" "$CLAUDE_JSON_LINK"
  echo "[entrypoint] Symlinked .claude.json -> .claude/.claude.json"
fi

# Update Claude Code via native installer (non-blocking on failure).
echo "[entrypoint] Updating Claude Code..."
curl -fsSL https://claude.ai/install.sh | bash > /dev/null 2>&1 || echo "[entrypoint] Claude Code update failed, using installed version"
echo "[entrypoint] Claude Code version: $(/root/.local/bin/claude --version 2>/dev/null || echo 'unknown')"

# Ensure hasCompletedOnboarding is set AFTER the update — the installer may
# overwrite .claude.json with its own defaults. Merge it into whatever exists.
node -e "
  const f = '$CLAUDE_JSON_REAL';
  const d = JSON.parse(require('fs').readFileSync(f, 'utf8'));
  if (!d.hasCompletedOnboarding) {
    d.hasCompletedOnboarding = true;
    require('fs').writeFileSync(f, JSON.stringify(d, null, 2));
    console.log('[entrypoint] Set hasCompletedOnboarding in .claude.json');
  }
"

# Enable custom bundled plugins in openclaw.json (create if needed)
OPENCLAW_JSON="/root/.openclaw/openclaw.json"
if [ ! -f "$OPENCLAW_JSON" ]; then
  mkdir -p /root/.openclaw
  echo '{}' > "$OPENCLAW_JSON"
fi
node -e "
  const f = '$OPENCLAW_JSON';
  const d = JSON.parse(require('fs').readFileSync(f, 'utf8'));
  if (!d.plugins) d.plugins = {};
  if (!d.plugins.entries) d.plugins.entries = {};
  let changed = false;
  if (!d.plugins.entries['pty-broadcast']) {
    d.plugins.entries['pty-broadcast'] = { enabled: true };
    changed = true;
  }
  if (changed) {
    require('fs').writeFileSync(f, JSON.stringify(d, null, 2));
    console.log('[entrypoint] Enabled pty-broadcast plugin');
  }
"

exec "$@"
