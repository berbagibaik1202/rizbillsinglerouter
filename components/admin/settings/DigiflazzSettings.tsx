import React, { useState, useEffect, useCallback } from 'react';
import { ApiSettings } from '~/types';
import { fetchWithAuth } from '~/components/api';

interface Props {
    settings: NonNullable<ApiSettings['digiflazz']>;
    baseUrl?: string;
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
}

interface DigiflazzPingInfo {
    hookId: string;
    sed: string;
    hook: {
        url: string;
        type: string;
        status: number;
        secret?: string;
    };
    receivedAt: string;
}

const DigiflazzSettings: React.FC<Props> = ({ settings, baseUrl, handleInputChange }) => {
    const [showApiKey, setShowApiKey] = useState(false);
    const [pingInfo, setPingInfo] = useState<DigiflazzPingInfo | null>(null);
    const [pingLoading, setPingLoading] = useState(false);
    const [pingError, setPingError] = useState<string | null>(null);
    const [pingMessage, setPingMessage] = useState<string | null>(null);
    const callbackUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api/ppob/callback` : '';

    const loadPingInfo = useCallback(async () => {
        setPingLoading(true);
        setPingError(null);
        setPingMessage(null);
        try {
            const res = await fetchWithAuth('/api/admin/digiflazz/ping');
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Gagal memuat informasi ping.');
            }
            setPingInfo(data.ping || null);
        } catch (err: any) {
            setPingError(err.message || 'Gagal memuat ping.');
        } finally {
            setPingLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPingInfo();
    }, [loadPingInfo]);

    const handlePingRequest = useCallback(async () => {
        setPingLoading(true);
        setPingError(null);
        setPingMessage(null);
        try {
            const res = await fetchWithAuth('/api/admin/digiflazz/ping', {
                method: 'POST',
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Gagal memicu ping.');
            }
            setPingInfo(data.ping || null);
            setPingMessage(data.message || 'Ping Digiflazz berhasil diminta.');
        } catch (err: any) {
            setPingError(err.message || 'Gagal memicu ping.');
        } finally {
            setPingLoading(false);
        }
    }, []);

    return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow space-y-4">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Kredensial Digiflazz</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Simpan username dan API Key langsung di database agar tidak perlu .env.</p>
                </div>
            </div>

            <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Callback URL</p>
                <p className="text-xs text-gray-600 dark:text-gray-300">Daftarkan URL ini di dashboard Digiflazz agar status transaksi otomatis diperbarui.</p>
                <div className="mt-2 flex items-center gap-2">
                    <input
                        type="text"
                        value={callbackUrl || 'Setel Base URL di tab General > App Base URL'}
                        readOnly
                        className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                    {callbackUrl && (
                        <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(callbackUrl)}
                            className="px-3 py-1 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700"
                        >
                            Salin
                        </button>
                    )}
                </div>
            </div>

            <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Ping Webhook Terakhir</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Digiflazz akan mengirim ping setiap kali webhook diverifikasi atau diuji.</p>
                    </div>
                    <button
                        type="button"
                        onClick={handlePingRequest}
                        disabled={pingLoading}
                        className="px-3 py-1 bg-blue-500 text-white text-xs rounded-md hover:bg-blue-600 disabled:bg-gray-400"
                    >
                        {pingLoading ? 'Meminta ping...' : 'Ping sekarang'}
                    </button>
                </div>
                <div className="mt-2 text-xs text-gray-700 dark:text-gray-300 space-y-1">
                    {pingLoading && <p className="text-gray-500">Memuat data ping...</p>}
                    {pingError && <p className="text-red-500">{pingError}</p>}
                    {pingMessage && <p className="text-green-600">{pingMessage}</p>}
                    {!pingLoading && !pingError && !pingInfo && (
                        <p className="text-gray-500">Belum ada ping yang diterima sejak server berjalan.</p>
                    )}
                    {pingInfo && (
                        <div className="space-y-1">
                            <p><strong>Waktu Diterima:</strong> {new Date(pingInfo.receivedAt).toLocaleString('id-ID', { hour12: false })}</p>
                            <p><strong>Hook ID:</strong> {pingInfo.hookId}</p>
                            <p><strong>Sed:</strong> {pingInfo.sed}</p>
                            <p><strong>URL Terdaftar:</strong> <span className="font-mono">{pingInfo.hook.url}</span></p>
                            <p><strong>Tipe Konten:</strong> {pingInfo.hook.type}</p>
                            <p><strong>Status Hook:</strong> {pingInfo.hook.status === 1 ? 'Aktif' : 'Tidak aktif'}</p>
                            <p><strong>Secret Terpasang:</strong> {pingInfo.hook.secret ? 'Ya' : 'Tidak'}</p>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Username</span>
                    <input
                        type="text"
                        name="digiflazz.username"
                        value={settings.username || ''}
                        onChange={handleInputChange}
                        className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="misal: nuveyogvE05W"
                        autoComplete="off"
                    />
                </label>

                <label className="block">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">API Key</span>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <input
                            type={showApiKey ? 'text' : 'password'}
                            name="digiflazz.apiKey"
                            value={settings.apiKey || ''}
                            onChange={handleInputChange}
                            className="flex-1 rounded-l-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Masukkan API Key"
                            autoComplete="off"
                        />
                        <button
                            type="button"
                            onClick={() => setShowApiKey(v => !v)}
                            className="px-3 border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-md text-sm text-gray-600 dark:text-gray-200 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500"
                        >
                            {showApiKey ? 'Sembunyikan' : 'Tampilkan'}
                        </button>
                    </div>
                </label>
            </div>

            <div className="flex items-center space-x-2">
                <input
                    id="digiflazz.sandboxMode"
                    type="checkbox"
                    name="digiflazz.sandboxMode"
                    checked={!!settings.sandboxMode}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="digiflazz.sandboxMode" className="text-sm text-gray-700 dark:text-gray-300">
                    Gunakan mode sandbox (jika tersedia)
                </label>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400">
                <p>Pastikan kredensial sesuai akun Digiflazz Anda. Data disimpan terenkripsi pada DB settings.</p>
            </div>
        </div>
    );
};

export default DigiflazzSettings;
