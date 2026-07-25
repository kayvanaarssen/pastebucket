/**
 * Fetch wrapper for the app's JSON endpoints.
 *
 * Sends the CSRF token from the XSRF-TOKEN cookie, and the Accept and
 * X-Requested-With headers that make Laravel's expectsJson() true. Without
 * those, a failed FormRequest validation answers with a 302 redirect that
 * fetch follows to a 200, which makes failures indistinguishable from success.
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const xsrfToken = decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? '');

    return fetch(url, {
        ...init,
        headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            'X-XSRF-TOKEN': xsrfToken,
            ...init.headers,
        },
    });
}
