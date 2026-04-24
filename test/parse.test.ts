import { describe, expect, it } from 'vitest';
import {
  extractLastTurn,
  hashThreadContent,
  parseFrom,
  parseLastAuthorAgent,
  parseLastSpeaker,
} from '../src/watch/parse.js';

const THREAD = `# Thread: test

**From:** grome
**To:** grome-connect
**Started:** 2026-04-22T19:27:00Z
**Status:** open

---

## grome @ 2026-04-22T19:27:00Z

Opening message.

## grome-connect @ 2026-04-22T19:45:00Z

Reply here.
`;

describe('parseFrom', () => {
  it('reads the From field', () => {
    expect(parseFrom(THREAD)).toBe('grome');
  });
  it('returns null when missing', () => {
    expect(parseFrom('no header here')).toBeNull();
  });
});

describe('parseLastSpeaker', () => {
  it('returns the speaker of the last turn', () => {
    expect(parseLastSpeaker(THREAD)).toBe('grome-connect');
  });
  it('returns null when there are no turns', () => {
    expect(parseLastSpeaker('# Thread: x\n\n**From:** grome\n')).toBeNull();
  });
});

describe('parseLastAuthorAgent', () => {
  it('returns null when the header has no [agent] suffix', () => {
    expect(parseLastAuthorAgent(THREAD)).toBeNull();
  });
  it('parses `## project @ ts [agent]`', () => {
    const t = THREAD + `\n## grome @ 2026-04-22T20:00:00Z [claude]\n\nbody\n`;
    expect(parseLastAuthorAgent(t)).toBe('claude');
  });
  it('parses agent names with hyphens and dots', () => {
    const t = THREAD + `\n## grome @ 2026-04-22T20:00:00Z [codex-cli]\n\nbody\n`;
    expect(parseLastAuthorAgent(t)).toBe('codex-cli');
  });
  it('ignores brackets in the body, only reads the header line', () => {
    const t = THREAD + `\n## grome @ 2026-04-22T20:00:00Z\n\nsome body with [brackets] inside\n`;
    expect(parseLastAuthorAgent(t)).toBeNull();
  });
});

describe('extractLastTurn', () => {
  it('captures from last turn header to EOF', () => {
    const turn = extractLastTurn(THREAD);
    expect(turn).toContain('## grome-connect @ 2026-04-22T19:45:00Z');
    expect(turn).toContain('Reply here.');
    expect(turn).not.toContain('Opening message.');
  });
  it('strips resolution footer so status flips are silent', () => {
    const withFooter = THREAD + `\n---\n\n**Resolution:** done\n**Resolved by:** grome-connect @ 2026-04-22T20:00:00Z\n`;
    const turn = extractLastTurn(withFooter);
    expect(turn).not.toContain('Resolution:');
    expect(turn).not.toContain('Resolved by:');
  });
});

describe('hashThreadContent', () => {
  it('changes when a new turn is appended', () => {
    const h1 = hashThreadContent(THREAD);
    const updated = THREAD + `\n## grome @ 2026-04-22T20:00:00Z\n\nAnother turn.\n`;
    const h2 = hashThreadContent(updated);
    expect(h1).not.toBe(h2);
  });
  it('is stable across cosmetic trailing whitespace only inside the turn', () => {
    // Same final turn content — hash should not move when content before
    // the last turn header changes (sync rewrites index lines above).
    const withPrefixChange = '<!-- cosmetic -->\n' + THREAD;
    expect(hashThreadContent(withPrefixChange)).toBe(hashThreadContent(THREAD));
  });
  it('does not change when resolution footer is appended', () => {
    const withFooter = THREAD + `\n---\n\n**Resolution:** done\n**Resolved by:** grome-connect @ 2026-04-22T20:00:00Z\n`;
    expect(hashThreadContent(withFooter)).toBe(hashThreadContent(THREAD));
  });
});
