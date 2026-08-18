import { TOKEN_PREFIX } from './settings.js';
import type { Pet } from './types.js';

/** Any failure talking to the API. */
export class PinPawApiError extends Error {}

/**
 * The token was rejected (401/403). Split out from PinPawApiError because it
 * is terminal: retrying with a credential the server already refused just
 * generates load. The platform stops polling when it sees this.
 */
export class PinPawAuthError extends PinPawApiError {}

const REQUEST_TIMEOUT_MS = 15000;

/** Cheap local check so an obvious paste error is caught before any request. */
export function looksLikeToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

export class PinPawApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new PinPawApiError(`network error calling ${path}: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw new PinPawAuthError(`token rejected (HTTP ${response.status})`);
    }
    if (!response.ok) {
      throw new PinPawApiError(`${method} ${path} -> HTTP ${response.status}`);
    }
    if (response.status === 204) {
      return null;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new PinPawApiError(`malformed JSON from ${path}`);
    }
  }

  /** Verifies the token belongs to a live account. */
  async getAccount(): Promise<unknown> {
    return this.request('GET', '/api/auth/me');
  }

  /**
   * Every pet on the account, each with its status and latest position already
   * embedded, so one call covers a full refresh.
   */
  async getPets(): Promise<Pet[]> {
    const pets = await this.request<Pet[]>('GET', '/api/pets');
    if (!Array.isArray(pets)) {
      throw new PinPawApiError('/api/pets did not return a list');
    }
    return pets.filter((pet): pet is Pet => typeof pet?.id === 'number');
  }

  /** Pushes a new reporting interval to the tracker. */
  async setTrackingInterval(petId: number, seconds: number): Promise<void> {
    await this.request('PUT', `/api/pets/${petId}/tracking-interval`, {
      trackingInterval: seconds,
    });
  }
}
