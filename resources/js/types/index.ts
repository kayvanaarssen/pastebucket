export interface User {
    id: number;
    name: string;
    email: string;
    role: 'user' | 'admin';
    is_admin: boolean;
}

/**
 * Non-secret encryption parameters travelling with an encrypted paste. Mirrors
 * EncryptionMeta in lib/crypto.ts and the `encryption_meta` JSON column.
 */
export interface EncryptionMeta {
    mode: 'fragment' | 'password';
    iv: string;
    salt?: string;
    iterations?: number;
    wrapped_key?: string;
    wrap_iv?: string;
}

export interface Paste {
    id?: number;
    slug: string;
    /** Short-link URL without a fragment; null until the owner mints one. */
    short_url: string | null;
    title: string | null;
    /** Ciphertext when is_encrypted, plaintext for legacy pastes. */
    content: string;
    /** Null for legacy pastes created before end-to-end encryption. */
    encryption_version: number | null;
    encryption_meta: EncryptionMeta | null;
    is_encrypted: boolean;
    language: string | null;
    visibility: 'public' | 'unlisted' | 'private';
    burn_after_read: boolean;
    views: number;
    expires_at: string | null;
    created_at: string;
    is_owner: boolean;
    author: string | null;
    is_password_protected: boolean;
}

export interface PaginatedData<T> {
    data: T[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
    links: {
        url: string | null;
        label: string;
        active: boolean;
    }[];
}

export interface PageProps {
    // Inertia's own PageProps is `{ [key: string]: unknown }`, and usePage<T>()
    // constrains T to it, so this index signature is required for the generic
    // to accept these props.
    [key: string]: unknown;
    auth: {
        user: User | null;
    };
    registration_enabled: boolean;
    footer: {
        copyright: string;
        url: string;
    };
    flash: {
        success: string | null;
        error: string | null;
        just_created: boolean;
    };
}

export interface ExpiryOption {
    label: string;
    value: number;
}
