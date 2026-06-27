import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { NextResponse } from 'next/server';
import { DEFAULT_SETTINGS } from '@/lib/constants';
import type { AppSettings } from '@/lib/types';

export const runtime = 'nodejs';

const SETTINGS_PATH =
  process.env.DEV_AGENT_MODEL_SETTINGS_FILE ||
  join(process.env.DEV_AGENT_DATA_DIR || join(homedir(), '.dev-agent/data'), 'model-settings.json');

function normalizeSettings(input: Partial<AppSettings>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  const modelProfiles = Array.isArray(merged.modelProfiles) && merged.modelProfiles.length > 0
    ? merged.modelProfiles
    : DEFAULT_SETTINGS.modelProfiles;
  const defaultModelProfileId = modelProfiles.some((profile) => profile.id === merged.defaultModelProfileId)
    ? merged.defaultModelProfileId
    : modelProfiles[0].id;
  return {
    ...merged,
    modelProfiles,
    defaultModelProfileId,
    agentModelAssignments: merged.agentModelAssignments || {},
  };
}

export async function GET() {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8');
    return NextResponse.json({ settings: normalizeSettings(JSON.parse(raw)) });
  } catch {
    return NextResponse.json({ settings: DEFAULT_SETTINGS });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const settings = normalizeSettings(body?.settings || body || {});
    await mkdir(dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    return NextResponse.json({ settings, path: SETTINGS_PATH });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save settings' },
      { status: 400 },
    );
  }
}
