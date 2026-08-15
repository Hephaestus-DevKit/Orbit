import { normalizeRecord } from "./normalize.mjs";

export function processRecords(records, options = {}) {
  return records.map((record) => normalizeRecord(record, options.trim));
}
