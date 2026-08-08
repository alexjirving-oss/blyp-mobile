/**
 * Guard: ProfileCompletionGate must never mount a username overlay.
 * Alex: username is collected only on AuthScreen first signup.
 */
const fs = require('fs');
const path = require('path');

describe('ProfileCompletionGate — no overlay spam', () => {
  const gateSrc = fs.readFileSync(
    path.join(__dirname, '../src/components/ProfileCompletionGate.js'),
    'utf8',
  );

  it('does not import username completion UI', () => {
    expect(gateSrc).not.toMatch(/from ['"].*ProfileCompletionScreen['"]/);
    expect(gateSrc).not.toMatch(/<ProfileCompletionScreen/);
  });

  it('always returns children (pass-through)', () => {
    expect(gateSrc).toMatch(/return children/);
    expect(gateSrc).not.toMatch(/ActivityIndicator/);
  });

  it('marks missing handles deferred instead of prompting', () => {
    expect(gateSrc).toMatch(/markUsernameDeferred/);
  });
});
