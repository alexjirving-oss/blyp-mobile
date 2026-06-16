import {
    AdminDeleteUserCommand,
    AdminDisableUserCommand,
    AdminEnableUserCommand,
    CognitoIdentityProviderClient,
    ListUsersCommand,
    type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import ENV from '../config/env';
import { logger } from '../config/logger';

export type DirectoryUser = {
    userId: string;
    username: string;
    email: string;
    phoneNumber: string;
    displayName: string;
    givenName: string;
    familyName: string;
    dateOfBirth: string;
    address: string;
    city: string;
    region: string;
    postcode: string;
    country: string;
    enabled: boolean;
    userStatus: string;
    createdAt: string | null;
    updatedAt: string | null;
};

export type DirectoryUserProof = {
    getClientSucceeded: boolean;
    listUsersAttempted: boolean;
    listUsersThrew: boolean;
    directoryCount: number;
    proofUserMatchedBeforeFiltering: boolean;
};

let cachedClient: CognitoIdentityProviderClient | null = null;
let cachedRegion = '';

function getClient(): CognitoIdentityProviderClient | null {
    const region = String(ENV.COGNITO_REGION || '').trim();
    const userPoolId = String(ENV.COGNITO_USER_POOL_ID || '').trim();
    if (!region || !userPoolId) {
        return null;
    }
    if (!cachedClient || cachedRegion !== region) {
        cachedRegion = region;
        cachedClient = new CognitoIdentityProviderClient({ region });
    }
    return cachedClient;
}

function getPoolId(): string {
    return String(ENV.COGNITO_USER_POOL_ID || '').trim();
}

function getAttr(user: UserType, name: string): string {
    const found = (user.Attributes || []).find((attr) => String(attr.Name || '') === name);
    return String(found?.Value || '').trim();
}

function parseAddress(raw: string): { address: string; city: string; region: string; postcode: string; country: string } {
    if (!raw) {
        return { address: '', city: '', region: '', postcode: '', country: '' };
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return {
                address: String(parsed.formatted || parsed.street_address || '').trim(),
                city: String(parsed.locality || '').trim(),
                region: String(parsed.region || '').trim(),
                postcode: String(parsed.postal_code || '').trim(),
                country: String(parsed.country || '').trim(),
            };
        }
    } catch {
        // Fall back to plain address text below.
    }

    return {
        address: raw,
        city: '',
        region: '',
        postcode: '',
        country: '',
    };
}

function mapUser(user: UserType): DirectoryUser {
    const sub = getAttr(user, 'sub');
    const username = String(user.Username || '').trim();
    const email = getAttr(user, 'email');
    const preferredUsername = getAttr(user, 'preferred_username');
    const givenName = getAttr(user, 'given_name');
    const familyName = getAttr(user, 'family_name');
    const fullName = getAttr(user, 'name');
    const displayName = fullName || preferredUsername || [givenName, familyName].filter(Boolean).join(' ').trim() || email || username || sub;
    const parsedAddress = parseAddress(getAttr(user, 'address'));

    return {
        userId: sub || username || email,
        username,
        email,
        phoneNumber: getAttr(user, 'phone_number'),
        displayName,
        givenName,
        familyName,
        dateOfBirth: getAttr(user, 'birthdate'),
        address: parsedAddress.address,
        city: parsedAddress.city,
        region: parsedAddress.region,
        postcode: parsedAddress.postcode,
        country: parsedAddress.country,
        enabled: user.Enabled !== false,
        userStatus: String(user.UserStatus || '').trim(),
        createdAt: user.UserCreateDate ? new Date(user.UserCreateDate).toISOString() : null,
        updatedAt: user.UserLastModifiedDate ? new Date(user.UserLastModifiedDate).toISOString() : null,
    };
}

function matchesDirectoryUserProofQuery(user: DirectoryUser, query: string): boolean {
    const lowered = String(query || '').trim().toLowerCase();
    if (!lowered) return false;

    return [user.userId, user.username, user.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === lowered);
}

export async function listDirectoryUsers(): Promise<DirectoryUser[]> {
    const client = getClient();
    const userPoolId = getPoolId();
    if (!client || !userPoolId) {
        return [];
    }

    const items: DirectoryUser[] = [];
    let paginationToken: string | undefined;

    do {
        const out = await client.send(new ListUsersCommand({
            UserPoolId: userPoolId,
            Limit: 60,
            PaginationToken: paginationToken,
        }));
        for (const user of out.Users || []) {
            const mapped = mapUser(user);
            if (mapped.userId) {
                items.push(mapped);
            }
        }
        paginationToken = out.PaginationToken;
    } while (paginationToken);

    return items;
}

/**
 * Permanently delete a Cognito user identified by their immutable `sub` (which
 * is the app/Firebase uid). AdminDeleteUser takes a Username, so we resolve it
 * via ListUsers(filter: sub="...") first. Returns true if deleted (or already
 * absent), false if Cognito isn't configured or the lookup/delete failed.
 * Used by the account-deletion worker (GDPR).
 */
export async function deleteCognitoUserBySub(sub: string): Promise<boolean> {
    const client = getClient();
    const userPoolId = getPoolId();
    const uid = String(sub || '').trim();
    if (!client || !userPoolId || !uid) {
        logger.warn('[cognito] deleteCognitoUserBySub skipped (not configured or empty sub)');
        return false;
    }
    try {
        const out = await client.send(new ListUsersCommand({
            UserPoolId: userPoolId,
            Filter: `sub = "${uid}"`,
            Limit: 1,
        }));
        const username = String(out.Users?.[0]?.Username || '').trim();
        if (!username) {
            // No matching identity — treat as already deleted.
            return true;
        }
        await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
        logger.info({ uid }, '[cognito] deleted user identity');
        return true;
    } catch (e: any) {
        logger.error({ err: e?.message || String(e), uid }, '[cognito] deleteCognitoUserBySub failed');
        return false;
    }
}

export async function getDirectoryUserProof(query: string): Promise<DirectoryUserProof> {
    const client = getClient();
    const userPoolId = getPoolId();
    const getClientSucceeded = Boolean(client && userPoolId);

    if (!getClientSucceeded) {
        return {
            getClientSucceeded: false,
            listUsersAttempted: false,
            listUsersThrew: false,
            directoryCount: 0,
            proofUserMatchedBeforeFiltering: false,
        };
    }

    try {
        const items = await listDirectoryUsers();
        return {
            getClientSucceeded: true,
            listUsersAttempted: true,
            listUsersThrew: false,
            directoryCount: items.length,
            proofUserMatchedBeforeFiltering: items.some((user) => matchesDirectoryUserProofQuery(user, query)),
        };
    } catch {
        return {
            getClientSucceeded: true,
            listUsersAttempted: true,
            listUsersThrew: true,
            directoryCount: 0,
            proofUserMatchedBeforeFiltering: false,
        };
    }
}

// Enable/disable a Cognito user. Disabling immediately prevents new sign-ins and
// token refresh, which is the strongest platform-wide enforcement of a ban.
// Cognito's AdminDisableUser needs the pool Username (not the `sub`), so we resolve
// it from the directory first.
export async function setDirectoryUserEnabled(inputUserId: string, enabled: boolean): Promise<{ ok: boolean; detail?: string }> {
    const client = getClient();
    const userPoolId = getPoolId();
    if (!client || !userPoolId) {
        return { ok: false, detail: 'cognito_not_configured' };
    }

    let username = String(inputUserId || '').trim();
    try {
        const user = await findDirectoryUser(inputUserId);
        if (user?.username) username = user.username;
    } catch {
        // Fall back to the provided id as username.
    }

    if (!username) return { ok: false, detail: 'no_username' };

    try {
        if (enabled) {
            await client.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: username }));
        } else {
            await client.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
        }
        return { ok: true };
    } catch (e: any) {
        logger.error({ err: e?.message || String(e), enabled }, '[admin] setDirectoryUserEnabled failed');
        return { ok: false, detail: e?.message || String(e) };
    }
}

export async function findDirectoryUser(inputUserId: string): Promise<DirectoryUser | null> {
    const query = String(inputUserId || '').trim();
    if (!query) return null;

    const users = await listDirectoryUsers();
    const lowered = query.toLowerCase();
    return users.find((user) => {
        return [user.userId, user.username, user.email]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase() === lowered);
    }) || null;
}
