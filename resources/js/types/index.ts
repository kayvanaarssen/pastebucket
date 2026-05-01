export interface User {
    id: number;
    name: string;
    email: string;
    role: 'user' | 'admin';
    is_admin: boolean;
}

export interface Paste {
    id?: number;
    slug: string;
    title: string | null;
    content: string;
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
