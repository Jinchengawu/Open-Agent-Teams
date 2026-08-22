import { extname } from 'node:path';

export interface ArtifactContentInspectionPolicy {
  /** Server-owned allowlist. Archive/container and executable formats remain forbidden. */
  allowedMimeTypes: readonly string[];
}

export interface ArtifactContentInspection {
  mimeType: string;
  kind: 'text' | 'binary';
}

export interface ArtifactContentInspector {
  inspect(path: string, content: Buffer, policy: ArtifactContentInspectionPolicy): ArtifactContentInspection;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};

const forbiddenMagic: Array<{ label: string; bytes: Buffer; offset?: number }> = [
  { label: 'ZIP', bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]) },
  { label: 'ZIP', bytes: Buffer.from([0x50, 0x4b, 0x05, 0x06]) },
  { label: 'GZIP', bytes: Buffer.from([0x1f, 0x8b, 0x08]) },
  { label: 'XZ', bytes: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) },
  { label: '7Z', bytes: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  { label: 'RAR', bytes: Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) },
  { label: 'ELF', bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  { label: 'MACH_O', bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xce]) },
  { label: 'MACH_O', bytes: Buffer.from([0xce, 0xfa, 0xed, 0xfe]) },
  { label: 'MACH_O', bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xcf]) },
  { label: 'MACH_O', bytes: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]) },
  { label: 'MACH_O', bytes: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
];

function hasMagic(content: Buffer, magic: { bytes: Buffer; offset?: number }): boolean {
  const offset = magic.offset ?? 0;
  return content.subarray(offset, offset + magic.bytes.length).equals(magic.bytes);
}
function isBzip2(content: Buffer): boolean {
  return content.subarray(0, 3).equals(Buffer.from('BZh')) && (content[3] ?? 0) >= 0x31 && (content[3] ?? 0) <= 0x39;
}
function isPe(content: Buffer): boolean {
  if (content.length < 68 || !content.subarray(0, 2).equals(Buffer.from('MZ'))) return false;
  const peOffset = content.readUInt32LE(0x3c);
  return peOffset >= 64 && peOffset + 4 <= content.length && content.subarray(peOffset, peOffset + 4).equals(Buffer.from([0x50, 0x45, 0, 0]));
}
function isTar(content: Buffer): boolean {
  if (content.length < 512 || !content.subarray(257, 262).equals(Buffer.from('ustar'))) return false;
  const stored = Number.parseInt(content.subarray(148, 156).toString('ascii').replace(/\0.*$/, '').trim(), 8);
  if (!Number.isFinite(stored)) return false;
  let calculated = 0;
  for (let index = 0; index < 512; index += 1) calculated += index >= 148 && index < 156 ? 0x20 : content[index]!;
  return calculated === stored;
}

// Embedded scans apply only after a binary carrier has itself been identified.
// Short text-colliding signatures (MZ/BZh/GZIP) are intentionally excluded.
const strongEmbeddedPolyglotMagic = forbiddenMagic.filter(({ label, bytes, offset }) =>
  offset === undefined && bytes.length >= 4 && !['PE', 'BZIP2'].includes(label));
function rejectEmbeddedBinaryPolyglot(content: Buffer, carrierHeaderBytes: number): void {
  for (const magic of strongEmbeddedPolyglotMagic) {
    if (content.indexOf(magic.bytes, carrierHeaderBytes) >= 0) throw new Error(`OCI export forbidden embedded polyglot magic: ${magic.label}`);
  }
}

export class DefaultArtifactContentInspector implements ArtifactContentInspector {
  inspect(path: string, content: Buffer, policy: ArtifactContentInspectionPolicy): ArtifactContentInspection {
    const expectedMime = MIME_BY_EXTENSION[extname(path).toLowerCase()];
    if (!expectedMime) throw new Error('OCI export content type has no server-known extension mapping');
    if (isBzip2(content)) throw new Error('OCI export forbidden archive/executable/polyglot magic: BZIP2');
    if (isPe(content)) throw new Error('OCI export forbidden archive/executable/polyglot magic: PE');
    if (isTar(content)) throw new Error('OCI export forbidden archive/executable/polyglot magic: TAR');
    for (const magic of forbiddenMagic) {
      if (hasMagic(content, magic)) throw new Error(`OCI export forbidden archive/executable/polyglot magic: ${magic.label}`);
    }
    const inspection = inspectExpected(expectedMime, content);
    if (inspection.mimeType !== expectedMime) throw new Error('OCI export extension and MIME content do not match');
    if (!policy.allowedMimeTypes.includes(inspection.mimeType)) throw new Error(`OCI export MIME is not allowed by server policy: ${inspection.mimeType}`);
    return inspection;
  }
}

function inspectExpected(expectedMime: string, content: Buffer): ArtifactContentInspection {
  if (expectedMime === 'image/png') {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!content.subarray(0, png.length).equals(png)) throw new Error('OCI export extension and MIME content do not match');
    rejectEmbeddedBinaryPolyglot(content, png.length);
    return { mimeType: expectedMime, kind: 'binary' };
  }
  if (expectedMime === 'image/jpeg') {
    if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8 || content.at(-2) !== 0xff || content.at(-1) !== 0xd9) throw new Error('OCI export extension and MIME content do not match');
    rejectEmbeddedBinaryPolyglot(content.subarray(0, -2), 2);
    return { mimeType: expectedMime, kind: 'binary' };
  }
  if (content.includes(0)) throw new Error('OCI export text contains NUL bytes');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); }
  catch { throw new Error('OCI export text is not valid UTF-8'); }
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) throw new Error('OCI export text contains forbidden control characters');
  }
  if (expectedMime === 'application/json') {
    try { JSON.parse(text); } catch { throw new Error('OCI export JSON content is invalid'); }
  }
  return { mimeType: expectedMime, kind: 'text' };
}

export const DEFAULT_ARTIFACT_CONTENT_POLICY: ArtifactContentInspectionPolicy = Object.freeze({
  allowedMimeTypes: Object.freeze(['application/json', 'text/plain', 'text/markdown']),
});
