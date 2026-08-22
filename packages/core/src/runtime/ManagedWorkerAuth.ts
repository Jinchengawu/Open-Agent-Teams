import { createHash, timingSafeEqual } from 'node:crypto';

export function verifyManagedWorkerBearer(
  authorizationHeader: string | undefined,
  configuredToken: string | undefined,
): boolean {
  const expected = configuredToken?.trim();
  if (!expected || !authorizationHeader) return false;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;

  const actualDigest = createHash('sha256').update(match[1]).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}
