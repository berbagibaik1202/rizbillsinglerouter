import React, { useState } from 'react';

interface OltCardProps {
    name: string;
    model?: string;
    product?: string | null;
    host: string;
    port?: number;
    description?: string;
    connectionType?: 'ssh' | 'telnet' | 'snmp';
    status?: string;
    uptime?: string | null;
    location?: { lat: number; lng: number };
    onSelect?: () => void;
    onDelete?: () => void;
}

const statusColor = (s: string) => {
    const val = (s || '').toLowerCase();
    if (val.includes('up') || val.includes('online')) return 'bg-green-500';
    if (val.includes('down') || val.includes('offline')) return 'bg-red-500';
    return 'bg-yellow-500';
};

const OltCard: React.FC<OltCardProps> = ({
    name,
    model,
    product,
    host,
    port = 22,
    description,
    connectionType = 'ssh',
    status = 'unknown',
    uptime,
    location,
    onSelect,
    onDelete,
}) => {
    const [showHost, setShowHost] = useState(false);
    const maskHost = (h: string | undefined) => {
        if (!h) return 'N/A';
        const parts = h.split('.');
        if (parts.length === 4) {
            const last = parts[3] || '';
            return ['***', '***', '***', last].join('.');
        }
        if (h.length <= 4) return '••••';
        return '••••••' + h.slice(-4);
    };
    const maskedHost = showHost ? `${host || 'N/A'}:${port}` : `${maskHost(host)}:${port ? '****' : ''}`;
    return (
        <div className="border rounded-lg p-4 shadow-sm bg-gradient-to-br from-indigo-50 via-white to-cyan-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800 border-indigo-100 dark:border-slate-700">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{name}</h3>
                    {(model || product) && <p className="text-xs text-gray-600 dark:text-gray-400">{product || model}</p>}
                </div>
                <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-full text-white ${statusColor(status || '')}`}>
                        <span className="w-2 h-2 rounded-full bg-white/80"></span>
                        {status || 'unknown'}
                    </span>
                    {onDelete && (
                        <button onClick={onDelete} className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">Hapus</button>
                    )}
                    {onSelect && (
                        <button onClick={onSelect} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Kelola</button>
                    )}
                </div>
            </div>
            <div className="text-sm text-gray-800 dark:text-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono">{maskedHost}:{port}</span>
                <button
                    type="button"
                    onClick={() => setShowHost((v) => !v)}
                    className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    aria-label="Toggle host visibility"
                >
                    {showHost ? 'Hide' : 'Show'}
                </button>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">{connectionType.toUpperCase()}</span>
            </div>
            {uptime && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Uptime: {uptime}</p>}
            {location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                    <p>Lokasi: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}</p>
                    <a
                        href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        Lihat di Google Maps
                    </a>
                </div>
            )}
            {description && <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">{description}</p>}
        </div>
    );
};

export default OltCard;
