import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { distanceMetres } from '../src/geo.js';

describe('distanceMetres', () => {
  it('is zero for identical points', () => {
    assert.equal(distanceMetres(52.2297, 21.0122, 52.2297, 21.0122), 0);
  });

  it('matches one degree of longitude at the equator', () => {
    assert.ok(Math.abs(distanceMetres(0, 0, 0, 1) - 111194.9) < 1);
  });

  it('matches one degree of latitude', () => {
    assert.ok(Math.abs(distanceMetres(0, 0, 1, 0) - 111194.9) < 1);
  });

  it('measures Warsaw to Krakow', () => {
    const d = distanceMetres(52.2297, 21.0122, 50.0647, 19.945);
    assert.ok(Math.abs(d - 252000) < 3000, `got ${d}`);
  });

  it('is symmetric', () => {
    const a = distanceMetres(52, 21, 50, 19);
    const b = distanceMetres(50, 19, 52, 21);
    assert.ok(Math.abs(a - b) < 1e-6);
  });

  it('does not return NaN for antipodal points', () => {
    const d = distanceMetres(0, 0, 0, 180);
    assert.ok(Number.isFinite(d), `got ${d}`);
  });
});
