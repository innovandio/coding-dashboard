import { NextRequest, NextResponse } from "next/server";
import {
  fetchModelCatalog,
  setDefaultModel,
  pasteAuthToken,
  writeCustomProviderConfig,
} from "@/lib/model-providers";

export const dynamic = "force-dynamic";

/** Return the full model catalog grouped by provider. */
export async function GET() {
  try {
    const providers = await fetchModelCatalog();
    return NextResponse.json(providers);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[model-config] Failed to fetch catalog:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Configure a model + auth token (globally or per-agent). */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { mode, agentId } = body;

  try {
    if (mode === "custom") {
      const { customProvider, customBaseUrl, customApi, customModelId, apiKey } = body;
      if (!customProvider || !customBaseUrl || !customModelId || !apiKey) {
        return NextResponse.json(
          { error: "customProvider, customBaseUrl, customModelId, and apiKey are required" },
          { status: 400 },
        );
      }
      await writeCustomProviderConfig({
        provider: customProvider,
        baseUrl: customBaseUrl,
        api: customApi || "openai-completions",
        modelId: customModelId,
        apiKey,
        agentId,
      });
    } else {
      const { modelKey, provider, apiKey } = body;
      if (!modelKey || !provider || !apiKey) {
        return NextResponse.json(
          { error: "modelKey, provider, and apiKey are required" },
          { status: 400 },
        );
      }
      await pasteAuthToken(provider, apiKey, agentId);
      await setDefaultModel(modelKey, agentId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[model-config] Failed to configure model:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
