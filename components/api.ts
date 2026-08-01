import { AdminNotification } from '~/types';

// Global flag to prevent race conditions during logout.
let isLoggingOut = false;
const SESSION_KEY = 'rizkitechbill_session';

export const fetchWithAuth = async (url: RequestInfo, options?: RequestInit): Promise<Response> => {
    // If a logout has been triggered by another failed API call,
    // halt this request by returning a promise that never resolves.
    // This prevents further errors until the page reloads.
    if (isLoggingOut) {
        return new Promise(() => {});
    }
    
    let token: string | null = null;
    const sessionJSON = localStorage.getItem(SESSION_KEY);
    if (sessionJSON) {
        try {
            const sessionData = JSON.parse(sessionJSON);
            token = sessionData.token;
        } catch (e) {
            console.error("Corrupted session data in localStorage, clearing session.");
            localStorage.removeItem(SESSION_KEY);
        }
    }
    
    let finalHeaders: HeadersInit = {};

    // Clone existing headers if they exist
    if (options?.headers) {
        if (options.headers instanceof Headers) {
            options.headers.forEach((value, key) => {
                (finalHeaders as Record<string, string>)[key] = value;
            });
        } else if (Array.isArray(options.headers)) {
             options.headers.forEach(([key, value]) => {
                (finalHeaders as Record<string, string>)[key] = value;
            });
        } else {
            finalHeaders = { ...options.headers };
        }
    }

    if (token) {
        (finalHeaders as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    if (options?.body instanceof FormData) {
        // CRUCIAL: For FormData, DO NOT set the 'Content-Type' header.
        // The browser's fetch API must set it automatically to include the multipart boundary.
        // We explicitly delete it here to prevent any accidental settings.
        delete (finalHeaders as Record<string, string>)['Content-Type'];
        delete (finalHeaders as Record<string, string>)['content-type'];
    } else {
        // For other requests like JSON, ensure 'Content-Type' is set.
        if (options?.body && !(finalHeaders as Record<string, string>)['Content-Type'] && !(finalHeaders as Record<string, string>)['content-type']) {
            (finalHeaders as Record<string, string>)['Content-Type'] = 'application/json';
        }
    }

    const config = {
        ...options,
        headers: finalHeaders,
    };

    const response = await fetch(url, config);

    // If the response is not OK, try to parse the JSON error message from the backend.
    if (!response.ok) {
        // Handle unauthorized responses by logging the user out
        if (response.status === 401) {
            // Use the flag to ensure the logout logic runs only once.
            if (!isLoggingOut) {
                isLoggingOut = true; // Set the flag immediately
                localStorage.removeItem(SESSION_KEY);
                const urlString = url.toString();
                // Jika rute API adalah untuk admin, reseller, atau teknisi, arahkan ke login admin.
                if (urlString.includes('/api/admin') || urlString.includes('/api/technician') || urlString.includes('/api/reseller')) {
                    window.location.hash = 'admin';
                } else {
                    window.location.hash = 'login';
                }
                // Muat ulang halaman untuk membersihkan semua state dan memastikan pengalihan yang bersih.
                window.location.reload();
            }
        }

        let errorMessage = `Request failed with status ${response.status}`;
        try {
            // Check if there is a response body before trying to parse it
            const text = await response.text();
            if (text) {
                const errorData = JSON.parse(text);
                errorMessage = errorData.message || errorMessage;
            }
        } catch (e) {
            // Ignore JSON parsing errors, the default message will be used.
            console.error("Could not parse error response JSON", e);
        }
        throw new Error(errorMessage);
    }

    return response;
};

export const getNotifications = async (): Promise<AdminNotification[]> => {
    const response = await fetchWithAuth('/api/notifications');
    return response.json();
};

export const deleteNotification = async (id: number | string): Promise<void> => {
    await fetchWithAuth(`/api/notifications/${id}`, {
        method: 'DELETE',
    });
};

export const clearAllNotifications = async (): Promise<void> => {
    await fetchWithAuth('/api/notifications', {
        method: 'DELETE',
    });
};