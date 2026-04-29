import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillTemplate } from '../src/core/SkillTemplate.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grome-skill-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('SkillTemplate.provision', () => {
  it('creates the skill file when absent', () => {
    const results = SkillTemplate.provision(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('created');
    const body = fs.readFileSync(path.join(tmp, '.claude/skills/grome-workspace/SKILL.md'), 'utf8');
    expect(body).toContain('grome-managed');
    expect(body).toContain('grome__read_chat_log');
  });

  it('is idempotent — second run reports unchanged', () => {
    SkillTemplate.provision(tmp);
    const second = SkillTemplate.provision(tmp);
    expect(second[0].action).toBe('unchanged');
  });

  it('refuses to overwrite a user-authored file (no sentinel)', () => {
    const target = path.join(tmp, '.claude/skills/grome-workspace/SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'user wrote this, no sentinel');
    const results = SkillTemplate.provision(tmp);
    expect(results[0].action).toBe('skipped-user-managed');
    expect(fs.readFileSync(target, 'utf8')).toBe('user wrote this, no sentinel');
  });
});

describe('SkillTemplate.provision — 0.6.0 → 0.6.1 migration', () => {
  it('removes the legacy flat-file skill if managed', () => {
    const legacy = path.join(tmp, '.claude/skills/grome-workspace.md');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '<!-- grome-managed: do not edit; managed by grome-connect sync -->\nold\n');
    SkillTemplate.provision(tmp);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.claude/skills/grome-workspace/SKILL.md'))).toBe(true);
  });

  it('leaves a user-authored flat file alone', () => {
    const legacy = path.join(tmp, '.claude/skills/grome-workspace.md');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, 'user wrote this');
    SkillTemplate.provision(tmp);
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.readFileSync(legacy, 'utf8')).toBe('user wrote this');
  });
});

describe('SkillTemplate.unprovision', () => {
  it('removes a managed file', () => {
    SkillTemplate.provision(tmp);
    const results = SkillTemplate.unprovision(tmp);
    expect(results[0].action).toBe('removed');
  });

  it('leaves user-managed files alone', () => {
    const target = path.join(tmp, '.claude/skills/grome-workspace/SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'mine');
    const results = SkillTemplate.unprovision(tmp);
    const ours = results.find((r) => r.path === target);
    expect(ours?.action).toBe('skipped-user-managed');
    expect(fs.existsSync(target)).toBe(true);
  });

  it('removes both the new and legacy paths when both are managed (0.7.0 cleanup)', () => {
    const sentinel = '<!-- grome-managed: do not edit; managed by grome-connect sync -->';
    const newPath = path.join(tmp, '.claude/skills/grome-workspace/SKILL.md');
    const legacyPath = path.join(tmp, '.claude/skills/grome-workspace.md');
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.writeFileSync(newPath, sentinel + '\nnew\n');
    fs.writeFileSync(legacyPath, sentinel + '\nlegacy\n');

    const results = SkillTemplate.unprovision(tmp);
    const removed = results.filter((r) => r.action === 'removed').map((r) => r.path);
    expect(removed).toContain(newPath);
    expect(removed).toContain(legacyPath);
    expect(fs.existsSync(newPath)).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(false);
    // Empty parent directory should be cleaned up too
    expect(fs.existsSync(path.dirname(newPath))).toBe(false);
  });
});
