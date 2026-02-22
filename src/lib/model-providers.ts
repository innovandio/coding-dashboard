import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface CatalogModel {
  key: string; // e.g. "anthropic/claude-opus-4-6"
  name: string; // e.g. "Claude Opus 4.6"
  input: string; // e.g. "text+image"
  contextWindow: number;
  local: boolean;
  available: boolean;
  tags: string[];
}

export interface ProviderGroup {
  id: string; // e.g. "anthropic"
  models: CatalogModel[];
}

/**
 * Fetch the full model catalog from the gateway via `openclaw models list --all --json`.
 * Groups results by provider (the part before "/" in the key).
 */
export async function fetchModelCatalog(): Promise<ProviderGroup[]> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "exec", "-T", "openclaw-gateway", "openclaw", "models", "list", "--all", "--json"],
    { timeout: 15000 },
  );

  const data = JSON.parse(stdout) as { models: CatalogModel[] };
  const byProvider = new Map<string, CatalogModel[]>();

  for (const m of data.models) {
    const slash = m.key.indexOf("/");
    const provider = slash > 0 ? m.key.substring(0, slash) : m.key;
    let group = byProvider.get(provider);
    if (!group) {
      group = [];
      byProvider.set(provider, group);
    }
    group.push(m);
  }

  return Array.from(byProvider.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, models]) => ({ id, models }));
}

/**
 * Set the default model for an agent (or globally) via `openclaw models set`.
 */
export async function setDefaultModel(modelKey: string, agentId?: string): Promise<void> {
  const args = ["compose", "exec", "-T", "openclaw-gateway", "openclaw", "models", "set", modelKey];
  if (agentId) {
    args.splice(5, 0, "--agent", agentId);
  }
  await execFileAsync("docker", args, { timeout: 15000 });
}

/**
 * Paste an API key into auth-profiles via `openclaw models auth paste-token`.
 * Reads the token from stdin to avoid leaking it in the process list.
 */
export async function pasteAuthToken(
  provider: string,
  apiKey: string,
  agentId?: string,
): Promise<void> {
  const args = [
    "compose",
    "exec",
    "-T",
    "openclaw-gateway",
    "openclaw",
    "models",
    "auth",
    "paste-token",
    "--provider",
    provider,
  ];
  if (agentId) {
    args.splice(5, 0, "--agent", agentId);
  }
  await new Promise<void>((resolve, reject) => {
    const child = execFile("docker", args, { timeout: 15000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    // paste-token uses a TUI prompt that expects \r (carriage return) to submit
    child.stdin?.end(apiKey + "\r");
  });
}

/**
 * Write a custom provider config (models.json + auth-profiles.json) directly
 * into the agent directory. Used for providers not in the OpenClaw catalog
 * (e.g. DashScope/Qwen, DeepSeek with custom base URL).
 */
export async function writeCustomProviderConfig(params: {
  provider: string;
  baseUrl: string;
  api: string;
  modelId: string;
  apiKey: string;
  agentId?: string;
}): Promise<void> {
  const { baseUrl, api, modelId, apiKey, agentId } = params;
  // Normalize provider to lowercase — openclaw resolves model keys in lowercase
  const provider = params.provider.toLowerCase();

  const agentFlag = agentId ? `--agent ${agentId}` : "";

  // Resolve agent dir from openclaw
  const { stdout: agentDir } = await execFileAsync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "openclaw-gateway",
      "sh",
      "-c",
      `openclaw models status --json ${agentFlag} | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.agentDir)"`,
    ],
    { timeout: 15000 },
  );
  const dir = agentDir.trim();

  const modelsJson = JSON.stringify(
    {
      providers: {
        [provider]: {
          baseUrl,
          apiKey,
          api,
          models: [
            {
              id: modelId,
              name: modelId,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
    null,
    2,
  );

  // Write models.json (with inline apiKey) via base64 pipe
  const modelsB64 = Buffer.from(modelsJson).toString("base64");

  await execFileAsync("docker", [
    "compose",
    "exec",
    "-T",
    "openclaw-gateway",
    "sh",
    "-c",
    `echo '${modelsB64}' | base64 -d > '${dir}/models.json'`,
  ]);

  // Write auth-profiles.json — OpenClaw reads auth from this file,
  // not from the inline apiKey in models.json.
  const authProfilesJson = JSON.stringify(
    {
      version: 1,
      profiles: {
        [`${provider}:manual`]: {
          type: "token",
          provider,
          token: apiKey,
        },
      },
    },
    null,
    2,
  );
  const authB64 = Buffer.from(authProfilesJson).toString("base64");

  await execFileAsync("docker", [
    "compose",
    "exec",
    "-T",
    "openclaw-gateway",
    "sh",
    "-c",
    `echo '${authB64}' | base64 -d > '${dir}/auth-profiles.json'`,
  ]);

  // Set the custom model as default via openclaw config set
  const modelKey = `${provider}/${modelId}`;
  const setArgs = [
    "compose",
    "exec",
    "-T",
    "openclaw-gateway",
    "openclaw",
    "models",
    "set",
    modelKey,
  ];
  if (agentId) {
    setArgs.splice(5, 0, "--agent", agentId);
  }
  await execFileAsync("docker", setArgs, { timeout: 15000 });
}
