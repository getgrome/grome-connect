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
    const body = fs.readFileSync(path.join(tmp, '.claude/skills/grome-workspace.md'), 'utf8');
    expect(body).toContain('grome-managed');
    expect(body).toContain('grome__read_chat_log');
  });

  it('is idempotent — second run reports unchanged', () => {
    SkillTemplate.provision(tmp);
    const second = SkillTemplate.provision(tmp);
    expect(second[0].action).toBe('unchanged');
  });

  it('refuses to overwrite a user-authored file (no sentinel)', () => {
    const target = path.join(tmp, '.claude/skills/grome-workspace.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'user wrote this, no sentinel');
    const results = SkillTemplate.provision(tmp);
    expect(results[0].action).toBe('skipped-user-managed');
    expect(fs.readFileSync(target, 'utf8')).toBe('user wrote this, no sentinel');
  });
});

describe('SkillTemplate.unprovision', () => {
  it('removes a managed file', () => {
    SkillTemplate.provision(tmp);
    const results = SkillTemplate.unprovision(tmp);
    expect(results[0].action).toBe('removed');
  });

  it('leaves user-managed files alone', () => {
    const target = path.join(tmp, '.claude/skills/grome-workspace.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'mine');
    const results = SkillTemplate.unprovision(tmp);
    expect(results[0].action).toBe('skipped-user-managed');
    expect(fs.existsSync(target)).toBe(true);
  });
});
