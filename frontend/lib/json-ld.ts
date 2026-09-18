/** Serialize structured data for an HTML script element, preserving its JSON values. */
export function serializeJsonLd(value: unknown): string {
  // HTML parses closing script tags before the JSON parser sees the string.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
