declare const chrome: {
    runtime: {
        sendMessage(message: unknown): Promise<{ ok: boolean; data: any; message?: string; status?: number }>;
    };
    permissions: { request(permissions: { origins: string[] }): Promise<boolean> };
};
