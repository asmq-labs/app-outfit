import { API_URL } from '@/lib/config';
import { getAccessToken, refreshSession } from '@/lib/session';

type ErrorDetail = { code: string } & Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: ErrorDetail
  ) {
    super(`${status} ${detail.code}`);
  }

  get code(): string {
    return this.detail.code;
  }
}

function parseDetail(body: unknown): ErrorDetail {
  // The API sends either a plain code or an object with a code and extra data.
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return { code: detail };
  if (detail && typeof detail === 'object' && 'code' in detail) return detail as ErrorDetail;
  return { code: 'error' };
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${API_URL}/v1${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await request(path, init);
  if (response.status === 401) {
    await refreshSession();
    response = await request(path, init);
  }
  if (!response.ok) {
    throw new ApiError(response.status, parseDetail(await response.json().catch(() => null)));
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function jsonBody(method: 'POST' | 'PATCH' | 'PUT', body: object): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
