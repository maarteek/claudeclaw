import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildObsidianContext, _resetObsidianCache } from './obsidian.js';

const tmpDir = path.join(os.tmpdir(), `obsidian-test-${Date.now()}`);

function writeNote(folder: string, name: string, content: string): void {
  const dir = path.join(tmpDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

describe('obsidian', () => {
  beforeEach(() => {
    _resetObsidianCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty string when config is undefined', () => {
    expect(buildObsidianContext(undefined)).toBe('');
  });

  it('returns empty string when folders have no notes with open tasks', () => {
    writeNote('Projects', 'done.md', '# Done\nAll tasks complete.');
    const result = buildObsidianContext({ vault: tmpDir, folders: ['Projects'] });
    expect(result).toBe('');
  });

  it('includes titles and open tasks from notes', () => {
    writeNote('Projects', 'hiring.md', '# Hiring\n- [ ] Post job listing\n- [x] Review resumes');
    const result = buildObsidianContext({ vault: tmpDir, folders: ['Projects'] });
    expect(result).toContain('Open: Post job listing (hiring)');
    expect(result).not.toContain('Review resumes');
  });

  it('skips notes tagged status: done', () => {
    writeNote('Projects', 'old.md', 'status: done\n- [ ] Should be ignored');
    const result = buildObsidianContext({ vault: tmpDir, folders: ['Projects'] });
    expect(result).toBe('');
  });

  it('includes notes from readOnly folders', () => {
    writeNote('Daily', 'today.md', '- [ ] Morning review');
    const result = buildObsidianContext({ vault: tmpDir, folders: [], readOnly: ['Daily'] });
    expect(result).toContain('Open: Morning review');
  });

  it('groups tasks by folder', () => {
    writeNote('FolderA', 'a.md', '- [ ] Task A');
    writeNote('FolderB', 'b.md', '- [ ] Task B');
    const result = buildObsidianContext({ vault: tmpDir, folders: ['FolderA', 'FolderB'] });
    expect(result).toContain('FolderA/');
    expect(result).toContain('FolderB/');
  });

  it('uses cache on second call', () => {
    writeNote('Projects', 'x.md', '- [ ] First task');
    const first = buildObsidianContext({ vault: tmpDir, folders: ['Projects'] });
    // Add a new note — should not appear due to cache
    writeNote('Projects', 'y.md', '- [ ] Second task');
    const second = buildObsidianContext({ vault: tmpDir, folders: ['Projects'] });
    expect(first).toBe(second);
    expect(second).not.toContain('Second task');
  });

  it('output is reasonably compact', () => {
    for (let i = 0; i < 10; i++) {
      writeNote('Big', `note${i}.md`, `- [ ] Task ${i}`);
    }
    const result = buildObsidianContext({ vault: tmpDir, folders: ['Big'] });
    // Rough check: should be under ~2000 chars for 10 tasks
    expect(result.length).toBeLessThan(2000);
  });
});
