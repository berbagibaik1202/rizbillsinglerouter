
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '../../components/common/Card';
import { HotspotUser } from '../../types';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

const HotspotUsers: React.FC = () => {
    const [users, setUsers] = useState<HotspotUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionInProgress, setActionInProgress] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isRouterOnline, setIsRouterOnline] = useState(true);
    
    // State for selection and bulk actions
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [deletingMode, setDeletingMode] = useState<'single' | 'bulk' | null>(null);
    const [deletingUser, setDeletingUser] = useState<HotspotUser | null>(null);
    const [bulkActionInProgress, setBulkActionInProgress] = useState<string | null>(null);

    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;


    const EnableIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;
    const DisableIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>;
    const SpinnerIcon = () => <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>;
    const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
    const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;


    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        // First: test connection, but don't block the user list fetch if it fails.
        try {
            const connRes = await fetchWithAuth(`${API_URL}/network/test-connection`, { method: 'POST' });
            setIsRouterOnline(connRes.ok);
        } catch (err) {
            console.warn("Router test connection failed, continuing to fetch users:", err);
            setIsRouterOnline(false);
        }

        // Then: fetch users regardless of test result, so UI can still show cached/partial data.
        try {
            const res = await fetchWithAuth(`${API_URL}/hotspot/users`);
            const data = await res.json();

            // Backend may include a header indicating router status; respect it if present.
            const headerRouterOnline = res.headers.get('X-Router-Online');
            if (headerRouterOnline === 'false') {
                setIsRouterOnline(false);
            }

            setUsers(data);
        } catch (err: any) {
            console.error("Failed to fetch hotspot users:", err);
            setError("A network error occurred while fetching data.");
            setIsRouterOnline(false);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);
    
    const handleSync = async () => {
        setIsSyncing(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/hotspot/sync`, { method: 'POST' });
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Sync failed');
            }
            await fetchUsers(); // Refresh data after sync
        } catch (err: any) {
             console.error("Failed to sync Hotspot data:", err);
             setError(err.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleToggleUserStatus = async (user: HotspotUser) => {
        const action = user.disabled ? 'enable' : 'disable';
        setActionInProgress(user.id);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/hotspot/users/${user.id}/${action}`, { method: 'POST' });
            const responseData = await res.json();
             if (!res.ok) {
                throw new Error(responseData.message || `Failed to ${action} user`);
            }
            setUsers(responseData); // Update state directly from API response
        } catch (err: any) {
            console.error(`Failed to ${action} user:`, err);
            setError(err.message);
        } finally {
            setActionInProgress(null);
        }
    };
    
    const confirmDelete = async () => {
        setError(null);
        if (deletingMode === 'single' && deletingUser) {
            setActionInProgress(deletingUser.id);
            try {
                // This is a placeholder for a single delete function if it existed.
                // Since we're using bulk delete for everything now, this could be adapted.
            } catch (err: any) {
                setError(err.message);
            } finally {
                setActionInProgress(null);
            }
        } else if (deletingMode === 'bulk') {
            setBulkActionInProgress('delete');
            try {
                const res = await fetchWithAuth(`${API_URL}/hotspot/users/bulk-delete`, {
                    method: 'POST',
                    body: JSON.stringify({ ids: selectedUsers }),
                });
                const responseData = await res.json();
                if (!res.ok) throw new Error(responseData.message || 'Failed to delete users.');
                setUsers(responseData);
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

    const filteredUsers = useMemo(() => {
        if (!searchQuery) return users;
        const lowercasedQuery = searchQuery.toLowerCase();
        return users.filter(u =>
            (u.name || '').toLowerCase().includes(lowercasedQuery) ||
            (u.profile || '').toLowerCase().includes(lowercasedQuery) ||
            (u.comment || '').toLowerCase().includes(lowercasedQuery)
        );
    }, [users, searchQuery]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
    const paginatedUsers = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredUsers, currentPage]);
    
    const handleSelectOne = (userId: string, isSelected: boolean) => {
        setSelectedUsers(prev => isSelected ? [...prev, userId] : prev.filter(id => id !== userId));
    };

    const handleSelectAllOnPage = (e: React.ChangeEvent<HTMLInputElement>) => {
        const pageIds = paginatedUsers.map(u => u.id);
        if (e.target.checked) {
            setSelectedUsers(prev => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedUsers(prev => prev.filter(id => !pageIds.includes(id)));
        }
    };
    
    const areAllOnPageSelected = paginatedUsers.length > 0 && paginatedUsers.every(u => selectedUsers.includes(u.id));
    
    const handleDeleteSelected = () => {
        if (selectedUsers.length > 0) {
            setDeletingMode('bulk');
        }
    };

    return (
        <div className="space-y-6">
             <DeleteConfirmationModal
                isOpen={deletingMode !== null}
                onClose={() => setDeletingMode(null)}
                onConfirm={confirmDelete}
                itemName={deletingMode === 'bulk' ? `${selectedUsers.length} user(s)` : deletingUser?.name || ''}
                itemType="Hotspot User"
                isLoading={actionInProgress === deletingUser?.id || bulkActionInProgress === 'delete'}
            />
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Hotspot Users</h2>
                <button
                    onClick={handleSync}
                    disabled={isSyncing || isLoading || !isRouterOnline}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                >
                    {isSyncing ? (
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    ) : (
                         <svg xmlns="http://www.w3.org/2000/svg" className="-ml-1 mr-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566z" clipRule="evenodd" /></svg>
                    )}
                    {isSyncing ? 'Syncing...' : 'Sync with Router'}
                </button>
            </div>

            {!isRouterOnline && (
                <div className="bg-red-100 dark:bg-red-900/40 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-md" role="alert">
                    <p className="font-bold">Connection Error</p>
                    <p>Could not connect to the MikroTik router. Data may be stale and actions are disabled.</p>
                </div>
            )}
            {error && (
                 <div className="bg-red-100 dark:bg-red-900/40 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-md" role="alert">
                    <p className="font-bold">Error</p>
                    <p>{error}</p>
                </div>
            )}

            <Card>
                <div className="p-4 border-b dark:border-gray-700">
                    <input
                        type="text"
                        placeholder="Search by username, profile, or comment..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-4 pr-4 py-2 border dark:border-gray-600 rounded-md w-full sm:w-80 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 dark:text-white"
                    />
                </div>
                {selectedUsers.length > 0 && (
                    <div className="p-4 flex items-center gap-4 bg-gray-100 dark:bg-gray-700">
                        <span className="text-sm font-semibold">{selectedUsers.length} selected</span>
                        <button
                            onClick={handleDeleteSelected}
                            disabled={!!bulkActionInProgress || !isRouterOnline}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:bg-gray-400"
                        >
                            <TrashIcon /> <span>Delete</span>
                        </button>
                        <button onClick={() => setSelectedUsers([])} className="ml-auto p-1.5 text-gray-500 hover:bg-gray-200 rounded-full dark:hover:bg-gray-600">
                            <CloseIcon />
                        </button>
                    </div>
                )}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                        <tr>
                             <th scope="col" className="p-4">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                    onChange={handleSelectAllOnPage}
                                    checked={areAllOnPageSelected}
                                    aria-label="Select all visible users"
                                />
                            </th>
                            <th scope="col" className="px-6 py-3">Status</th>
                            <th scope="col" className="px-6 py-3">Username</th>
                            <th scope="col" className="px-6 py-3">Profile</th>
                            <th scope="col" className="px-6 py-3">Comment</th>
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
                                    {user.disabled ? (
                                        <div className="flex items-center space-x-2">
                                            <span className="h-2.5 w-2.5 rounded-full bg-red-500" title="User is disabled"></span>
                                            <span className="text-sm font-medium text-red-600 dark:text-red-500">Disabled</span>
                                        </div>
                                    ) : (
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
                                            <div className="text-xs text-gray-500 dark:text-gray-400 pl-[18px]" title="User is enabled in configuration">
                                                Enabled
                                            </div>
                                        </div>
                                    )}
                                </td>
                                <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${user.disabled ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>{user.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{user.profile}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{user.comment}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <div className="flex items-center justify-end">
                                        {actionInProgress === user.id ? (
                                            <div className="p-2"><SpinnerIcon /></div>
                                        ) : (
                                            <button 
                                                onClick={() => handleToggleUserStatus(user)}
                                                disabled={!isRouterOnline}
                                                className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:text-gray-400 disabled:cursor-wait ${user.disabled ? 'text-green-600' : 'text-orange-500'}`}
                                                title={user.disabled ? 'Enable User' : 'Disable User'}
                                            >
                                                {user.disabled ? <EnableIcon /> : <DisableIcon />}
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={6} className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">
                                   {isLoading ? 'Loading...' : !isRouterOnline ? 'Could not load users. Router is offline.' : (searchQuery ? 'No users match your search.' : 'No Hotspot users found.')}
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

export default HotspotUsers;
