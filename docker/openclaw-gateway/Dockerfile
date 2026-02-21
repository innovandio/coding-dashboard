FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

# Install Claude Code via native installer (installs to ~/.local/bin/)
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

# Clone OpenClaw from GitHub
RUN git clone --depth 1 --branch main https://github.com/openclaw/openclaw.git .

# Apply local patches before building
COPY patches/ /tmp/patches/
RUN git apply /tmp/patches/*.patch && rm -rf /tmp/patches

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

RUN ln -s /app/openclaw.mjs /usr/local/bin/openclaw

COPY --chmod=755 entrypoint.sh /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
