import {
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

let cachedClient: CognitoIdentityProviderClient | null = null;
let cachedRegion = '';
let cachedDirectoryUsers: DirectoryUser[] | null = null;
let cachedDirectoryUsersAt = 0;
let inFlightDirectoryUsers: Promise<DirectoryUser[]> | null = null;

const DIRECTORY_USERS_CACHE_TTL_MS = 60_000;

function poolRegionFromId(userPoolId: string): string {
    const value = String(userPoolId || '').trim();
    if (!value.includes('_')) return '';
    return value.split('_')[0].trim();
}

function getRegionCandidates(userPoolId: string): string[] {
    const candidates = [
        poolRegionFromId(userPoolId),
        String(ENV.COGNITO_REGION || '').trim(),
        String(ENV.AWS_REGION || '').trim(),
    ].filter(Boolean);
    return Array.from(new Set(candidates));
}

function getClient(): CognitoIdentityProviderClient | null {
    const userPoolId = String(ENV.COGNITO_USER_POOL_ID || '').trim();
    const region = getRegionCandidates(userPoolId)[0] || '';
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

export async function listDirectoryUsers(): Promise<DirectoryUser[]> {
    const now = Date.now();
    if (cachedDirectoryUsers && now - cachedDirectoryUsersAt < DIRECTORY_USERS_CACHE_TTL_MS) {
        return cachedDirectoryUsers;
    }
    if (inFlightDirectoryUsers) {
        return inFlightDirectoryUsers;
    }

    inFlightDirectoryUsers = (async () => {
        const userPoolId = getPoolId();
        if (!userPoolId) {
            logger.warn('[admin] Cognito directory disabled: COGNITO_USER_POOL_ID is missing');
            cachedDirectoryUsers = [];
            cachedDirectoryUsersAt = Date.now();
            return [];
        }

        const client = getClient();
        if (!client) {
            logger.error({ userPoolId }, '[admin] Cognito directory region/client resolution failed');
            cachedDirectoryUsers = [];
            cachedDirectoryUsersAt = Date.now();
            return [];
        }

        const regions = getRegionCandidates(userPoolId);
        let lastError: unknown = null;

        for (const region of regions) {
            try {
                if (!cachedClient || cachedRegion !== region) {
                    cachedRegion = region;
                    cachedClient = new CognitoIdentityProviderClient({ region });
                }

                const items: DirectoryUser[] = [];
                let paginationToken: string | undefined;

                do {
                    const out = await cachedClient.send(new ListUsersCommand({
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

                if (region !== String(ENV.COGNITO_REGION || '').trim()) {
                    logger.info({ region }, '[admin] Cognito directory region fallback applied');
                }
                cachedDirectoryUsers = items;
                cachedDirectoryUsersAt = Date.now();
                return items;
            } catch (error: any) {
                lastError = error;
                logger.warn({
                    region,
                    code: String(error?.name || ''),
                    message: String(error?.message || error),
                }, '[admin] Cognito list users failed for region candidate');
            }
        }

        logger.error({
            userPoolId,
            regions,
            code: String((lastError as any)?.name || ''),
            message: String((lastError as any)?.message || lastError),
        }, '[admin] Cognito directory unavailable after all region candidates failed');

        // Degrade gracefully: cache an empty list to avoid repeated retries/log spam
        // and allow callers to fall back to non-directory sources.
        cachedDirectoryUsers = [];
        cachedDirectoryUsersAt = Date.now();
        return [];
    })();

    try {
        return await inFlightDirectoryUsers;
    } finally {
        inFlightDirectoryUsers = null;
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
