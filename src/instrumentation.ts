export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startIngestor, refreshGsdWatchers } = await import("./lib/gateway-ingestor");
    startIngestor();
    // Start GSD file watchers immediately (don't wait for gateway connection)
    refreshGsdWatchers();

    const { startTmuxScanner } = await import("./lib/tmux-scanner");
    startTmuxScanner();
  }
}
