export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let csrfToken = '';
export const setCsrf = (t: string) => (csrfToken = t);

type Opts = { method?: string; body?: unknown; signal?: AbortSignal };

export async function api<T = any>(url: string, opts: Opts = {}): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      signal: opts.signal,
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'rede', 'Falha de conexão. Verifique a internet e tente novamente.');
  }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    if (res.status === 401 && url.startsWith('/api/admin/')) window.dispatchEvent(new CustomEvent('session-expired'));
    throw new ApiError(res.status, data?.error ?? 'erro', data?.message ?? `Erro ${res.status}`, data?.fields ?? {}, data ?? {});
  }
  return data as T;
}

/** Download de arquivo gerado pelo servidor (exportações). */
export async function download(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ApiError(res.status, d.error ?? 'erro', d.message ?? 'Falha na exportação.');
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'relatorio';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
