FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

# gosu for dropping privileges in the entrypoint
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*

# Install Claude Code to a node-user-writable prefix so it can be updated at runtime
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH="/home/node/.npm-global/bin:${PATH}"
RUN mkdir -p /home/node/.npm-global && chown -R node:node /home/node/.npm-global
USER node
RUN npm install -g @anthropic-ai/claude-code
USER root

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

RUN chown -R node:node /app

# Entrypoint runs as root to fix volume permissions, then drops to node via gosu
COPY --chmod=755 entrypoint.sh /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
