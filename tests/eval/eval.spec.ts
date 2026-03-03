import { createServer, type Server } from "http";
import { readFile } from "fs/promises";
import { expect, test } from "@playwright/test";
import { parse as parseYaml } from "yaml";
import type { AcceptanceCriterion } from "./lib/types";
import { runReferenceCheck } from "./lib/verification-engine";

type Mode = "good" | "bad";

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

function renderDashboardHtml(mode: Mode): string {
  if (mode === "bad") {
    return `<!doctype html>
<html>
  <body>
    <header data-testid="header"><h1>Dashboard</h1></header>
    <aside data-testid="sidebar">Sidebar</aside>
    <main data-testid="content">Content</main>
  </body>
</html>`;
  }

  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; font-family: sans-serif; }
      header { height: 56px; display: flex; align-items: center; padding: 0 16px; border-bottom: 1px solid #ddd; }
      #layout { display: flex; min-height: calc(100vh - 56px); }
      [data-testid="sidebar"] { width: 240px; border-right: 1px solid #ddd; display: none; }
      [data-testid="mobile-menu-toggle"] { display: inline-flex; margin-right: 8px; }
      [data-testid="content"] { flex: 1; padding: 16px; }
      @media (min-width: 768px) {
        [data-testid="sidebar"] { display: block; }
        [data-testid="mobile-menu-toggle"] { display: none; }
      }
    </style>
  </head>
  <body>
    <header data-testid="header">
      <button aria-label="Toggle menu" data-testid="mobile-menu-toggle">Menu</button>
      <h1>Dashboard</h1>
    </header>
    <div id="layout">
      <aside data-testid="sidebar">Sidebar</aside>
      <main data-testid="content">Content</main>
    </div>
  </body>
</html>`;
}

async function startServer(mode: Mode): Promise<TestServer> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/dashboard") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderDashboardHtml(mode));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test HTTP server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const servers: TestServer[] = [];

async function loadBrowserCriteria(): Promise<AcceptanceCriterion[]> {
  const filePath = `${process.cwd()}/tests/eval/scenarios/03-broken-responsive.yaml`;
  const raw = parseYaml(await readFile(filePath, "utf-8")) as {
    acceptance_criteria?: Array<Record<string, unknown>>;
  };

  return (raw.acceptance_criteria ?? [])
    .filter((criterion) => {
      const type = criterion.type as string | undefined;
      return type === "browser_visible" || type === "browser_interaction";
    })
    .filter(
      (criterion): criterion is AcceptanceCriterion =>
        typeof criterion.id === "string" &&
        typeof criterion.type === "string" &&
        typeof criterion.phase_ref === "number",
    );
}

test.afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await server.close();
  }
});

test("responsive browser criteria pass on a good implementation", async ({ browser }) => {
  const browserCriteria = await loadBrowserCriteria();

  const server = await startServer("good");
  servers.push(server);

  const { results } = await runReferenceCheck(browserCriteria, process.cwd(), {
    baseUrl: server.baseUrl,
    browser,
  });

  expect(results.every((result) => result.passed)).toBe(true);
});

test("responsive browser criteria fail on a bad implementation", async ({ browser }) => {
  const browserCriteria = await loadBrowserCriteria();

  const server = await startServer("bad");
  servers.push(server);

  const { results } = await runReferenceCheck(browserCriteria, process.cwd(), {
    baseUrl: server.baseUrl,
    browser,
  });

  const failedIds = new Set(
    results.filter((result) => !result.passed).map((result) => result.criterion_id),
  );

  expect(failedIds.has("mobile-hamburger-exists")).toBe(true);
  expect(failedIds.has("mobile-sidebar-hidden")).toBe(true);
});
