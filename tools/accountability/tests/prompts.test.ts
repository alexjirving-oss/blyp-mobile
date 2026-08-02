import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReviewDecision } from '../src/prompts.js';

test('parses a strict evidence-based review decision', () => {
  const decision = parseReviewDecision(
    JSON.stringify({
      verdict: 'REJECT',
      summary: 'The authorization guard is bypassed.',
      findings: [
        {
          id: 'auth-guard-bypass',
          severity: 'high',
          title: 'Authorization bypass',
          evidence: 'src/auth.ts returns before checking the principal.',
          file: 'src/auth.ts',
          line: 42,
        },
      ],
    }),
  );
  assert.equal(decision.verdict, 'REJECT');
  assert.equal(decision.findings[0]?.id, 'auth-guard-bypass');
});

test('rejects prose masquerading as structured evidence', () => {
  assert.throws(() => parseReviewDecision('Everything looks good to me.'), /invalid JSON/);
});

test('reject verdicts require concrete findings', () => {
  assert.throws(
    () =>
      parseReviewDecision(
        JSON.stringify({
          verdict: 'REJECT',
          summary: 'There might be a problem.',
          findings: [],
        }),
      ),
    /must include at least one finding/,
  );
});

test('pass cannot conceal blocking findings', () => {
  assert.throws(
    () =>
      parseReviewDecision(
        JSON.stringify({
          verdict: 'PASS',
          summary: 'Pass despite a serious defect.',
          findings: [
            {
              id: 'hidden-defect',
              severity: 'critical',
              title: 'Critical defect',
              evidence: 'Specific evidence.',
            },
          ],
        }),
      ),
    /PASS review may contain only low-severity findings/,
  );
});

test('unknown review fields are rejected', () => {
  assert.throws(
    () =>
      parseReviewDecision(
        JSON.stringify({
          verdict: 'PASS',
          summary: 'No defect found.',
          findings: [],
          confidenceTheater: 0.99,
        }),
      ),
    /unknown property/,
  );
});
