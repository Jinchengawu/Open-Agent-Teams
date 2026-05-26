import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

interface SkillMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  agent: string;
}

const CATEGORY_AGENT_MAP: Record<string, string> = {
  frontend: 'frontend',
  backend: 'backend',
  testing: 'testing',
  devops: 'devops',
  database: 'backend',
  security: 'devops',
  pm: 'pm',
};

function parseFrontmatter(content: string): {
  name: string;
  description: string;
  tags: string[];
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { name: '', description: '', tags: [] };
  }
  const fm = match[1];
  const name = (fm.match(/name:\s*(.+)/) || [])[1]?.trim() || '';
  const description =
    (fm.match(/description:\s*(.+)/) || [])[1]?.trim() || '';
  const tagsMatch = fm.match(/tags:\s*\[(.+?)\]/);
  const tags = tagsMatch
    ? tagsMatch[1].split(',').map((t) => t.trim().replace(/["']/g, ''))
    : [];
  return { name, description, tags };
}

export async function GET() {
  try {
    const skillsDir = path.resolve(process.cwd(), '../../skills');
    const categories = await readdir(skillsDir, { withFileTypes: true });
    const allSkills: SkillMeta[] = [];

    for (const cat of categories) {
      if (!cat.isDirectory()) continue;

      const catPath = path.join(skillsDir, cat.name);
      let items: string[];
      try {
        items = await readdir(catPath);
      } catch {
        continue;
      }

      for (const item of items) {
        const itemPath = path.join(catPath, item);
        const skillFilePath = path.join(itemPath, 'SKILL.md');
        try {
          const content = await readFile(skillFilePath, 'utf-8');
          const { name, description, tags } = parseFrontmatter(content);
          if (!name) continue;

          allSkills.push({
            id: item,
            name,
            category: cat.name,
            description,
            tags,
            agent: CATEGORY_AGENT_MAP[cat.name] || 'backend',
          });
        } catch {
          // Skip items without SKILL.md
        }
      }
    }

    return NextResponse.json({ skills: allSkills });
  } catch (e) {
    return NextResponse.json(
      {
        skills: [],
        error:
          e instanceof Error ? e.message : 'Failed to read skills directory',
      },
      { status: 500 }
    );
  }
}
