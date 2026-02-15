function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export function getEnv() {
  return {
    databaseUrl: required("DATABASE_URL"),
    gatewayWsUrl: required("GATEWAY_WS_URL"),
    gatewayToken: required("GATEWAY_TOKEN"),
  };
}
