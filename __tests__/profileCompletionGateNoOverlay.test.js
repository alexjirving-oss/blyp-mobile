/**
 * Guard: ProfileCompletionGate never spams username UI on every launch.
 * Email path: silent only. Social: one-time max (ProfileCompletionScreen + deferral).
 */
const fs = require('fs');
const path = require('path');

describe('ProfileCompletionGate — no overlay spam', () => {
  const gateSrc = fs.readFileSync(
    path.join(__dirname, '../src/components/ProfileCompletionGate.js'),
    'utf8',
  );

  it('imports completion UI only for the social one-time path', () => {
    expect(gateSrc).toMatch(/from ['"].*ProfileCompletionScreen['"]/);
    expect(gateSrc).toMatch(/isFederatedAuthUser/);
    expect(gateSrc).toMatch(/socialPrompt/);
  });

  it('never blocks the app on a loading spinner', () => {
    expect(gateSrc).not.toMatch(/ActivityIndicator/);
  });

  it('persists deferral so social / legacy never re-nags every launch', () => {
    expect(gateSrc).toMatch(/markUsernameDeferred/);
    expect(gateSrc).toMatch(/isUsernameDeferred/);
  });

  it('silently claims signup pending without forcing email overlay', () => {
    expect(gateSrc).toMatch(/pending claim failed; will not overlay email path/);
  });
});
