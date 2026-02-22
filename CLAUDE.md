# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A full-stack Next.js dashboard for monitoring and controlling OpenClaw AI agent projects. It provides real-time terminal views, chat interfaces, GSD task boards, and project management for agents running inside a Docker-hosted OpenClaw gateway.

## Commands

```bash
pnpm dev          # Start dev server (auto-runs docker compose up via predev hook)
pnpm build        # Production build
pnpm lint         # ESLint (next/core-web-vitals + typescript)
```

Prerequisites: Docker, Docker Compose, tmux, pnpm 10.27.0.

## Architecture

### Stack
- **Next.js 16** (App Router) with React 19, TypeScript strict mode
- **UI:** shadcn/ui (New York style, RSC mode), Tailwind CSS 4, Radix UI, Lucide icons
- **Database:** PostgreSQL 17 (raw `pg` queries, no ORM) — tables: `projects`, `sessions`
- **Real-time:** WebSocket client to OpenClaw gateway + SSE streams to browser
- **Terminal:** xterm.js frontend, PTY emitter backend with 64KB screen buffers
- **3D:** Three.js for AI brain sphere visualization

### Path alias
`@/*` maps to `./src/*`

### Key Architectural Layers

**Instrumentation startup** (`src/instrumentation.ts`): On Next.js boot, starts the gateway WebSocket ingestor and GSD file watchers as background services.

**Gateway ingestor** (`src/lib/gateway-ingestor.ts`): Singleton WebSocket connection to the OpenClaw gateway container. Authenticates with Ed25519 device identity (stored in `.data/device-identity.json`). Receives all agent/chat/PTY events and routes them through the event bus. Uses `globalThis` to survive HMR reloads.

**Event bus** (`src/lib/event-bus.ts`): In-memory EventEmitter that bridges the gateway ingestor to SSE endpoints. Events carry `project_id`, `session_id`, `agent_id` for filtering.

**PTY emitter** (`src/lib/pty-emitter.ts`): Separate emitter for terminal events. Maintains per-run screen buffers so late-connecting clients catch up.

**Dashboard state** (`src/hooks/use-dashboard-state.ts`): Client-side hook managing projects, sessions, health, and events via SSE streams. No Redux/Zustand — uses React hooks + EventEmitter.

### API Routes (`src/app/api/`)

All routes use `export const dynamic = "force-dynamic"`. Key groups:
- `/api/projects` — CRUD for projects (scaffolds agent template files on create)
- `/api/chat/*` — Send messages, get activity, abort, resolve sessions
- `/api/pty/*` — Stream terminal output (SSE), send input, kill, resize
- `/api/events/stream` — Main SSE event stream (filters by project/session)
- `/api/gsd/*` — GSD task list from watched markdown files
- `/api/health` — Connection state, setup/login status
- `/api/claude-login/*`, `/api/setup/*` — Auth wizards

### Component Organization (`src/components/`)

Feature-based folders: `activity/`, `chat/`, `errors/`, `gsd/`, `layout/`, `setup/`, `shared/`, `stream/`, `terminal/`. UI primitives in `ui/` (shadcn).

### Docker Services (`docker-compose.yml`)

- **postgres:17** — Port 5434, initialized from `db/init.sql`
- **adminer** — Port 8089
- **openclaw-gateway** — Port 18789 (WebSocket), volumes: `openclawdata`, `claudedata`, `agentdata`
- **sandbox-browser** — Ports 6080/9222/5900

### Agent Template Scaffolding

`agent-templates/*.md` files are copied into the gateway container at `/data/agents/{projectId}/` on project creation. Placeholders `{{projectName}}` and `{{projectId}}` are replaced. Scaffolding uses `docker compose exec`.

## Conventions

- Server-only packages (`pg`, `ws`) are in `next.config.ts` `serverExternalPackages`
- Singletons use `globalThis` pattern to survive Next.js HMR (see `gateway-ingestor.ts`, `event-bus.ts`, `db.ts`)
- Database queries use parameterized SQL directly — no query builder or ORM
- Environment variables: `DATABASE_URL`, `GATEWAY_WS_URL`, `GATEWAY_TOKEN` (in `.env`)
- SSE endpoints use `ReadableStream` with `TextEncoder` for streaming
- No test framework is configured
