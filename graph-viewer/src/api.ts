const API_BASE = '/api';

export type IntersectionResponse = {
  options: string[];
  nodes: string[];
  edges: [string, string][];
};

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** options: empty or omitted = full graph; otherwise intersection of selected filters (public, sink, vuln). */
export async function fetchIntersection(options: string[] = []): Promise<IntersectionResponse> {
  const params = options.length
    ? '?' + options.map((o) => `options=${encodeURIComponent(o)}`).join('&')
    : '';
  return fetchJson<IntersectionResponse>(`${API_BASE}/intersection${params}`);
}

