import React, { useState, useEffect, useMemo, useRef } from 'react';
import Card from '~/components/common/Card';
import { PppoeActiveUser, ApiSettings } from '~/types';
import { fetchWithAuth } from '~/components/api';

const Remote: React.FC = () => {
    const [activeUsers, setActiveUsers] = useState<PppoeActiveUser[]>([]);
    const [customersMap, setCustomersMap] = useState<Record<string, string>>({});
    const [settings, setSettings] = useState<ApiSettings | null>(null);
    const [remoteUrl, setRemoteUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdatingNat, setIsUpdatingNat] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [natStatus, setNatStatus] = useState<{ type: 'info' | 'success' | 'error', message: string } | null>(null);

    // State untuk fungsionalitas pencarian
    const [searchQuery, setSearchQuery] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [activeUsersRes, settingsRes, customersRes] = await Promise.all([
                    fetchWithAuth('/api/pppoe/active'),
                    fetchWithAuth('/api/admin/settings'),
                    fetchWithAuth('/api/customers'),
                ]);

                if (!activeUsersRes.ok || !settingsRes.ok || !customersRes.ok) {
                    throw new Error('Failed to load required data.');
                }
                
                const users = await activeUsersRes.json();
                const customers = await customersRes.json();
                
                const customerPppoeMap: Record<string, string> = {};
                customers.forEach((c: any) => {
                    if(c.pppoeUsername) {
                       customerPppoeMap[c.pppoeUsername] = c.name;
                    }
                });

                setCustomersMap(customerPppoeMap);
                setActiveUsers(users);
                setSettings(await settingsRes.json());
                
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);
    
    // Efek untuk menutup dropdown saat mengklik di luar
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredUsers = useMemo(() => {
        const lowercasedQuery = searchQuery.toLowerCase();
        if (!lowercasedQuery) return activeUsers;

        return activeUsers.filter(user =>
            (customersMap[user.name] || '').toLowerCase().includes(lowercasedQuery) ||
            user.name.toLowerCase().includes(lowercasedQuery) ||
            user.address.toLowerCase().includes(lowercasedQuery)
        );
    }, [activeUsers, searchQuery, customersMap]);

    const handleUserSelect = async (user: PppoeActiveUser | null) => {
        const ip = user ? user.address : '';
        const name = user ? `${customersMap[user.name] || user.name} (${user.address})` : '';

        setSearchQuery(name); // Menampilkan nama di input
        setIsDropdownOpen(false);
        setNatStatus(null);
        setRemoteUrl(''); // Hapus URL lama

        if (!ip) return;

        if (settings?.mikrotik.enableDynamicNat) {
            setIsUpdatingNat(true);
            setNatStatus({ type: 'info', message: `Updating NAT rule to target ${ip}...` });
            try {
                const res = await fetchWithAuth('/api/network/update-remote-nat-target', {
                    method: 'POST',
                    body: JSON.stringify({ targetIp: ip }),
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.message || 'Failed to update NAT rule.');
                }
                setNatStatus({ type: 'success', message: `NAT rule successfully updated for ${ip}.` });
            } catch (err: any) {
                setNatStatus({ type: 'error', message: err.message });
                setIsUpdatingNat(false);
                return;
            } finally {
                setIsUpdatingNat(false);
            }
        }

        if (settings?.mikrotik.remoteAccessUrl) {
            let url = settings.mikrotik.remoteAccessUrl;
            if (!/^https?:\/\//i.test(url)) {
                url = 'http://' + url;
            }
            setRemoteUrl(url);
        }
    };

    const isDynamicNatEnabled = settings?.mikrotik.enableDynamicNat;

    return (
        <div className="space-y-6 h-full flex flex-col">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Remote ONT Access</h2>
            
            {error && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}

            <Card className="flex-shrink-0">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <label htmlFor="user-select" className="font-semibold text-gray-700 dark:text-gray-300">Select Online Customer:</label>
                    <div ref={dropdownRef} className="relative w-full sm:w-80">
                        <input
                            id="user-select"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setIsDropdownOpen(true);
                            }}
                            onFocus={() => setIsDropdownOpen(true)}
                            placeholder={isLoading ? 'Loading active users...' : '-- Search for a user --'}
                            className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                            disabled={isLoading || isUpdatingNat}
                        />
                         {isDropdownOpen && (
                            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                <ul>
                                    {filteredUsers.length > 0 ? (
                                        filteredUsers.map(user => (
                                            <li key={user.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleUserSelect(user)}
                                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                                                >
                                                    {customersMap[user.name] || user.name} ({user.address})
                                                </button>
                                            </li>
                                        ))
                                    ) : (
                                        <li className="px-4 py-2 text-sm text-gray-500">No users found.</li>
                                    )}
                                </ul>
                            </div>
                        )}
                    </div>
                     <a
                        href={remoteUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`px-4 py-2 bg-green-600 text-white rounded-md text-sm font-semibold shadow-sm ${!remoteUrl ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-700'}`}
                        aria-disabled={!remoteUrl}
                        onClick={(e) => !remoteUrl && e.preventDefault()}
                    >
                        Open in New Tab
                    </a>
                </div>
                {natStatus && (
                     <div className={`mt-3 text-sm p-2 rounded-md ${natStatus.type === 'success' ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : natStatus.type === 'error' ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'}`}>
                        {natStatus.message}
                    </div>
                )}
                {!settings?.mikrotik.remoteAccessUrl && !isLoading && (
                    <p className="mt-3 text-sm text-yellow-700 dark:text-yellow-300">
                        Warning: Remote Access URL is not configured in Settings &gt; MikroTik.
                    </p>
                )}
            </Card>

            <Card className="flex-grow flex flex-col">
                <div className="flex-grow rounded-md overflow-hidden bg-gray-200 dark:bg-gray-900 border dark:border-gray-700">
                    {remoteUrl ? (
                         <iframe
                            key={remoteUrl} // Re-mount iframe when URL changes
                            src={remoteUrl}
                            title="Remote ONT Interface"
                            className="w-full h-full border-0"
                            sandbox="allow-forms allow-scripts allow-same-origin"
                        />
                    ) : (
                         <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
                            <p>Please select an online customer to view their device interface.</p>
                        </div>
                    )}
                </div>
                 <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Note: If the screen remains blank, the device might be offline or its security settings may prevent it from being displayed here. Use "Open in New Tab" as an alternative. {isDynamicNatEnabled && "The NAT rule has been updated."}
                </p>
            </Card>
        </div>
    );
};

export default Remote;