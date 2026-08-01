import React, { useState, useEffect, useMemo } from 'react';
import { Customer, AcsDeviceDetails } from '~/types';
import { fetchWithAuth } from '~/components/api';
import { RxPowerDisplay } from '~/screens/customer/shared/RxPowerDisplay';

interface TechnicianDeviceModalProps {
    isOpen: boolean;
    onClose: () => void;
    customer: Customer | null;
}

const TechnicianDeviceModal: React.FC<TechnicianDeviceModalProps> = ({ isOpen, onClose, customer }) => {
    const [details, setDetails] = useState<AcsDeviceDetails | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    
    // State for per-item editing
    const [editingConfigPath, setEditingConfigPath] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [editFormData, setEditFormData] = useState({ ssid: '', key: '' });


    // Filter entry "aneh" (_object/_timestamp/_writable) yang berasal dari meta TR-069
    const validConfigs = useMemo(() => {
        if (!details?.wlanConfigs) return [];
        return details.wlanConfigs.filter(c => {
            const ssidStr = typeof c.ssid === 'string' ? c.ssid.toLowerCase() : '';
            const keyStr = typeof c.key === 'string' ? c.key.toLowerCase() : '';
            const isMeta = ssidStr.includes('_object') || ssidStr.includes('_timestamp') || ssidStr.includes('_writable') || keyStr.includes('_object');
            const hasStringFields = typeof c.ssid === 'string' || typeof c.key === 'string';
            return !isMeta && hasStringFields && c.ssidPath; // Ensure ssidPath exists for editing
        });
    }, [details]);

    // Pilih SSID 2.4/5 jika band tersedia; fallback ke dua entri pertama
    const wlanConfigs = useMemo(() => {
        if (!validConfigs || validConfigs.length === 0) return [];
        const banded = validConfigs.filter(c => c.band === '2.4' || c.band === '5');
        if (banded.length > 0) return banded.sort((a,b) => (a.band || '').localeCompare(b.band || ''));
        return validConfigs.slice(0, 2);
    }, [validConfigs]);

    useEffect(() => {
        if (isOpen && customer) {
            const fetchDetails = async () => {
                setIsLoading(true);
                setError(null);
                setEditingConfigPath(null);
                setToast(null);
                try {
                    const res = await fetchWithAuth(`/api/technician/customers/${customer.id}/device-details`);
                    const data: AcsDeviceDetails = await res.json();
                    setDetails(data);
                } catch (err: any) {
                    setError(err.message);
                } finally {
                    setIsLoading(false);
                }
            };
            fetchDetails();
        }
    }, [isOpen, customer]);

    const handleEdit = (config: any) => {
        setEditingConfigPath(config.ssidPath);
        setEditFormData({ ssid: config.ssid || '', key: config.key || ''});
        setError(null);
        setToast(null);
    }

    const handleCancel = () => {
        setEditingConfigPath(null);
        setError(null);
    }
    
    const handleSave = async () => {
        const configToUpdate = wlanConfigs.find(c => c.ssidPath === editingConfigPath);

        if (!customer?.id || !configToUpdate) {
            setError('Could not find the configuration to update.');
            return;
        }
        const newSsid = editFormData.ssid.trim();
        const newKey = editFormData.key.trim();
        const payload: { ssid?: string; key?: string } = {};

        if (newSsid && newSsid !== configToUpdate.ssid) {
            payload.ssid = newSsid;
        }
        if (newKey && newKey !== configToUpdate.key) {
            if (newKey.length < 8) {
                setError('Password Wi-Fi minimal harus 8 karakter.');
                return;
            }
            payload.key = newKey;
        }
        
        if (!payload.ssid && !payload.key) {
            setEditingConfigPath(null); // Nothing changed, just exit editing mode
            return;
        }

        setIsSaving(true);
        setError(null);
        setToast(null);
        try {
            const res = await fetchWithAuth(`/api/technician/customers/${customer.id}/update-wlan`, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to update WLAN settings.');
            }

            // Optimistic update local state
            setDetails(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    wlanConfigs: prev.wlanConfigs.map(c => {
                        if (payload.ssid || payload.key) {
                            return { 
                                ...c, 
                                ssid: payload.ssid || c.ssid, 
                                key: payload.key || c.key 
                            };
                        }
                        return c;
                    })
                };
            });

            setEditingConfigPath(null);
            setToast({ type: 'success', message: `Wi-Fi "${newSsid || configToUpdate.ssid}" berhasil diperbarui.` });
        } catch (err: any) {
            setError(err.message);
            setToast({ type: 'error', message: err.message || 'Gagal memperbarui Wi-Fi.' });
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen || !customer) return null;

    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white";

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-lg">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Manage Device</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{customer.name}</p>
                        </div>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    
                    <div className="mt-4 space-y-4">
                        {isLoading && <p>Loading device details...</p>}
                        {toast && (
                            <div className={`p-3 rounded-md text-sm ${toast.type === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
                                {toast.message}
                            </div>
                        )}
                        {error && <div className="p-3 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-md text-sm">{error}</div>}

                        {details && (
                            <>
                                <div className="grid grid-cols-3 gap-4 text-sm p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                                    <div>
                                        <p className="font-medium text-gray-500 dark:text-gray-400">Status</p>
                                        <div className="flex items-center space-x-2">
                                            <span className={`h-2.5 w-2.5 rounded-full ${details.isOnline ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                            <span className={`font-semibold ${details.isOnline ? 'text-green-600' : 'text-red-600'}`}>{details.isOnline ? 'Online' : 'Offline'}</span>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-500 dark:text-gray-400">Model</p>
                                        <p className="font-semibold text-gray-800 dark:text-gray-200">{details.model}</p>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-500 dark:text-gray-400">RX Power</p>
                                        <RxPowerDisplay rxPower={details.rxPower} />
                                    </div>
                                </div>

                                <div className="space-y-4 pt-4 border-t dark:border-gray-700">
                                    <p className="text-base font-semibold text-gray-800 dark:text-gray-200">Konfigurasi Wi-Fi</p>
                                    {wlanConfigs.length > 0 ? (
                                        wlanConfigs.map((config) => {
                                            const isCurrentlyEditing = editingConfigPath === config.ssidPath;
                                            
                                            if (isCurrentlyEditing) {
                                                return (
                                                    <div key={config.ssidPath} className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                                        <p className="font-semibold text-blue-800 dark:text-blue-300 mb-2">
                                                          Editing {config.band === '2.4' ? 'Wi-Fi 2.4GHz' : config.band === '5' ? 'Wi-Fi 5GHz' : 'Wi-Fi'}
                                                        </p>
                                                        <div className="space-y-3">
                                                              <div>
                                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Wi-Fi Name (SSID)</label>
                                                                <input type="text" value={editFormData.ssid} onChange={(e) => setEditFormData(p => ({...p, ssid: e.target.value}))} className={`mt-1 ${inputClasses}`} />
                                                            </div>
                                                            <div>
                                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Wi-Fi Password</label>
                                                                <input type="text" value={editFormData.key} onChange={(e) => setEditFormData(p => ({...p, key: e.target.value}))} className={`mt-1 ${inputClasses}`} />
                                                                <p className="text-xs text-gray-500 mt-1">Min 8 karakter. Biarkan kosong jika tidak ingin ganti.</p>
                                                            </div>
                                                            <div className="flex justify-end space-x-2 pt-2">
                                                                <button onClick={handleCancel} type="button" className="px-3 py-1 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Cancel</button>
                                                                <button onClick={handleSave} disabled={isSaving} type="button" className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-blue-400">
                                                                    {isSaving ? 'Saving...' : 'Save'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            const safeSsid = typeof config.ssid === 'string' ? config.ssid : '';
                                            const safeKey = typeof config.key === 'string' ? config.key : '';
                                            return (
                                                <div key={config.ssidPath} className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg flex justify-between items-start">
                                                    <div>
                                                        <p className="font-semibold text-gray-600 dark:text-gray-300">
                                                            {config.band === '2.4' ? 'Wi-Fi 2.4GHz' : config.band === '5' ? 'Wi-Fi 5GHz' : 'Wi-Fi'}
                                                        </p>
                                                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-1">
                                                            <dt className="font-medium text-gray-500 dark:text-gray-400">SSID</dt>
                                                            <dd className="font-semibold text-gray-800 dark:text-gray-200">{safeSsid || '-'}</dd>
                                                            <dt className="font-medium text-gray-500 dark:text-gray-400">Password</dt>
                                                            <dd className="font-mono text-gray-800 dark:text-gray-200">{safeKey ? '********' : 'Not Set'}</dd>
                                                        </dl>
                                                    </div>
                                                     <button onClick={() => handleEdit(config)} className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L16.732 3.732z" /></svg>
                                                    </button>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <p className="text-sm text-gray-500">No WLAN configuration found.</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TechnicianDeviceModal;
