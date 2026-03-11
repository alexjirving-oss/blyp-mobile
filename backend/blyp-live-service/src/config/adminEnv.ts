import { z } from 'zod';

const adminEnvSchema = z.object({
    ADMIN_ALLOWLIST_SUBS: z.string().optional(),
});

export type AdminEnv = {
    allowlistSubs: string[];
};

export function getAdminEnv(): AdminEnv {
    const parsed = adminEnvSchema.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        throw new Error(`[admin-env] Missing/invalid env vars: ${JSON.stringify(issues)}`);
    }

    const raw = String(parsed.data.ADMIN_ALLOWLIST_SUBS || '').trim();
    const allowlistSubs = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    return { allowlistSubs };
}
