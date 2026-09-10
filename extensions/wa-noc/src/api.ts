export async function request<T = any>(op: string, id?: string, body?: unknown): Promise<T> {
    const result = await chrome.runtime.sendMessage({ op, id, body });
    if (!result.ok) throw Object.assign(new Error(result.message || 'Permintaan gagal'), { status: result.status });
    return result.data as T;
}

export type Customer = { id: string; name: string; phone: string; status: string; pppoeUsername: string; acsSerialNumber: string; packageName: string; packageSpeed: number };
export type Operator = { username: string; permissions: string[] };
