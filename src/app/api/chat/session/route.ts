import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { sendGatewayRequest } from "@/lib/gateway-ingestor";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

// Build session key in the format the gateway expects: agent:<agentId>:main
function buildSessionKey(agentId: string): string {
  const normalized = agentId.trim().toLowerCase();
  return `agent:${normalized}:main`;
}

function buildInitialMessage(projectName: string, workspacePath: string): string {
  return `You are the dedicated autonomous agent for the project "${projectName}".
Your workspace is at: ${workspacePath}

This project uses Claude Code with the GSD (Get Shit Done) workflow (https://github.com/gsd-build/get-shit-done) for planning and execution.

## Your mission

Autonomously drive the current milestone to completion with **zero human intervention**. You take over all roles — including the human-facing steps like discuss and verify.

## Startup procedure

1. Review the project at the workspace path — understand its purpose, tech stack, and structure
2. Check for existing GSD state: look for \`.planning/\` directory, \`PROJECT.md\`, \`ROADMAP.md\`, \`STATE.md\`
3. Run \`/gsd:progress\` to determine where things stand
4. If no GSD project exists yet, run \`/gsd:new-project --auto\` to initialize it

## Autonomous phase loop

For each phase in the roadmap that is not yet complete, execute this cycle:

### 1. Discuss (\`/gsd:discuss-phase N\`)
Act as the human stakeholder. When the discuss step asks for implementation preferences or decisions, make reasonable choices yourself based on:
- Existing codebase conventions and patterns
- Standard best practices for the tech stack
- Simplicity and pragmatism over over-engineering
Document your decisions clearly in the context file.

### 2. Plan (\`/gsd:plan-phase N\`)
Run planning — this is fully automated. Let it complete.

### 3. Execute (\`/gsd:execute-phase N\`)
Run execution — this is fully automated. Let it complete.

### 4. Verify (\`/gsd:verify-work N\`)
Act as the human tester. When verify asks you to confirm features work:
- Run the relevant tests and checks yourself
- Inspect the built output, check for obvious errors
- If something fails, let the verify step create fix plans and re-execute
- Approve when the deliverables match the phase goals

### 5. Repeat
Move to the next phase. Continue until all phases are complete.

## Milestone completion

Once all phases pass verification:
1. Run \`/gsd:audit-milestone\` to verify the milestone achieved its definition of done
2. Run \`/gsd:complete-milestone\` to archive and tag

## Guidelines

- Use \`/gsd:settings\` to set mode to \`yolo\` (auto-approve) at the start
- If you hit context limits mid-phase, use \`/gsd:pause-work\` then \`/gsd:resume-work\`
- If a phase fails verification repeatedly (3+ times), pause and report the issue — do not loop forever
- Provide brief status updates between phases so progress can be monitored

Begin now.`;
}

export async function POST(req: NextRequest) {
  const { projectId } = await req.json();
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const pool = getPool();

  // Check if project already has a chat session
  const existing = await pool.query(
    `SELECT id, session_key FROM sessions WHERE project_id = $1 AND meta->>'type' = 'chat' LIMIT 1`,
    [projectId]
  );

  if (existing.rows.length > 0) {
    return NextResponse.json({
      sessionId: existing.rows[0].id,
      sessionKey: existing.rows[0].session_key,
    });
  }

  // Look up the project
  const project = await pool.query(
    `SELECT agent_id, name, workspace_path FROM projects WHERE id = $1`,
    [projectId]
  );
  const row = project.rows[0];
  const agentId = row?.agent_id ?? projectId;
  const projectName = row?.name ?? projectId;
  const workspacePath = row?.workspace_path ?? "";

  // Build session key directly — gateway accepts agent:<agentId>:main format
  const sessionKey = buildSessionKey(agentId);
  const sessionId = `chat-${projectId}-${Date.now()}`;

  await pool.query(
    `INSERT INTO sessions (id, project_id, session_key, meta)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, projectId, sessionKey, JSON.stringify({ type: "chat" })]
  );

  // First session — send initial orientation message
  if (workspacePath) {
    const message = buildInitialMessage(projectName, workspacePath);
    sendGatewayRequest("chat.send", {
      sessionKey,
      message,
      idempotencyKey: randomUUID(),
    }).catch((err) => {
      console.error("[chat.session] Failed to send initial message:", err.message);
    });
  }

  return NextResponse.json({ sessionId, sessionKey, isNew: true });
}
