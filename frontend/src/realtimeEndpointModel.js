export function resolveRealtimeUrl(configuredUrl) {
  const value = String(configuredUrl || "").trim().replace(/\/+$/, "");
  return value || undefined;
}
