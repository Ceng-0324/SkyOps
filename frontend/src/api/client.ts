export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

type ApiRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
};

export async function apiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail ?? `API request failed with status ${response.status}`);
  }

  return response.json() as Promise<TResponse>;
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail.flatMap((item: unknown) => {
        if (!item || typeof item !== "object" || !("msg" in item) || typeof item.msg !== "string") return [];
        const location = "loc" in item && Array.isArray(item.loc) ? item.loc.join(".") : "request";
        return [`${location}: ${item.msg}`];
      }).join("; ") || null;
    }
    return null;
  } catch {
    return null;
  }
}
