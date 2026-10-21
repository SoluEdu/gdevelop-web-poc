import { describe, it, expect } from 'vitest';
import { auditAssets } from './audit';

const resources = (...items: { name: string; kind: string; file: string }[]) => ({ resources: items });

describe('auditAssets', () => {
  it('flags resources not referenced by content', () => {
    const project = {
      layouts: [{ objects: [{ animations: [{ directions: [{ sprites: [{ image: 'player.png' }] }] }] }] }],
      resources: resources(
        { name: 'player.png', kind: 'image', file: 'assets/player.png' },
        { name: 'unused.png', kind: 'image', file: 'assets/unused.png' },
      ),
    };
    const entries = [
      { name: 'game/assets/player.png', size: 100 },
      { name: 'game/assets/unused.png', size: 400 },
    ];
    const audit = auditAssets(project, entries);
    expect(audit?.total).toBe(2);
    expect(audit?.used).toBe(1);
    expect(audit?.unused).toEqual([
      { name: 'unused.png', kind: 'image', file: 'assets/unused.png', zipSize: 400 },
    ]);
  });

  it('reports used resources missing from the zip', () => {
    const project = {
      layouts: [{ objects: [{ content: { tileset: 'tiles.png' } }] }],
      resources: resources(
        { name: 'tiles.png', kind: 'image', file: 'assets/tiles.png' },
        { name: 'ghost.ogg', kind: 'audio', file: 'assets/ghost.ogg' },
      ),
    };
    const audit = auditAssets(project, [{ name: 'assets/other.png', size: 10 }]);
    expect(audit?.unused.map((a) => a.name)).toEqual(['ghost.ogg']);
    expect(audit?.missing.map((a) => a.name)).toEqual(['tiles.png']);
  });

  it('returns null when the project has no resources', () => {
    expect(auditAssets({ layouts: [] }, [])).toBeNull();
    expect(auditAssets(null, [])).toBeNull();
  });
});
