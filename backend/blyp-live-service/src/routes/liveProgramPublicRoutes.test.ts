import '../live/testEnv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyProgramCors, programOrigins } from './liveProgramPublicRoutes';

function fakeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown = null;
  return {
    headers,
    statusCode,
    body,
    set(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    removeHeader(k: string) {
      delete headers[k.toLowerCase()];
    },
    status(n: number) {
      statusCode = n;
      this.statusCode = n;
      return this;
    },
    json(b: unknown) {
      body = b;
      this.body = b;
      return this;
    },
  } as any;
}

describe('GET /live/program CORS', () => {
  it('includes frozen blyp.world origins', () => {
    assert.ok(programOrigins().includes('https://blyp.world'));
    assert.ok(programOrigins().includes('http://localhost:3000'));
  });

  it('403s evil Origin and strips ACAO', () => {
    const res = fakeRes();
    res.set('Access-Control-Allow-Origin', '*');
    const req = { headers: { origin: 'http://evil.example' } } as any;
    const ok = applyProgramCors(req, res);
    assert.equal(ok, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.equal(res.body?.code, 'CORS');
  });

  it('allows blyp.world Origin', () => {
    const res = fakeRes();
    const req = { headers: { origin: 'https://blyp.world' } } as any;
    const ok = applyProgramCors(req, res);
    assert.equal(ok, true);
    assert.equal(res.headers['access-control-allow-origin'], 'https://blyp.world');
    assert.equal(res.headers['access-control-allow-methods'], 'GET,POST,OPTIONS');
  });

  it('allows missing Origin (curl)', () => {
    const res = fakeRes();
    res.set('Access-Control-Allow-Origin', '*');
    const req = { headers: {} } as any;
    const ok = applyProgramCors(req, res);
    assert.equal(ok, true);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});
