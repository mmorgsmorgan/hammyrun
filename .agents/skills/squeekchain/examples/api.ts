// api.ts
export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Supply ${name}`);
  return value;
};

/** GET a public endpoint, waiting out rate limits and capacity errors a bounded number of times. */
export async function apiGet<T>(path: string): Promise<T> {
  const base = required("API_BASE_URL");
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(new URL(path, base), { headers: { accept: "application/json" } });
    if ((response.status === 429 || response.status === 503) && attempt < 3) {
      const seconds = Number(response.headers.get("retry-after") ?? "2");
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      continue;
    }
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }
}
