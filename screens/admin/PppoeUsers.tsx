import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Card from '../../components/common/Card';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { PppoeUser, PppoeProfile, Customer, PppoeSyncJob } from '../../types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

const normalizePppoeUsers = (payload: unknown): PppoeUser[] => {
    if (!Array.isArray(payload)) return [];
    return payload.map((user: any) => ({
        id: String(user?.id || ''),
        name: String(user?.name || ''),
        password: user?.password ? String(user.password) : undefined,
        service: String(user?.service || 'pppoe'),
        profile: String(user?.profile || ''),
        comment: String(user?.comment || ''),
        disabled: Boolean(user?.disabled),
        active: Boolean(user?.active),
    }));
};

// --- Icon Components for Bulk Actions ---
const EnableIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;
const DisableIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a9 9 0 100 18 9 9 0 000-18zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>;
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;


// --- User Form Modal ---
interface UserFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: { id?: string; name: string; password?: string; profile: string; comment: string }) => Promise<void>;
    user: PppoeUser | null;
    profiles: PppoeProfile[];
    isSaving: boolean;
}

const UserFormModal: React.FC<UserFormModalProps> = ({ isOpen, onClose, onSave, user, profiles, isSaving }) => {
    const getInitialState = useCallback(() => ({
        name: '',
        password: '',
        profile: profiles[0]?.name || '',
        comment: '',
    }), [profiles]);

    const [formData, setFormData] = useState(getInitialState());

    useEffect(() => {
        if (isOpen) {
            if (user) {
                setFormData({
                    name: user.name,
                    password: '', // Always clear password for editing for security
                    profile: user.profile,
                    comment: user.comment,
                });
            } else {
                setFormData(getInitialState());
            }
        }
    }, [user, isOpen, getInitialState]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ ...formData, id: user?.id });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500";

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-lg">
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{user ? 'Edit PPPoE User' : 'Add New PPPoE User'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username</label>
                            <input type="text" name="name" id="name" value={formData.name} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} required disabled={!!user} />
                        </div>
                        <div>
                            <label htmlFor="password" aria-label="Password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                            <input type="password" name="password" id="password" value={formData.password} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} placeholder={user ? 'Leave blank to keep unchanged' : 'Required'} required={!user} />
                        </div>
                        <div>
                            <label htmlFor="profile" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Profile</label>
                            <select name="profile" id="profile" value={formData.profile} onChange={handleInputChange} className={`mt-1 ${inputClasses}`}>
                                {profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                            </select>
                        </div>
                         <div>
                            <label htmlFor="comment" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Comment (Customer ID)</label>
                            <input type="text" name="comment" id="comment" value={formData.comment} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} placeholder="Optional: Link to customer" />
                        </div>
                        <div className="flex justify-end space-x-2 pt-4">
                            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
                            <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400">
                                {isSaving ? 'Saving...' : 'Save User'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};


// --- Main Component ---
const PppoeUsers: React.FC = () => {
    const [users, setUsers] = useState<PppoeUser[]>([]);
    const [profiles, setProfiles] = useState<PppoeProfile[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editingUser, setEditingUser] = useState<PppoeUser | null>(null);
    const [deletingUser, setDeletingUser] = useState<PppoeUser | null>(null);
    const [actionInProgress, setActionInProgress] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [deletingMode, setDeletingMode] = useState<'single' | 'bulk' | null>(null);
    const [bulkActionInProgress, setBulkActionInProgress] = useState<string | null>(null);
    const [isRouterOnline, setIsRouterOnline] = useState(true);
    const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
    const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
    const [syncJob, setSyncJob] = useState<PppoeSyncJob | null>(null);
    const [syncNotice, setSyncNotice] = useState<string | null>(null);
    const hasReloadedAfterSyncRef = useRef(false);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;
    const isSyncJobActive = !!syncJob && syncJob.status !== 'completed' && syncJob.status !== 'failed';
    const syncProgress = syncJob
        ? syncJob.status === 'completed'
            ? 100
            : syncJob.status === 'failed'
                ? Math.max(0, Math.min(100, syncJob.progress_percent || 0))
                : Math.max(0, Math.min(99, syncJob.progress_percent || 0))
        : 0;
    const syncButtonLabel = isSyncing
        ? 'Starting...'
        : syncJob
            ? syncJob.status === 'queued'
                ? 'Sync Queued...'
                : syncJob.status === 'running'
                    ? 'Syncing...'
                    : 'Sync with Router'
            : 'Sync with Router';


    const fetchInitialData = useCallback(async () => {
        setError(null);
        setIsLoading(true);
        try {
            const results = await Promise.allSettled([
                fetchWithAuth(`${API_URL}/pppoe/users`),
                fetchWithAuth(`${API_URL}/pppoe/profiles`),
                fetchWithAuth(`${API_URL}/customers`),
                fetchWithAuth(`${API_URL}/pppoe/active`),
            ]);

            const [usersResult, profilesResult, customersResult, activeResult] = results;

            if (usersResult.status === 'fulfilled') {
                setUsers(normalizePppoeUsers(await usersResult.value.json()));
            }
            if (profilesResult.status === 'fulfilled') {
                setProfiles(await profilesResult.value.json());
            }
            if (customersResult.status === 'fulfilled') {
                setCustomers(await customersResult.value.json());
            }

            let activeConnections: { name?: string }[] = [];
            if (activeResult.status === 'fulfilled') {
                activeConnections = await activeResult.value.json();
                setIsRouterOnline(true);
            } else {
                setIsRouterOnline(false);
            }

            const activeUsernames = new Set(activeConnections.map(c => c.name).filter(Boolean));
            setUsers(prev => prev.map(user => ({
                ...user,
                active: activeUsernames.has(user.name),
            })));

            const requiredFailures = [usersResult, profilesResult, customersResult]
                .filter(result => result.status === 'rejected') as PromiseRejectedResult[];
            if (requiredFailures.length > 0) {
                throw requiredFailures[0].reason;
            }
        } catch (err: any) {
            console.error("Failed to fetch data:", err);
            setError("A network error occurred while fetching data.");
            setIsRouterOnline(false); // Assume router is offline on any fetch failure
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    const fetchSyncJobById = useCallback(async (jobId: string) => {
        const res = await fetchWithAuth(`${API_URL}/pppoe/sync/jobs/${encodeURIComponent(jobId)}`);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || 'Failed to fetch PPPoE sync job status.');
        }

        const data = await res.json();
        return (data.job || null) as PppoeSyncJob | null;
    }, []);

    const refreshSyncJob = useCallback(async (jobId: string) => {
        const job = await fetchSyncJobById(jobId);
        if (!job) {
            setSyncJob(null);
            setSyncNotice(null);
            setIsSyncing(false);
            return null;
        }

        setSyncJob(job);
        setSyncNotice(job.message || null);

        if (job.status === 'completed') {
            setIsSyncing(false);
        } else if (job.status === 'failed') {
            setIsSyncing(false);
            setError(job.error_message || job.message || 'PPPoE sync job failed.');
        }

        return job;
    }, [fetchSyncJobById]);

    useEffect(() => {
        let mounted = true;

        const loadActiveSyncJob = async () => {
            try {
                const res = await fetchWithAuth(`${API_URL}/pppoe/sync/jobs/active`);
                if (!res.ok) return;

                const data = await res.json();
                if (!mounted) return;

                if (data?.job) {
                    setSyncJob(data.job as PppoeSyncJob);
                    setSyncNotice(data.job.message || null);
                    if (data.job.status === 'completed' || data.job.status === 'failed') {
                        setIsSyncing(false);
                    }
                }
            } catch (err) {
                console.warn('Failed to load active PPPoE sync job:', err);
            }
        };

        loadActiveSyncJob();

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!syncJob || syncJob.status === 'completed' || syncJob.status === 'failed') {
            return;
        }

        const intervalId = window.setInterval(() => {
            refreshSyncJob(syncJob.id).catch((err) => {
                console.warn('Failed to refresh PPPoE sync job status:', err);
            });
        }, 5000);

        return () => window.clearInterval(intervalId);
    }, [refreshSyncJob, syncJob?.id, syncJob?.status]);

    useEffect(() => {
        const isCompleted = syncJob?.status === 'completed' && syncProgress >= 100;
        if (!isCompleted || hasReloadedAfterSyncRef.current) {
            return;
        }

        hasReloadedAfterSyncRef.current = true;
        setSyncJob(null);
        setSyncNotice(null);

        const timeoutId = window.setTimeout(() => {
            window.location.reload();
        }, 1000);

        return () => window.clearTimeout(timeoutId);
    }, [syncJob?.status, syncProgress]);

    const handleSync = async () => {
        setIsSyncing(true);
        setError(null);
        setSyncNotice(null);
        hasReloadedAfterSyncRef.current = false;
        try {
            const res = await fetchWithAuth(`${API_URL}/pppoe/sync`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Failed to sync PPPoE data.');

            const job = (data.job || null) as PppoeSyncJob | null;
            setSyncNotice(data.message || job?.message || 'PPPoE sync job queued.');
            setSyncJob(job);
        } catch (err: any) {
             console.error("Failed to sync PPPoE data:", err);
             setError(err.message);
        } finally {
            setIsSyncing(false);
        }
    };
    
    const handleAddUser = () => {
        setEditingUser(null);
        setIsModalOpen(true);
    };

    const handleEditUser = (user: PppoeUser) => {
        setEditingUser(user);
        setIsModalOpen(true);
    };
    
    const handleSaveUser = async (userData: { id?: string; name: string; password?: string; profile: string; comment: string }) => {
        setIsSaving(true);
        setError(null);
        const isEditing = !!userData.id;
        const url = isEditing ? `${API_URL}/pppoe/users/${userData.id}` : `${API_URL}/pppoe/users`;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify(userData),
            });
            // The backend now returns the full updated list from the DB
            setUsers(normalizePppoeUsers(await res.json()));
            setIsModalOpen(false);
        } catch (err: any) {
            console.error("Failed to save user:", err);
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (deletingMode === 'single' && deletingUser) {
            setActionInProgress(deletingUser.id);
            setError(null);
            try {
                const res = await fetchWithAuth(`${API_URL}/pppoe/users/${deletingUser.id}`, { method: 'DELETE' });
                setUsers(normalizePppoeUsers(await res.json()));
            } catch (err: any) {
                setError(err.message);
            } finally {
                setActionInProgress(null);
            }
        } else if (deletingMode === 'bulk') {
            setBulkActionInProgress('delete');
            setError(null);
            try {
                const res = await fetchWithAuth(`${API_URL}/pppoe/users/bulk-delete`, {
                    method: 'POST',
                    body: JSON.stringify({ ids: selectedUsers }),
                });
                setUsers(normalizePppoeUsers(await res.json()));
                setSelectedUsers([]);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setBulkActionInProgress(null);
            }
        }
        setDeletingUser(null);
        setDeletingMode(null);
    };
    
     const handleToggleUserStatus = async (user: PppoeUser) => {
        const action = user.disabled ? 'enable' : 'disable';
        setActionInProgress(user.id);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/pppoe/users/${user.id}/${action}`, { method: 'POST' });
            setUsers(normalizePppoeUsers(await res.json())); // Update state directly from API response
        } catch (err: any) {
            console.error(`Failed to ${action} user:`, err);
            setError(err.message);
        } finally {
            setActionInProgress(null);
        }
    };

    const handleReconnectUser = async (username: string) => {
        setActionInProgress(username); // Using username as ID for this action
        setError(null);
        try {
            const encodedUsername = encodeURIComponent(username);
            const res = await fetchWithAuth(`${API_URL}/pppoe/users/${encodedUsername}/reconnect`, { method: 'POST' });
            setUsers(normalizePppoeUsers(await res.json())); // Update state directly from API response
        } catch (err: any) {
            console.error('Failed to reconnect user:', err);
            setError(err.message);
        } finally {
            setActionInProgress(null);
        }
    };
    
    const customersMap = useMemo(() => {
        return customers.reduce((acc, customer) => {
            acc[customer.id] = customer.name;
            return acc;
        }, {} as Record<string, string>);
    }, [customers]);

    const filterCounts = useMemo(() => {
        return {
            online: users.filter(u => u.active).length,
            offline: users.filter(u => !u.active).length,
            enabled: users.filter(u => !u.disabled).length,
            disabled: users.filter(u => u.disabled).length,
        };
    }, [users]);

    const filteredUsers = useMemo(() => {
        return users
            .filter(u => {
                if (!searchQuery) return true;
                const lowercasedQuery = searchQuery.toLowerCase();
                return String(u.name || '').toLowerCase().includes(lowercasedQuery) ||
                    String(u.profile || '').toLowerCase().includes(lowercasedQuery) ||
                    String(u.comment || '').toLowerCase().includes(lowercasedQuery) ||
                    String(customersMap[u.comment] || '').toLowerCase().includes(lowercasedQuery);
            })
            .filter(u => {
                if (statusFilter === 'all') return true;
                return statusFilter === 'online' ? u.active : !u.active;
            })
            .filter(u => {
                if (enabledFilter === 'all') return true;
                return enabledFilter === 'enabled' ? !u.disabled : u.disabled;
            });
    }, [users, searchQuery, customersMap, statusFilter, enabledFilter]);
    
    // Reset page number when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, statusFilter, enabledFilter]);

    // Pagination logic
    const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
    const paginatedUsers = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredUsers, currentPage]);

    
    const handleSelectOne = (userId: string, isSelected: boolean) => {
        setSelectedUsers(prev => isSelected ? [...prev, userId] : prev.filter(id => id !== userId));
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        const pageIds = paginatedUsers.map(u => u.id);
        if (e.target.checked) {
            setSelectedUsers(prev => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedUsers(prev => prev.filter(id => !pageIds.includes(id)));
        }
    };

    const areAllOnPageSelected = paginatedUsers.length > 0 && paginatedUsers.every(u => selectedUsers.includes(u.id));
    
    const handleBulkAction = async (action: 'enable' | 'disable') => {
        setBulkActionInProgress(action);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/pppoe/users/bulk-action`, {
                method: 'POST',
                body: JSON.stringify({ action, ids: selectedUsers }),
            });
            setUsers(normalizePppoeUsers(await res.json()));
            setSelectedUsers([]);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBulkActionInProgress(null);
        }
    };

    const handleDeleteSelected = () => {
        if (selectedUsers.length > 0) {
            setDeletingMode('bulk');
            setDeletingUser({} as PppoeUser); // Dummy object to open modal
        }
    };

    const FilterButton: React.FC<{
        active: boolean;
        onClick: () => void;
        children: React.ReactNode;
        count?: number;
    }> = ({ active, onClick, children, count }) => (
        <button
            type="button"
            onClick={onClick}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border dark:border-gray-600'
            }`}
        >
            {children}
            {typeof count === 'number' && <span className="ml-1.5 opacity-75">({count})</span>}
        </button>
    );


    return (
        <div className="space-y-6">
            <UserFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveUser}
                user={editingUser}
                profiles={profiles}
                isSaving={isSaving}
            />
            <DeleteConfirmationModal
                isOpen={deletingMode !== null}
                onClose={() => { setDeletingUser(null); setDeletingMode(null); }}
                onConfirm={confirmDelete}
                itemName={deletingMode === 'bulk' ? `${selectedUsers.length} user(s)` : deletingUser?.name || ''}
                itemType="PPPoE User"
                isLoading={actionInProgress === deletingUser?.id || bulkActionInProgress === 'delete'}
            />

            <div className="flex justify-between items-center flex-wrap gap-4">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">PPPoE Users</h2>
                <div className="flex space-x-2">
                    <button onClick={handleAddUser} disabled={!isRouterOnline} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 font-semibold shadow-sm transition-colors disabled:bg-gray-400">Add User</button>
                    <button onClick={handleSync} disabled={isSyncing || isLoading || isSyncJobActive || !isRouterOnline} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm transition-colors disabled:bg-gray-400 flex items-center">
                        {isSyncing ? <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="-ml-1 mr-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566z" clipRule="evenodd" /></svg>}
                        {syncButtonLabel}
                    </button>
                </div>
            </div>
            {(syncJob || syncNotice) && (
                <div className={`p-4 rounded-md border ${syncJob?.status === 'failed'
                    ? 'bg-red-50 dark:bg-red-900/30 border-red-500'
                    : syncJob?.status === 'completed'
                        ? 'bg-green-50 dark:bg-green-900/30 border-green-500'
                        : 'bg-blue-50 dark:bg-blue-900/30 border-blue-500'
                }`}>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100">
                                PPPoE Sync Job {syncJob ? `(${syncJob.status})` : ''}
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                {syncJob?.message || syncNotice || 'PPPoE sync job queued.'}
                            </p>
                        </div>
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{syncProgress}%</span>
                    </div>
                    <div className="mt-3 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${syncJob?.status === 'failed'
                                ? 'bg-red-500'
                                : syncJob?.status === 'completed'
                                    ? 'bg-green-500'
                                    : 'bg-blue-500'
                            }`}
                            style={{ width: `${syncProgress}%` }}
                        />
                    </div>
                    {syncJob?.error_message && (
                        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{syncJob.error_message}</p>
                    )}
                    {syncJob && (
                        <div className="mt-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                            <p className="font-mono break-all">{syncJob.id}</p>
                            <p>Processed: {syncJob.processed_count}</p>
                        </div>
                    )}
                </div>
            )}
             {!isRouterOnline && (
                <div className="bg-yellow-100 dark:bg-yellow-800/30 border-l-4 border-yellow-500 text-yellow-700 dark:text-yellow-300 p-4 rounded-md" role="alert">
                    <p className="font-bold">Router Offline</p>
                    <p>Displaying cached data from the last sync. Live status is unavailable and actions are disabled.</p>
                </div>
            )}
             {error && <div className="bg-red-100 dark:bg-red-900/40 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-md" role="alert"><p className="font-bold">Error</p><p>{error}</p></div>}
            <Card>
                <div className="border-b dark:border-gray-700 pb-4 mb-4 space-y-4 px-4 pt-4">
                     <div>
                        <input
                            type="text"
                            placeholder="Search by username, profile, customer ID or name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-4 pr-4 py-2 border dark:border-gray-600 rounded-md w-full sm:w-96 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 dark:text-white"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Status:</span>
                            <FilterButton active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</FilterButton>
                            <FilterButton active={statusFilter === 'online'} onClick={() => setStatusFilter('online')} count={filterCounts.online}>Online</FilterButton>
                            <FilterButton active={statusFilter === 'offline'} onClick={() => setStatusFilter('offline')} count={filterCounts.offline}>Offline</FilterButton>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Config:</span>
                            <FilterButton active={enabledFilter === 'all'} onClick={() => setEnabledFilter('all')}>All</FilterButton>
                            <FilterButton active={enabledFilter === 'enabled'} onClick={() => setEnabledFilter('enabled')} count={filterCounts.enabled}>Enabled</FilterButton>
                            <FilterButton active={enabledFilter === 'disabled'} onClick={() => setEnabledFilter('disabled')} count={filterCounts.disabled}>Disabled</FilterButton>
                        </div>
                    </div>

                    {selectedUsers.length > 0 && (
                        <div className="pt-4 flex items-center justify-start gap-4">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                                {selectedUsers.length} selected
                            </span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleBulkAction('enable')} disabled={!!bulkActionInProgress || !isRouterOnline} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors shadow-sm disabled:bg-gray-400">
                                    <EnableIcon /> <span>Enable</span>
                                </button>
                                <button onClick={() => handleBulkAction('disable')} disabled={!!bulkActionInProgress || !isRouterOnline} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-orange-500 rounded-md hover:bg-orange-600 transition-colors shadow-sm disabled:bg-gray-400">
                                    <DisableIcon /> <span>Disable</span>
                                </button>
                                <button onClick={handleDeleteSelected} disabled={!!bulkActionInProgress || !isRouterOnline} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors shadow-sm disabled:bg-gray-400">
                                <TrashIcon /> <span>Delete</span>
                                </button>
                            </div>
                            <button onClick={() => setSelectedUsers([])} className="p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full" aria-label="Clear selection">
                                <CloseIcon />
                            </button>
                        </div>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                        <tr>
                            <th scope="col" className="p-4">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                    onChange={handleSelectAll}
                                    checked={areAllOnPageSelected}
                                    aria-label="Select all users on this page"
                                />
                            </th>
                            <th scope="col" className="px-6 py-3">Status</th>
                            <th scope="col" className="px-6 py-3">Username</th>
                            <th scope="col" className="px-6 py-3">Profile</th>
                            <th scope="col" className="px-6 py-3">Linked Customer</th>
                            <th scope="col" className="px-6 py-3 text-right">Actions</th>
                        </tr>
                        </thead>
                        <tbody>
                        {paginatedUsers.length > 0 ? paginatedUsers.map(user => (
                            <tr key={user.id} className={`border-b dark:border-gray-700 ${user.disabled ? 'bg-gray-50 dark:bg-gray-700/60' : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                                <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                        checked={selectedUsers.includes(user.id)}
                                        onChange={(e) => handleSelectOne(user.id, e.target.checked)}
                                        aria-label={`Select user ${user.name}`}
                                    />
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div>
                                        <div className="flex items-center space-x-2">
                                            <span 
                                                className={`h-2.5 w-2.5 rounded-full ${user.active ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} 
                                                title={user.active ? 'User is online and connected' : 'User is offline'}
                                            ></span>
                                            <span className={`text-sm font-medium ${user.active ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                                {user.active ? 'Online' : 'Offline'}
                                            </span>
                                        </div>
                                        <div 
                                            className={`text-xs pl-[18px] ${user.disabled ? 'text-red-600 dark:text-red-500' : 'text-gray-500 dark:text-gray-400'}`}
                                            title={user.disabled ? 'User is disabled in configuration' : 'User is enabled in configuration'}
                                        >
                                            {user.disabled ? 'Disabled' : 'Enabled'}
                                        </div>
                                    </div>
                                </td>
                                <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${user.disabled ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>{user.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{user.profile}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                    {user.comment ? `${customersMap[user.comment] || 'N/A'} (${user.comment})` : <span className="text-gray-400">-</span>}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                    {user.active && !user.disabled && <button onClick={() => handleReconnectUser(user.name)} disabled={actionInProgress === user.name || !isRouterOnline} className="text-yellow-600 hover:text-yellow-900 dark:text-yellow-500 dark:hover:text-yellow-400 disabled:text-gray-400 dark:disabled:text-gray-500">Reconnect</button>}
                                    <button onClick={() => handleToggleUserStatus(user)} disabled={actionInProgress === user.id || !isRouterOnline} className={`${user.disabled ? 'text-green-600 hover:text-green-900 dark:text-green-500 dark:hover:text-green-400' : 'text-red-600 hover:text-red-900 dark:text-red-500 dark:hover:text-red-400'} disabled:text-gray-400 dark:disabled:text-gray-500`}>
                                        {user.disabled ? 'Enable' : 'Disable'}
                                    </button>
                                    <button onClick={() => handleEditUser(user)} disabled={!isRouterOnline} className="text-blue-600 hover:text-blue-900 dark:text-blue-500 dark:hover:text-blue-400 disabled:text-gray-400 dark:disabled:text-gray-500">Edit</button>
                                    <button onClick={() => { setDeletingUser(user); setDeletingMode('single'); }} disabled={actionInProgress === user.id || !isRouterOnline} className="text-red-600 hover:text-red-900 dark:text-red-500 dark:hover:text-red-400 disabled:text-gray-400 dark:disabled:text-gray-500">Delete</button>
                                </td>
                            </tr>
                        )) : (
                             <tr>
                                <td colSpan={6} className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">
                                    {isLoading ? 'Loading...' : (searchQuery ? 'No users match your search.' : 'No PPPoE users found in the local database. Try syncing with the router.')}
                                </td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-between p-4 border-t dark:border-gray-700">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredUsers.length)}
                        {' to '}
                        {Math.min(currentPage * ITEMS_PER_PAGE, filteredUsers.length)}
                        {' of '}
                        {filteredUsers.length} results
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

export default PppoeUsers;
