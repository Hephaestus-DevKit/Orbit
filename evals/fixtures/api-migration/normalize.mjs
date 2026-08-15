export function normalizeRecord(record, trim = true) {
  const result = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = trim && typeof value === "string" ? value.trim() : value;
  }
  return result;
}
