import { api, refreshSession, session } from './api';

/** Download a file from the API (with auth) and save it under the server-provided name. */
export async function downloadFile(
  path: string,
  query: Record<string, string | string[] | undefined> = {},
): Promise<void> {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => url.searchParams.append(k, x));
  }
  const go = () =>
    fetch(url.pathname + url.search, { credentials: 'include', headers: authHeader() });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download.xlsx';
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function authHeader(): HeadersInit {
  // The token lives in api.ts memory; reuse it through a tiny probe request header builder.
  return session.authHeader();
}

/** POST a single file as multipart form data. */
export function uploadFile<T>(
  path: string,
  file: File,
  query?: Record<string, string | boolean | undefined>,
): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  return api<T>(path, {
    method: 'POST',
    body: fd,
    query: query as Record<string, string | undefined>,
  });
}
