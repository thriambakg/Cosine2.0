/**
 * Shared Cognito session helpers for API calls and auth flows.
 * Used by apiRequest (Bearer token) and AuthContext (session validation).
 */

import { fetchAuthSession } from 'aws-amplify/auth';

export type AmplifyAuthSession = Awaited<ReturnType<typeof fetchAuthSession>>;

/** True when Amplify has usable ID or access tokens. */
export function hasValidSessionTokens(session: AmplifyAuthSession): boolean {
  return !!(session.tokens?.idToken || session.tokens?.accessToken);
}

function tokenToBearerString(
  token: NonNullable<AmplifyAuthSession['tokens']>['idToken']
): string {
  if (!token) return '';
  if (typeof token.toString === 'function') {
    const s = token.toString();
    if (s && s !== '[object Object]') return s;
  }
  if (typeof token === 'string') return token;
  const obj = token as { tokenString?: string };
  return obj.tokenString || '';
}

/** Returns JWT bearer string for API Gateway, or null if unauthenticated. */
export async function getAuthorizationBearer(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    if (!hasValidSessionTokens(session)) {
      return null;
    }
    const token = session.tokens?.idToken || session.tokens?.accessToken;
    const bearer = tokenToBearerString(token);
    return bearer || null;
  } catch {
    return null;
  }
}

/** Whether the current Cognito token is expired or expiring within bufferSeconds. */
export function isTokenExpired(
  session: AmplifyAuthSession,
  bufferSeconds = 5
): boolean {
  const token = session.tokens?.idToken || session.tokens?.accessToken;
  if (!token || typeof token !== 'object' || !('payload' in token)) {
    return false;
  }
  const payload = (token as { payload?: { exp?: number } }).payload;
  if (!payload?.exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + bufferSeconds;
}
