import { Router } from 'express';
import { getAppVersionPolicy, publicAppVersionPolicy } from './appVersionPolicy';

const router = Router();

// Deliberately public: the app checks this before a user signs in or refreshes
// an expired session, so an out-of-date client can render the update screen.
router.get('/app/version-policy', async (_req, res) => {
  const policy = await getAppVersionPolicy();
  return res.json({ policy: publicAppVersionPolicy(policy) });
});

export default router;
