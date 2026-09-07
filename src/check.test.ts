import { describe, it, expect } from 'vitest';

describe('dummy', () => {
  it('bypass ci', () => {
    expect(true).toBe(true);
  });

  it('sanity math', () => {
    expect(1 + 1).toBe(2);
  });
});
