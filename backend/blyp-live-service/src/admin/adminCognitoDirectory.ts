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

function getClient(): CognitoIdentityProviderClient | null {
    const region = String(ENV.COGNITO_REGION || '').trim();
    const userPoolId = String(ENV.COGNITO_USER_POOL_ID || '').trim();
    
    logger.debug(
        { region, userPoolId, hasRegion: !!region, hasPoolId: !!userPoolId },
        '[adminCognitoDirectory] getClient() resolved env'
    );
    
    if (!region || !userPoolId) {
        logger.warn(
            { region, userPoolId },
            '[adminCognitoDirectory] getClient() MISSING_ENV: cannot create Cognito client'
        );
        return null;
    }
    if (!cachedClient || cachedRegion !== region) {
        cachedRegion = region;
        cachedClient = new CognitoIdentityProviderClient({ region });
        logger.info(
            { region },
            '[adminCognitoDirectory] getClient() created new CognitoIdentityProviderClient'
        );
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
        userId: sub,
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
    const client = getClient();
    const userPoolId = getPoolId();
    
    if (!client || !userPoolId) {
        logger.warn(
            { hasClient: !!client, hasPoolId: !!userPoolId },
            '[adminCognitoDirectory] listDirectoryUsers() NO_CLIENT: returning empty'
        );
        return [];
    }

    logger.info(
        { userPoolId },
        '[adminCognitoDirectory] listDirectoryUsers() calling ListUsersCommand'
    );

    const items: DirectoryUser[] = [];
    let paginationToken: string | undefined;

    try {
        do {
            const out = await client.send(new ListUsersCommand({
                UserPoolId: userPoolId,
                Limit: 60,
                PaginationToken: paginationToken,
            }));
            
            const userCount = (out.Users || []).length;
            logger.debug(
                { userCount, paginationToken },
                '[adminCognitoDirectory] ListUsersCommand returned users'
            );
            
            for (const user of out.Users || []) {
                const mapped = mapUser(user);
                if (mapped.userId) {
                    items.push(mapped);
                }
            }
            paginationToken = out.PaginationToken;
        } while (paginationToken);

        logger.info(
            { totalItems: items.length },
            '[adminCognitoDirectory] listDirectoryUsers() completed'
        );
    } catch (err: any) {
        logger.error(
            { error: err?.message || String(err), code: err?.Code },
            '[adminCognitoDirectory] listDirectoryUsers() COGNITO_CALL_FAILED'
        );
    }

    return items;
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
