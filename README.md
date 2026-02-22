# Coding Dashboard

A real-time dashboard for monitoring and controlling AI coding agents running inside an [OpenClaw](https://github.com/openclaw/openclaw) gateway. Manage multiple projects and sessions, chat with agents, watch terminal output live, and track GSD task progress — all from a single browser tab.

## Features

- **Project management** — Create, edit, and switch between agent projects. Each project maps to an agent inside the OpenClaw gateway container.
- **Session tabs** — Run parallel workstreams within a project, each with its own chat and event history.
- **Chat panel** — Send messages to agents and view assistant responses with markdown rendering, tool call details, and activity timelines.
- **Live terminal** — Stream PTY output from agent processes in an xterm.js terminal with multi-process switching, resize support, and thinking-state detection.
- **GSD task board** — Visualize Get Shit Done phase and plan tasks parsed from agent markdown files, with status tracking.
- **AI brain sphere** — 3D Three.js visualization that reflects agent activity and connection state.
- **Guided setup** — First-run wizard configures the OpenClaw gateway, and a separate dialog handles Claude Code authentication.
- **Agent template scaffolding** — Markdown templates (`IDENTITY.md`, `AGENTS.md`, `SOUL.md`, etc.) are automatically copied into the gateway container when a project is created.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 10+
- [tmux](https://github.com/tmux/tmux) (auto-installed on first `pnpm dev` if missing)

## Quick Start

1. **Clone the repository**

   ```bash
   git clone <repo-url> coding-dashboard
   cd coding-dashboard
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Configure environment**

   Copy the example or create a `.env` file:

   ```
   DATABASE_URL=postgresql://operator:operator@localhost:5434/operator
   GATEWAY_WS_URL=ws://localhost:18789
   GATEWAY_TOKEN=<your-gateway-token>
   ```

4. **Start the dev server**

   ```bash
   pnpm dev
   ```

   This automatically starts Docker services (PostgreSQL, OpenClaw gateway, sandbox browser) via the predev hook, then launches Next.js on [http://localhost:3000](http://localhost:3000).

5. **Complete setup** — On first launch, the setup wizard walks you through OpenClaw gateway configuration and Claude Code authentication.

## Scripts

| Command      | Description                                    |
| ------------ | ---------------------------------------------- |
| `pnpm dev`   | Start dev server (auto-starts Docker services) |
| `pnpm build` | Production build                               |
| `pnpm start` | Start production server                        |
| `pnpm lint`  | Run ESLint                                     |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                            │
│  ┌──────────┬──────────┬──────────┬───────────────┐  │
│  │ Top Bar  │ Session  │ GSD Task │ AI Brain      │  │
│  │ Projects │ Tabs     │ Board    │ Sphere        │  │
│  ├──────────┴──────────┼──────────┴───────────────┤  │
│  │ Chat Panel          │ Terminal (xterm.js)       │  │
│  │ (markdown, tools)   │ (live PTY stream)         │  │
│  └──────────────────────┴─────────────────────────┘  │
│           ↕ SSE streams                              │
├──────────────────────────────────────────────────────┤
│  Next.js Server                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ API Routes (/api/*)                          │    │
│  │  projects, chat, pty, events, gsd, health    │    │
│  ├──────────────────────────────────────────────┤    │
│  │ Background Services (via instrumentation.ts) │    │
│  │  ┌──────────────┐  ┌────────────────────┐    │    │
│  │  │ Event Bus    │←─│ Gateway Ingestor   │──────── WebSocket ──→ OpenClaw Gateway
│  │  │ (EventEmitter│  │ (Ed25519 auth)     │    │    │            (Docker :18789)
│  │  └──────────────┘  └────────────────────┘    │    │
│  │  ┌──────────────┐                            │    │
│  │  │ PTY Emitter  │  (64KB screen buffers)     │    │
│  │  └──────────────┘                            │    │
│  │  ┌──────────────┐                            │    │
│  │  │ GSD Watcher  │  (file system watchers)    │    │
│  │  └──────────────┘                            │    │
│  └──────────────────────────────────────────────┘    │
│           ↕ SQL                                      │
│  PostgreSQL (Docker :5434)                           │
└──────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Radix UI, xterm.js, Three.js
- **Backend:** Next.js API routes, WebSocket (ws), Server-Sent Events, Node.js EventEmitter
- **Database:** PostgreSQL 17 (raw pg driver, no ORM)
- **Infrastructure:** Docker Compose (PostgreSQL, OpenClaw gateway, Adminer, sandbox browser)

### Docker Services

| Service            | Port             | Purpose                      |
| ------------------ | ---------------- | ---------------------------- |
| `postgres`         | 5434             | Application database         |
| `adminer`          | 8089             | Database admin UI            |
| `openclaw-gateway` | 18789            | Agent execution (WebSocket)  |
| `sandbox-browser`  | 6080, 9222, 5900 | Sandboxed browser for agents |

### Project Structure

```
src/
├── app/              # Next.js App Router (pages + API routes)
│   └── api/          # REST + SSE endpoints
├── components/       # React components (feature-based folders)
│   ├── activity/     # Agent activity display
│   ├── chat/         # Chat panel
│   ├── gsd/          # GSD task board
│   ├── layout/       # Dashboard shell, top bar, session tabs
│   ├── setup/        # Setup and login wizards
│   ├── shared/       # Shared components (AI sphere, connection dot)
│   ├── terminal/     # PTY/terminal panel
│   └── ui/           # shadcn/ui primitives
├── hooks/            # Custom React hooks
└── lib/              # Server-side utilities and business logic
```
