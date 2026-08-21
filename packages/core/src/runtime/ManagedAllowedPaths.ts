function normalizeRepositoryPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized === '.') return normalized;
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return undefined;
  if (normalized.split('/').some((segment) => segment === '..' || segment === '')) return undefined;
  return normalized;
}

function escapeRegex(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function allowedPathPattern(pattern: string): RegExp | undefined {
  const normalized = normalizeRepositoryPath(pattern);
  if (normalized === undefined) return undefined;
  if (normalized === '' || normalized === '.') return /^.*$/;
  if (!normalized.includes('*')) {
    const exactOrDirectory = [...normalized].map(escapeRegex).join('');
    return new RegExp(`^${exactOrDirectory}(?:$|/)`);
  }

  let source = '^';
  for (let index = 0; index < normalized.length;) {
    if (normalized.startsWith('**/', index)) {
      source += '(?:[^/]+/)*';
      index += 3;
    } else if (normalized.startsWith('**', index)) {
      source += '.*';
      index += 2;
    } else if (normalized[index] === '*') {
      source += '[^/]*';
      index += 1;
    } else {
      source += escapeRegex(normalized[index]);
      index += 1;
    }
  }
  return new RegExp(`${source}$`);
}

export function isManagedPathAllowed(path: string, allowedPaths: string[]): boolean {
  const normalizedPath = normalizeRepositoryPath(path);
  if (normalizedPath === undefined || !normalizedPath || normalizedPath === '.') return false;
  return allowedPaths.some((candidate) => allowedPathPattern(candidate)?.test(normalizedPath) === true);
}
