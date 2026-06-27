// Used only by server-rendered code (generateMetadata, sitemap.ts, robots.ts) — this runs
// inside the Next.js server process itself, so it talks to the backend directly rather
// than through the /api rewrite proxy that the browser uses.
const SERVER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function fetchServerSide<T>(path: string, revalidateSeconds = 60): Promise<T | null> {
  try {
    const response = await fetch(`${SERVER_API_URL}${path}`, { next: { revalidate: revalidateSeconds } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
