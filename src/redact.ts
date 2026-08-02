const TOKEN = /nsak_[A-Za-z0-9_-]+\.[A-Za-z0-9._~-]+/g;

export function redact(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(TOKEN, "[REDACTED]");
}
