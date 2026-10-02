/**
 * Parses a single-range HTTP Range header for a resource of `size` bytes (RFC 9110 14.1.2).
 * Returns inclusive offsets, "unsatisfiable" (-> 416), or null when the header should be ignored (absent/garbage/multi-range -> serve 200).
 */
export function parseRange(header: string, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // not a single "bytes=a-b" range (incl. multi-range): ignore, serve whole
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (size === 0) return "unsatisfiable";
  if (a === "") {
    const n = Number(b); // suffix: last n bytes
    if (!Number.isSafeInteger(n) || n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start) || start >= size) return "unsatisfiable";
  let end = b === "" ? size - 1 : Number(b);
  if (!Number.isSafeInteger(end) || end < start) return null; // invalid -> ignore per RFC
  end = Math.min(end, size - 1);
  return { start, end };
}
