import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '../../components/common/Card';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import PrintVouchers from '../../components/admin/PrintVouchers';
import { HotspotVoucher, HotspotProfile, VoucherStatus, ApiSettings, formatDuration, formatDateTimeDisplay, AdminUser, Customer } from '../../types';
import Tag from '../../components/common/Tag';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

// --- Icon Components ---
const PrintIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v3a2 2 0 002 2h6a2 2 0 002-2v-3h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" /></svg>;
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const RefreshIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566z" clipRule="evenodd" /></svg>;


// --- Components ---

const VoucherStatusTag: React.FC<{ status: VoucherStatus }> = ({ status }) => {
    const colorMap: { [key in VoucherStatus]: 'blue' | 'green' | 'gray' } = {
        [VoucherStatus.New]: 'blue',
        [VoucherStatus.Active]: 'green',
        [VoucherStatus.Expired]: 'gray',
    };
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return <Tag color={colorMap[status]}>{label}</Tag>;
};

interface GenerateVouchersModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (mode: 'bulk' | 'manual', data: any) => Promise<HotspotVoucher[] | HotspotVoucher | null>;
    profiles: HotspotProfile[];
    isGenerating: boolean;
    error: string | null;
}

const GenerateVouchersModal: React.FC<GenerateVouchersModalProps> = ({ isOpen, onClose, onSave, profiles, isGenerating, error }) => {
    const [creationMode, setCreationMode] = useState<'bulk' | 'manual'>('bulk');
    const [formData, setFormData] = useState({
        // Bulk fields
        count: 10,
        usernameLength: 6,
        prefix: '',
        // Manual fields
        manualUsername: '',
        manualPassword: '',
        // Common fields
        profile: profiles[0]?.name || '',
        durationValue: 1,
        durationUnit: 'hours',
    });
    const [saveAsDefault, setSaveAsDefault] = useState(false);
    
    useEffect(() => {
        if (isOpen) {
            let initialProfile = profiles[0]?.name || '';
            let initialDurationValue = 1;
            let initialDurationUnit = 'hours';

            try {
                const savedDefaultsRaw = localStorage.getItem('hotspotVoucherDefaults');
                if (savedDefaultsRaw) {
                    const savedDefaults = JSON.parse(savedDefaultsRaw);
                    // Check if the saved profile still exists
                    if (profiles.some(p => p.name === savedDefaults.profile)) {
                        initialProfile = savedDefaults.profile;
                        initialDurationValue = savedDefaults.durationValue;
                        initialDurationUnit = savedDefaults.durationUnit;
                    }
                }
            } catch (e) {
                console.error("Could not load voucher defaults from localStorage", e);
            }
             
            setFormData({
                count: 10, usernameLength: 6, prefix: '',
                manualUsername: '', manualPassword: '',
                profile: initialProfile,
                durationValue: initialDurationValue, 
                durationUnit: initialDurationUnit,
            });
            setCreationMode('bulk');
            setSaveAsDefault(false);
        }
    }, [isOpen, profiles]);


    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (saveAsDefault) {
            try {
                const defaultsToSave = {
                    profile: formData.profile,
                    durationValue: formData.durationValue,
                    durationUnit: formData.durationUnit,
                };
                localStorage.setItem('hotspotVoucherDefaults', JSON.stringify(defaultsToSave));
            } catch (err) {
                console.error("Failed to save voucher defaults to localStorage", err);
            }
        }

        const { durationValue, durationUnit, ...rest } = formData;
        let totalDurationInMinutes = parseInt(String(durationValue), 10);
        switch (durationUnit) {
            case 'hours': totalDurationInMinutes *= 60; break;
            case 'days': totalDurationInMinutes *= 60 * 24; break;
            case 'weeks': totalDurationInMinutes *= 60 * 24 * 7; break;
            case 'months': totalDurationInMinutes *= 60 * 24 * 30; break;
        }

        let dataToSend;
        if (creationMode === 'bulk') {
            dataToSend = {
                count: rest.count,
                profile: rest.profile,
                usernameLength: rest.usernameLength,
                prefix: rest.prefix,
                durationMinutes: totalDurationInMinutes,
            };
        } else { // manual
            dataToSend = {
                username: rest.manualUsername,
                password: rest.manualPassword,
                profile: rest.profile,
                durationMinutes: totalDurationInMinutes,
            };
        }
        
        onSave(creationMode, dataToSend);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'number' ? (value === '' ? '' : parseInt(value, 10)) : value }));
    };

    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500";
    
    const TabButton: React.FC<{ mode: 'bulk' | 'manual', label: string }> = ({ mode, label }) => (
        <button
            type="button"
            onClick={() => setCreationMode(mode)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 ${
                creationMode === mode
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
        >
            {label}
        </button>
    );

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-lg">
                    <h2 className="text-lg font-semibold mb-2 dark:text-gray-200">Generate Hotspot Vouchers</h2>
                    
                     <div className="border-b border-gray-200 dark:border-gray-700 mb-4">
                        <nav className="-mb-px flex space-x-4" aria-label="Tabs">
                            <TabButton mode="bulk" label="Bulk Generate" />
                            <TabButton mode="manual" label="Manual Create" />
                        </nav>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {creationMode === 'bulk' ? (
                            <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <input type="number" name="count" placeholder="Number of Vouchers" value={formData.count} onChange={handleInputChange} className={inputClasses} min="1" max="1000" required />
                                    <input type="number" name="usernameLength" placeholder="Username Length" value={formData.usernameLength} onChange={handleInputChange} className={inputClasses} min="3" max="16" required />
                                </div>
                                <input type="text" name="prefix" placeholder="Username Prefix (Optional)" value={formData.prefix} onChange={handleInputChange} className={inputClasses} />
                            </>
                        ) : (
                             <>
                                <input type="text" name="manualUsername" placeholder="Username" value={formData.manualUsername} onChange={handleInputChange} className={inputClasses} required />
                                <input type="text" name="manualPassword" placeholder="Password" value={formData.manualPassword} onChange={handleInputChange} className={inputClasses} required />
                            </>
                        )}
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t dark:border-gray-600">
                             <div>
                                <label htmlFor="profile" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Profile</label>
                                <select name="profile" id="profile" value={formData.profile} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} required>
                                    {profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                </select>
                            </div>
                             <div>
                                <label htmlFor="durationValue" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Duration</label>
                                <div className="mt-1 flex">
                                    <input type="number" name="durationValue" id="durationValue" value={formData.durationValue} onChange={handleInputChange} className={`rounded-l-md flex-grow ${inputClasses}`} min="1" required />
                                    <select name="durationUnit" id="durationUnit" value={formData.durationUnit} onChange={handleInputChange} className={`rounded-l-none ${inputClasses}`}>
                                        <option value="minutes">Minutes</option>
                                        <option value="hours">Hours</option>
                                        <option value="days">Days</option>
                                        <option value="weeks">Weeks</option>
                                        <option value="months">Months</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 p-3 rounded-md">{error}</p>}
                        
                        <div className="flex justify-between items-center pt-4">
                            <div className="flex items-center">
                                <input 
                                    id="save-default" 
                                    type="checkbox" 
                                    checked={saveAsDefault} 
                                    onChange={(e) => setSaveAsDefault(e.target.checked)} 
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" 
                                />
                                <label htmlFor="save-default" className="ml-2 block text-sm text-gray-600 dark:text-gray-300">Save as default</label>
                            </div>
                            <div className="flex space-x-2">
                                <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
                                <button type="submit" disabled={isGenerating} className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400 flex items-center">
                                {isGenerating && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                {isGenerating ? 'Creating...' : (creationMode === 'bulk' ? 'Generate' : 'Create')}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

// --- Voucher Detail Modal ---
interface VoucherDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  voucher: HotspotVoucher | null;
}

const VoucherDetailModal: React.FC<VoucherDetailModalProps> = ({ isOpen, onClose, voucher }) => {
    const [liveUptime, setLiveUptime] = useState<string | null>(null);
    const [isFetchingUptime, setIsFetchingUptime] = useState(false);

    useEffect(() => {
        if (isOpen && voucher) {
            setLiveUptime(null); // Reset on open
            setIsFetchingUptime(true);
            const fetchUptime = async () => {
                try {
                    const res = await fetchWithAuth(`${API_URL}/hotspot/vouchers/${voucher.username}/total-uptime`);
                    if (res.ok) {
                        const data = await res.json();
                        setLiveUptime(data.totalUptime);
                    }
                } catch (e) {
                    console.error("Failed to fetch live total uptime:", e);
                    setLiveUptime('Error');
                } finally {
                    setIsFetchingUptime(false);
                }
            };
            fetchUptime();
        }
    }, [isOpen, voucher]);

    if (!isOpen || !voucher) return null;

  return (
    <div className="fixed z-20 inset-0 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-md">
          <div className="flex justify-between items-start">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Voucher Details</h2>
            <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="mt-4 space-y-4">
            <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">Username</p>
              <p className="font-mono text-xl font-bold text-gray-900 dark:text-white tracking-wider">{voucher.username}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Password</p>
              <p className="font-mono text-xl font-bold text-gray-900 dark:text-white tracking-wider">{voucher.password}</p>
            </div>

            {/* Voucher Properties */}
            <div className="text-sm">
                <p className="font-bold text-gray-700 dark:text-gray-300 mb-2">Voucher Properties</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <dt className="font-semibold text-gray-600 dark:text-gray-400">Profile:</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{voucher.profile}</dd>
                    
                    <dt className="font-semibold text-gray-600 dark:text-gray-400">Status:</dt>
                    <dd><VoucherStatusTag status={voucher.status} /></dd>
                    
                    <dt className="font-semibold text-gray-600 dark:text-gray-400">Time Limit:</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{formatDuration(voucher.duration_minutes)}</dd>

                    <dt className="font-semibold text-gray-600 dark:text-gray-400">Created At:</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{formatDateTimeDisplay(voucher.created_at)}</dd>
                </dl>
            </div>

            {/* Usage Details */}
            <div className="text-sm border-t border-gray-200 dark:border-gray-700 pt-3">
                <p className="font-bold text-gray-700 dark:text-gray-300 mb-2">Usage Details</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <dt className="font-semibold text-gray-600 dark:text-gray-400">First Used:</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{formatDateTimeDisplay(voucher.first_used_at) === 'N/A' ? '-' : formatDateTimeDisplay(voucher.first_used_at)}</dd>
                    
                    <dt className="font-semibold text-gray-600 dark:text-gray-400">Expires At:</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{formatDateTimeDisplay(voucher.expires_at) === 'N/A' ? '-' : formatDateTimeDisplay(voucher.expires_at)}</dd>

                    <dt className="font-semibold text-gray-600 dark:text-gray-400">Total Uptime Used:</dt>
                    <dd className="text-gray-800 dark:text-gray-200">{isFetchingUptime ? 'Loading...' : (liveUptime || '0s')}</dd>

                </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


const HotspotVouchers: React.FC = () => {
    const [vouchers, setVouchers] = useState<HotspotVoucher[]>([]);
    const [profiles, setProfiles] = useState<HotspotProfile[]>([]);
    const [appSettings, setAppSettings] = useState<ApiSettings | null>(null);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);

    const [deletingVoucher, setDeletingVoucher] = useState<HotspotVoucher | null>(null);
    const [deletingMode, setDeletingMode] = useState<'single' | 'bulk' | null>(null);
    const [viewingVoucher, setViewingVoucher] = useState<HotspotVoucher | null>(null);
    
    const [vouchersToPrint, setVouchersToPrint] = useState<HotspotVoucher[]>([]);
    
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<VoucherStatus | 'all'>('all');
    
    const [selectedVouchers, setSelectedVouchers] = useState<Set<number>>(new Set());
    const selectedIds = useMemo(() => Array.from(selectedVouchers.values()), [selectedVouchers]);
    const selectedCount = selectedIds.length;

    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    const PrintRowIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v3a2 2 0 002 2h6a2 2 0 002-2v-3h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" /></svg>;
    const TrashRowIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;


    const syncLiveStatus = useCallback(async () => {
        setIsRefreshing(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/hotspot/vouchers/live-status`);
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to sync live status');
            }
            
            const allMergedVouchers: HotspotVoucher[] = await res.json();
            setVouchers(allMergedVouchers);
            setLastUpdated(new Date());
    
        } catch (e: any) {
            console.error("Failed to sync live status", e);
            setError(e.message || 'Failed to sync with router.');
        } finally {
            setIsRefreshing(false);
        }
    }, []);

    const fetchInitialData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [profilesRes, settingsRes, usersRes, customersRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/hotspot/profiles`),
                fetchWithAuth(`${API_URL}/admin/settings`),
                fetchWithAuth(`${API_URL}/admin/users`),
                fetchWithAuth(`${API_URL}/customers`),
            ]);
            if (!profilesRes.ok || !settingsRes.ok || !usersRes.ok || !customersRes.ok) throw new Error('Failed to fetch initial page data');
            
            setProfiles(await profilesRes.json());
            setAppSettings(await settingsRes.json());
            setUsers(await usersRes.json());
            setCustomers(await customersRes.json());

            await syncLiveStatus();

        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [syncLiveStatus]);

    useEffect(() => {
        fetchInitialData();
        const intervalId = setInterval(syncLiveStatus, 30000);
        return () => clearInterval(intervalId);
    }, [fetchInitialData, syncLiveStatus]);


    const usersMap = useMemo(() => {
        return users.reduce((acc, user) => {
            acc[user.id] = user.username;
            return acc;
        }, {} as Record<string, string>);
    }, [users]);
    
    const customersMap = useMemo(() => {
        return customers.reduce((acc, customer) => {
            acc[customer.id] = customer.name;
            return acc;
        }, {} as Record<string, string>);
    }, [customers]);

    const handleSaveVoucher = async (mode: 'bulk' | 'manual', data: any): Promise<HotspotVoucher[] | HotspotVoucher | null> => {
        setIsGenerating(true);
        setModalError(null);
        try {
            const url = mode === 'bulk' ? `${API_URL}/hotspot/vouchers/generate` : `${API_URL}/hotspot/vouchers/manual`;
            const res = await fetchWithAuth(url, {
                method: 'POST',
                body: JSON.stringify(data),
            });
            const responseData = await res.json();
            if (!res.ok) throw new Error(responseData.message || 'Failed to create voucher(s)');
            
            await fetchInitialData();
            setIsGenerateModalOpen(false);
            if (mode === 'bulk') {
                setVouchersToPrint(responseData);
            }
            return responseData;
        } catch (err: any) {
            setModalError(err.message);
            return null;
        } finally {
            setIsGenerating(false);
        }
    };
    
    const confirmDelete = async () => {
        setError(null);
        setIsDeleting(true);
        try {
            let res;
            if (deletingMode === 'bulk') {
                res = await fetchWithAuth(`${API_URL}/hotspot/vouchers/bulk-delete`, {
                    method: 'POST',
                    body: JSON.stringify({ ids: selectedIds }),
                });
            } else if (deletingVoucher) {
                res = await fetchWithAuth(`${API_URL}/hotspot/vouchers/${deletingVoucher.id}`, { method: 'DELETE' });
            } else {
                return;
            }

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to delete voucher(s)');
            }
            const updatedVouchers = await res.json();
            setVouchers(updatedVouchers);
            setSelectedVouchers(new Set()); 
            await syncLiveStatus(); // Refresh live data for the updated list
        } catch (err: any) {
            setError(err.message);
        } finally {
            setDeletingVoucher(null);
            setDeletingMode(null);
            setIsDeleting(false);
        }
    };
    
    const filteredVouchers = useMemo(() => {
        return vouchers
            .filter(v => filterStatus === 'all' || v.status === filterStatus)
            .filter(v =>
                v.username.toLowerCase().includes(searchQuery.toLowerCase())
            );
    }, [vouchers, filterStatus, searchQuery]);

    useEffect(() => {
        setCurrentPage(1);
    }, [filterStatus, searchQuery]);

    const totalPages = Math.ceil(filteredVouchers.length / ITEMS_PER_PAGE);
    const paginatedVouchers = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredVouchers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredVouchers, currentPage]);

    const areAllOnPageSelected = useMemo(() => {
        if (paginatedVouchers.length === 0) return false;
        return paginatedVouchers.every(v => selectedVouchers.has(v.id));
    }, [paginatedVouchers, selectedVouchers]);

    const handleSelectOne = (voucherId: number, isSelected: boolean) => {
        setSelectedVouchers(prev => {
            const next = new Set(prev);
            if (isSelected) next.add(voucherId);
            else next.delete(voucherId);
            return next;
        });
    };

    const handleSelectAllOnPage = (e: React.ChangeEvent<HTMLInputElement>) => {
        const isChecked = e.target.checked;
        const pageIds = paginatedVouchers.map(v => v.id);

        setSelectedVouchers(prev => {
            const next = new Set(prev);
            if (isChecked) {
                pageIds.forEach(id => next.add(id));
            } else {
                pageIds.forEach(id => next.delete(id));
            }
            return next;
        });
    };

    const handleDeleteSelected = () => {
        if (selectedCount > 0) {
            setDeletingMode('bulk');
        }
    };

    const handlePrintSelected = () => {
        const toPrint = vouchers.filter(v => selectedVouchers.has(v.id));
        setVouchersToPrint(toPrint);
    };

    const FilterButton: React.FC<{ status: typeof filterStatus, label: string }> = ({ status, label }) => (
        <button
            onClick={() => setFilterStatus(status)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filterStatus === status ? 'bg-blue-600 text-white shadow-sm' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border dark:border-gray-600'}`}
        >
            {label}
        </button>
    );

    const renderTableDate = (dateString?: string | null) => {
        const dateTime = formatDateTimeDisplay(dateString);
        if (dateTime === 'N/A' || dateTime === 'Invalid Date' || !dateTime) {
            return <span className="text-gray-400">-</span>;
        }
        const parts = dateTime.split(',');
        const datePart = parts[0];
        const timePart = parts.length > 1 ? parts[1].trim().replace('.', ':') : '';
    
        return (
            <>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{datePart}</div>
                {timePart && <div className="text-xs text-gray-500 dark:text-gray-400">{timePart}</div>}
            </>
        );
    };

    return (
        <div className="space-y-6">
            <GenerateVouchersModal 
                isOpen={isGenerateModalOpen}
                onClose={() => {setIsGenerateModalOpen(false); setModalError(null);}}
                onSave={handleSaveVoucher}
                profiles={profiles}
                isGenerating={isGenerating}
                error={modalError}
            />
             <VoucherDetailModal
                isOpen={!!viewingVoucher}
                onClose={() => setViewingVoucher(null)}
                voucher={viewingVoucher}
            />
            <PrintVouchers
                isOpen={vouchersToPrint.length > 0}
                onClose={() => {
                    setVouchersToPrint([]);
                    setSelectedVouchers(new Set());
                }}
                vouchers={vouchersToPrint}
                appName={appSettings?.app?.appName}
            />
            <DeleteConfirmationModal
                isOpen={deletingMode !== null}
                onClose={() => setDeletingMode(null)}
                onConfirm={confirmDelete}
                itemName={deletingMode === 'bulk' ? `${selectedCount} voucher(s)` : deletingVoucher?.username || ''}
                itemType="Voucher"
                isLoading={isDeleting}
            />

            <div className="flex justify-between items-center flex-wrap gap-4">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Hotspot Vouchers</h2>
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => syncLiveStatus()}
                        disabled={isRefreshing || isLoading}
                        className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 font-semibold shadow-sm transition-colors disabled:bg-gray-400 flex items-center"
                    >
                         {isRefreshing ? (
                            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        ) : (
                            <RefreshIcon />
                        )}
                        <span className="ml-2">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
                    </button>
                    <button onClick={() => setIsGenerateModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm transition-colors">Generate Vouchers</button>
                </div>
            </div>
            
            {error && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}

            <Card>
                <div className="border-b dark:border-gray-700 pb-4 mb-4">
                    <div className="w-full flex flex-col gap-4">
                        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                            <div className="flex flex-wrap gap-2">
                                <FilterButton status="all" label="All" />
                                <FilterButton status={VoucherStatus.New} label="New" />
                                <FilterButton status={VoucherStatus.Active} label="Active" />
                                <FilterButton status={VoucherStatus.Expired} label="Expired" />
                            </div>
                            <div className="flex items-center gap-4">
                                {lastUpdated && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        Last updated: {lastUpdated.toLocaleTimeString()}
                                    </span>
                                )}
                                <input
                                    type="text"
                                    placeholder="Search by username..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-4 pr-4 py-2 border dark:border-gray-600 rounded-md w-full sm:w-64 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                                />
                            </div>
                        </div>

                        {selectedCount > 0 && (
                            <div className="flex items-center justify-start gap-2">
                                <button
                                    onClick={handlePrintSelected}
                                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-500 rounded-md hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors"
                                >
                                    <PrintIcon />
                                    <span>Print ({selectedCount})</span>
                                </button>
                                <button
                                    onClick={handleDeleteSelected}
                                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 border border-red-500 rounded-md hover:bg-red-50 dark:hover:bg-gray-700 transition-colors"
                                >
                                    <TrashIcon />
                                    <span>Delete ({selectedCount})</span>
                                </button>
                                <button
                                    onClick={() => setSelectedVouchers(new Set())}
                                    className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full"
                                    aria-label="Clear selection"
                                >
                                    <CloseIcon />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="overflow-x-auto">
                    {isLoading ? (
                        <div className="text-center py-10 text-gray-500 dark:text-gray-400">Loading vouchers...</div>
                    ) : (
                        <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                                <tr>
                                    <th scope="col" className="p-4">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                            onChange={handleSelectAllOnPage}
                                            checked={areAllOnPageSelected}
                                        />
                                    </th>
                                    <th scope="col" className="px-6 py-3">Username</th>
                                    <th scope="col" className="px-6 py-3">Profile</th>
                                    <th scope="col" className="px-6 py-3">Generated By</th>
                                    <th scope="col" className="px-6 py-3">Status</th>
                                    <th scope="col" className="px-6 py-3">Session Uptime</th>
                                    <th scope="col" className="px-6 py-3">Duration</th>
                                    <th scope="col" className="px-6 py-3">First Used</th>
                                    <th scope="col" className="px-6 py-3">Expires At</th>
                                    <th scope="col" className="px-6 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedVouchers.length > 0 ? paginatedVouchers.map(voucher => (
                                    <tr key={voucher.id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600">
                                        <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                                checked={selectedVouchers.has(voucher.id)}
                                                onChange={(e) => handleSelectOne(voucher.id, e.target.checked)}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap font-mono font-medium text-gray-900 dark:text-white">
                                            <button onClick={() => setViewingVoucher(voucher)} className="text-blue-600 dark:text-blue-500 hover:underline">
                                                {voucher.username}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">{voucher.profile}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            {voucher.sold_by_customer_id ? (
                                                <span className="font-semibold text-teal-600 dark:text-teal-400">{customersMap[voucher.sold_by_customer_id] || voucher.sold_by_customer_id}</span>
                                            ) : voucher.sold_by_user_id ? (
                                                <span className="font-semibold text-purple-600 dark:text-purple-400">{usersMap[voucher.sold_by_user_id] || voucher.sold_by_user_id}</span>
                                            ) : (
                                                <span className="text-gray-500 dark:text-gray-400">Admin</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap"><VoucherStatusTag status={voucher.status} /></td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {voucher.active ? (
                                                <div>
                                                    <div className="flex items-center space-x-2">
                                                        <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse"></span>
                                                        <span className="text-sm font-medium text-green-600 dark:text-green-400">Online</span>
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 pl-[18px]">{voucher.uptime || '-'}</div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center space-x-2">
                                                    <span className="h-2.5 w-2.5 rounded-full bg-gray-400"></span>
                                                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Offline</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">{formatDuration(voucher.duration_minutes)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">{renderTableDate(voucher.first_used_at)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">{renderTableDate(voucher.expires_at)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex items-center justify-end space-x-1">
                                                <button onClick={() => setVouchersToPrint([voucher])} className="p-2 text-blue-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Print Voucher">
                                                    <PrintRowIcon />
                                                </button>
                                                <button onClick={() => { setDeletingVoucher(voucher); setDeletingMode('single'); }} className="p-2 text-red-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Delete Voucher">
                                                    <TrashRowIcon />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={10} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                            Tidak Ada Data Voucher di temukan.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
                 <div className="flex items-center justify-between p-4 border-t dark:border-gray-700">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredVouchers.length)}
                        {' to '}
                        {Math.min(currentPage * ITEMS_PER_PAGE, filteredVouchers.length)}
                        {' of '}
                        {filteredVouchers.length} results
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            Previous
                        </button>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Page {currentPage} of {totalPages > 0 ? totalPages : 1}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages || totalPages === 0}
                            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default HotspotVouchers;