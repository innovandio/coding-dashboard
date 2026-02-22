FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

# Install Claude Code via native installer (installs to ~/.local/bin/)
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/root/.local/bin:${PATH}"

# Install Get Shit Done (GSD) skills for Claude Code
RUN npx -y get-shit-done-cc@latest --claude --global

WORKDIR /app

# Clone OpenClaw from GitHub
RUN git clone --depth 1 --branch main https://github.com/openclaw/openclaw.git .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

RUN ln -s /app/openclaw.mjs /usr/local/bin/openclaw

# Add custom extensions (loaded as bundled plugins, enabled via openclaw.json)
COPY extensions/ /app/extensions/

COPY --chmod=755 entrypoint.sh /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
