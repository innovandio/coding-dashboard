export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startIngestor, refreshGsdWatchers } = await import("./lib/gateway-ingestor");
    const { stopGsdWatchers } = await import("./lib/gsd-watcher");

    startIngestor();
    // Start GSD file watchers immediately (don't wait for gateway connection)
    refreshGsdWatchers();

    // Clean up file watchers on graceful shutdown
    const shutdown = () => {
      stopGsdWatchers();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
