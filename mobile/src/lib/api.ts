import { appConfig } from '@/src/config';
import { sessionStore } from '@/src/lib/session';
import type {
  Competition,
  LeaderMetric,
  LineupEntry,
  LiveMatchSnapshot,
  Match,
  MatchEvent,
  Page,
  Player,
  PlayerLeaderRow,
  PlayerMatchStat,
  PlayerSeasonSummary,
  PresignResponse,
  RegistrationInvite,
  StandingRow,
  Team,
  TokenResponse,
  User,
} from '@/src/types/api';

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; authenticated?: boolean };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code = 'request_error',
    readonly fields?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as {
      detail?: { code?: string; message?: string; field_errors?: { field: string; message: string }[] };
    };
    return new ApiError(
      payload.detail?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      payload.detail?.code,
      payload.detail?.field_errors,
    );
  } catch {
    return new ApiError(`Request failed with status ${response.status}.`, response.status);
  }
}

let refreshPromise: Promise<TokenResponse> | null = null;

async function refreshSession(): Promise<TokenResponse> {
  const session = sessionStore.get();
  if (!session) throw new ApiError('Sign in to continue.', 401, 'authentication_required');
  if (!refreshPromise) {
    refreshPromise = request<TokenResponse>('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
      authenticated: false,
    })
      .then(async (next) => {
        await sessionStore.save(next);
        return next;
      })
      .catch(async (error) => {
        await sessionStore.clear();
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.requestTimeoutMs);
  const authenticated = options.authenticated !== false;
  const session = sessionStore.get();
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (authenticated && session) headers.set('Authorization', `Bearer ${session.access_token}`);

  try {
    const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      signal: controller.signal,
    });
    if (response.status === 401 && authenticated && session) {
      const next = await refreshSession();
      return request<T>(path, {
        ...options,
        headers: { ...Object.fromEntries(headers), Authorization: `Bearer ${next.access_token}` },
      });
    }
    if (!response.ok) throw await parseError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('The server did not respond in time.', undefined, 'timeout');
    }
    throw new ApiError('You appear to be offline. Check your connection and try again.', undefined, 'offline');
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  getHealth: () => request<{ status: 'ok'; service: string; version: string; environment: string }>('/api/v1/health', { authenticated: false }),
  login: (email: string, password: string) =>
    request<TokenResponse>('/api/v1/auth/login', {
      method: 'POST', body: { email, password }, authenticated: false,
    }),
  register: (name: string, email: string, password: string, invite_code: string) =>
    request<TokenResponse>('/api/v1/auth/register', {
      method: 'POST', body: { name, email, password, invite_code }, authenticated: false,
    }),
  logout: (refresh_token: string) =>
    request<void>('/api/v1/auth/logout', { method: 'POST', body: { refresh_token }, authenticated: false }),
  requestReset: (email: string) =>
    request<{ message: string }>('/api/v1/auth/password-reset/request', {
      method: 'POST', body: { email }, authenticated: false,
    }),
  confirmReset: (email: string, code: string, new_password: string) =>
    request<{ message: string }>('/api/v1/auth/password-reset/confirm', {
      method: 'POST', body: { email, code, new_password }, authenticated: false,
    }),
  me: () => request<User>('/api/v1/users/me'),
  updateMe: (name: string) => request<User>('/api/v1/users/me', { method: 'PATCH', body: { name } }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ message: string }>('/api/v1/auth/password/change', {
      method: 'POST', body: { current_password, new_password },
    }),
  deleteMe: () => request<void>('/api/v1/users/me', { method: 'DELETE' }),
  teams: (query = '') => request<Page<Team>>(`/api/v1/teams${query}`),
  createTeam: (payload: Partial<Team>) => request<Team>('/api/v1/teams', { method: 'POST', body: payload }),
  updateTeam: (id: string, payload: Partial<Team>) => request<Team>(`/api/v1/teams/${id}`, { method: 'PATCH', body: payload }),
  deleteTeam: (id: string) => request<void>(`/api/v1/teams/${id}`, { method: 'DELETE' }),
  competitions: (query = '') => request<Page<Competition>>(`/api/v1/competitions${query}`),
  createCompetition: (payload: Partial<Competition>) => request<Competition>('/api/v1/competitions', { method: 'POST', body: payload }),
  updateCompetition: (id: string, payload: Partial<Competition>) => request<Competition>(`/api/v1/competitions/${id}`, { method: 'PATCH', body: payload }),
  deleteCompetition: (id: string) => request<void>(`/api/v1/competitions/${id}`, { method: 'DELETE' }),
  players: (query = '') => request<Page<Player>>(`/api/v1/players${query}`),
  createPlayer: (payload: Partial<Player>) => request<Player>('/api/v1/players', { method: 'POST', body: payload }),
  updatePlayer: (id: string, payload: Partial<Player>) => request<Player>(`/api/v1/players/${id}`, { method: 'PATCH', body: payload }),
  deletePlayer: (id: string) => request<void>(`/api/v1/players/${id}`, { method: 'DELETE' }),
  matches: (query = '') => request<Page<Match>>(`/api/v1/matches${query}`),
  createMatch: (payload: Partial<Match>) => request<Match>('/api/v1/matches', { method: 'POST', body: payload }),
  updateMatch: (id: string, payload: Partial<Match>) => request<Match>(`/api/v1/matches/${id}`, { method: 'PATCH', body: payload }),
  deleteMatch: (id: string) => request<void>(`/api/v1/matches/${id}`, { method: 'DELETE' }),
  live: (id: string) => request<LiveMatchSnapshot>(`/api/v1/matches/${id}/live`),
  createEvent: (matchId: string, payload: Partial<MatchEvent>) => request<MatchEvent>(`/api/v1/matches/${matchId}/events`, { method: 'POST', body: payload }),
  deleteEvent: (matchId: string, eventId: string) => request<void>(`/api/v1/matches/${matchId}/events/${eventId}`, { method: 'DELETE' }),
  lineup: (matchId: string, payload: Partial<LineupEntry>[]) => request<LineupEntry[]>(`/api/v1/matches/${matchId}/lineup`, { method: 'PUT', body: payload }),
  stats: (matchId: string, payload: Partial<PlayerMatchStat>[]) => request<PlayerMatchStat[]>(`/api/v1/matches/${matchId}/player-stats`, { method: 'PUT', body: payload }),
  standings: (competitionId: string) => request<StandingRow[]>(`/api/v1/competitions/${competitionId}/standings`),
  leaders: (metric: LeaderMetric, options: { ageGroup?: string; season?: string; limit?: number } = {}) => {
    const params = new URLSearchParams({ metric });
    if (options.ageGroup) params.set('age_group', options.ageGroup);
    if (options.season) params.set('season', options.season);
    if (options.limit) params.set('limit', String(options.limit));
    return request<PlayerLeaderRow[]>(`/api/v1/stats/leaders?${params.toString()}`);
  },
  playerStats: (playerId: string, season?: string) => request<PlayerSeasonSummary>(`/api/v1/players/${playerId}/stats${season ? `?season=${encodeURIComponent(season)}` : ''}`),
  invites: () => request<RegistrationInvite[]>('/api/v1/admin/registration-invites'),
  createInvite: (payload: { label: string; code: string; expires_at?: string | null; max_uses?: number | null }) => request<RegistrationInvite>('/api/v1/admin/registration-invites', { method: 'POST', body: payload }),
  revokeInvite: (id: string) => request<void>(`/api/v1/admin/registration-invites/${id}`, { method: 'DELETE' }),
  presign: (entity: 'team' | 'player', entity_id: string, content_type: 'image/jpeg' | 'image/png' | 'image/webp') => request<PresignResponse>('/api/v1/media/uploads/presign', { method: 'POST', body: { entity, entity_id, content_type } }),
};
