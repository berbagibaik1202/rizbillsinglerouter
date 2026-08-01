import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '../../components/common/Card';
import { PppoeActiveUser } from '../../types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api/pppoe';

const normalizeActiveUsers = (payload: unknown): PppoeActiveUser[] => {
    if (!Array.isArray(payload)) return [];
    return payload as PppoeActiveUser[];
};

const PppoeActive: React.FC = () => {
    const [activeUsers, setActiveUsers] = useState<PppoeActiveUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionInProgress, setActionInProgress] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isRouterOnline, setIsRouterOnline] = useState(true);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    const fetchData = useCallback(async (isInitialLoad = false) => {
        if (isInitialLoad) setIsLoading(true);
        setError(null);
        try {
            const connRes = await fetchWithAuth('/api/network/test-connection', { method: 'POST' });
            const isOnline = connRes.ok;
            setIsRouterOnline(isOnline);

            if (isOnline) {
                const res = await fetchWithAuth(`${API_URL}/active`);
                setActiveUsers(normalizeActiveUsers(await res.json()));
            } else {
                setActiveUsers([]); // Clear data if offline
            }
        } catch (err: any) {
            console.error("Failed to fetch active pppoe users:", err);
            setError("A network error occurred while fetching data.");
            setIsRouterOnline(false);
        } finally {
            if (isInitialLoad) setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData(true); // Initial load
        const interval = setInterval(() => fetchData(false), 30000); // Auto-refresh
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleKickUser = async (userId: string) => {
        setActionInProgress(userId);
        setError(null);
        try {
            const encodedUserId = encodeURIComponent(userId);
            const res = await fetchWithAuth(`${API_URL}/active/${encodedUserId}/kick`, { method: 'POST' });
            setActiveUsers(normalizeActiveUsers(await res.json()));
        } catch (err: any) {
            console.error(`Failed to kick user ${userId}:`, err);
            setError(err.message);
        } finally {
            setActionInProgress(null);
        }
    };

    const filteredUsers = useMemo(() => {
        if (!searchQuery) return activeUsers;
        const lowercasedQuery = searchQuery.toLowerCase();
        return activeUsers.filter(u =>
            String(u.name || '').toLowerCase().includes(lowercasedQuery) ||
            String(u.address || '').toLowerCase().includes(lowercasedQuery)
        );
    }, [activeUsers, searchQuery]);
    
    // Reset page number when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    // Pagination logic
    const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
    const paginatedUsers = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredUsers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredUsers, currentPage]);


    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center space-x-3">
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">PPPoE Active Connections</h2>
                    <span className="bg-blue-100 text-blue-800 text-sm font-semibold px-2.5 py-0.5 rounded-full dark:bg-blue-900 dark:text-blue-300">
                        {activeUsers.length}
                    </span>
                </div>
                <button
                    onClick={() => fetchData(true)}
                    disabled={isLoading || !isRouterOnline}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm transition-colors disabled:bg-gray-400 flex items-center"
                >
                    {isLoading ? (
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="-ml-1 mr-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566z" clipRule="evenodd" /></svg>
                    )}
                    {isLoading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {!isRouterOnline && (
                <div className="bg-red-100 dark:bg-red-900/40 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-md" role="alert">
                    <p className="font-bold">Connection Error</p>
                    <p>Could not connect to the MikroTik router. Real-time data is unavailable and actions are disabled.</p>
                </div>
            )}
            {error && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}

            <Card>
                <div className="p-4 border-b dark:border-gray-700">
                    <input
                        type="text"
                        placeholder="Search by username or IP address..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-4 pr-4 py-2 border dark:border-gray-600 rounded-md w-full sm:w-80 bg-white dark:bg-gray-800 dark:text-white"
                    />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                            <tr>
                                <th scope="col" className="px-6 py-3">Username</th>
                                <th scope="col" className="px-6 py-3">Service</th>
                                <th scope="col" className="px-6 py-3">IP Address</th>
                                <th scope="col" className="px-6 py-3">Caller ID</th>
                                <th scope="col" className="px-6 py-3">Uptime</th>
                                <th scope="col" className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedUsers.length > 0 ? paginatedUsers.map(user => (
                                <tr key={user.id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600">
                                    <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white">{user.name}</td>
                                    <td className="px-6 py-4">{user.service}</td>
                                    <td className="px-6 py-4">{user.address}</td>
                                    <td className="px-6 py-4">{user.callerId}</td>
                                    <td className="px-6 py-4">{user.uptime}</td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => handleKickUser(user.id)}
                                            disabled={actionInProgress === user.id || !isRouterOnline}
                                            className="font-medium text-red-600 dark:text-red-500 hover:underline disabled:text-gray-400 disabled:cursor-wait"
                                        >
                                            {actionInProgress === user.id ? 'Kicking...' : 'Kick User'}
                                        </button>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={6} className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">
                                        {isLoading ? 'Loading active connections...' : !isRouterOnline ? 'Could not load connections. Router is offline.' : (searchQuery ? 'No users match your search.' : 'No active connections found.')}
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

export default PppoeActive;
