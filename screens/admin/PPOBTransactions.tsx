import React, { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth } from '~/components/api';
import { formatDateTimeDisplay, formatRupiah } from '~/types';

interface AdminPPOBTransaction {
    id: number;
    product_type?: string;
    transaction_ref_id: string;
    customer_id: string;
    customer_name: string | null;
    product_code: string;
    product_name: string;
    category: string;
    brand: string;
    customer_no: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'ENDING';
    selling_price: number;
    message: string;
    created_at: string;
    updated_at: string;
}

const statusOptions: AdminPPOBTransaction['status'][] = ['PENDING', 'SUCCESS', 'FAILED', 'ENDING'];

const PPOBTransactions: React.FC = () => {
    const [transactions, setTransactions] = useState<AdminPPOBTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | AdminPPOBTransaction['status']>('all');
    const [editingRef, setEditingRef] = useState<string | null>(null);
    const [editingStatus, setEditingStatus] = useState<AdminPPOBTransaction['status']>('PENDING');
    const [editingMessage, setEditingMessage] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    const [refreshingRef, setRefreshingRef] = useState<string | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);
    const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
    const [bulkStatus, setBulkStatus] = useState<AdminPPOBTransaction['status']>('FAILED');
    const [isBulkProcessing, setIsBulkProcessing] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth('/api/ppob/admin/transactions');
            const data = await res.json();
            setTransactions(data);
            setSelectedRefs([]);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch transactions.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleRefreshStatus = async (ref: string) => {
        setRefreshingRef(ref);
        setStatusError(null);
        try {
            const res = await fetchWithAuth(`/api/ppob/transactions/${ref}/refresh`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to refresh status.');
            await fetchData();
        } catch (err: any) {
            setStatusError(err.message);
        } finally {
            setRefreshingRef(null);
        }
    };

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filtered = transactions.filter(tx => {
        if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
        if (search.trim()) {
            const q = search.toLowerCase();
            const hay = `${tx.transaction_ref_id} ${tx.customer_no} ${tx.product_name} ${tx.product_code} ${tx.customer_name || ''}`.toLowerCase();
            return hay.includes(q);
        }
        // Date filter (inclusive)
        if (startDate || endDate) {
            const txDate = new Date(tx.created_at);
            if (startDate) {
                const start = new Date(startDate + 'T00:00:00');
                if (txDate < start) return false;
            }
            if (endDate) {
                const end = new Date(endDate + 'T23:59:59');
                if (txDate > end) return false;
            }
        }
        return true;
    });

    const startEdit = (tx: AdminPPOBTransaction) => {
        setEditingRef(tx.transaction_ref_id);
        setEditingStatus(tx.status);
        setEditingMessage(tx.message || '');
    };

    const cancelEdit = () => {
        setEditingRef(null);
        setEditingMessage('');
        setIsSaving(false);
    };

    const toggleSelect = (ref: string, checked: boolean) => {
        setSelectedRefs(prev => checked ? Array.from(new Set([...prev, ref])) : prev.filter(r => r !== ref));
    };

    const toggleSelectAll = (checked: boolean, rows: AdminPPOBTransaction[]) => {
        const refs = rows.map(r => r.transaction_ref_id);
        setSelectedRefs(prev => checked ? Array.from(new Set([...prev, ...refs])) : prev.filter(r => !refs.includes(r)));
    };

    const saveEdit = async () => {
        if (!editingRef) return;
        setIsSaving(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`/api/ppob/admin/transactions/${editingRef}`, {
                method: 'PUT',
                body: JSON.stringify({ status: editingStatus, message: editingMessage }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to update transaction');
            // update local
            setTransactions(prev => prev.map(tx => tx.transaction_ref_id === editingRef ? { ...tx, status: editingStatus, message: editingMessage } : tx));
            cancelEdit();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const deleteTx = async (ref: string) => {
        if (!window.confirm('Hapus transaksi ini?')) return;
        setError(null);
        try {
            const res = await fetchWithAuth(`/api/ppob/admin/transactions/${ref}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to delete transaction');
            setTransactions(prev => prev.filter(tx => tx.transaction_ref_id !== ref));
        } catch (err: any) {
            setError(err.message);
        }
    };

    const bulkUpdateStatus = async () => {
        if (selectedRefs.length === 0) return;
        setIsBulkProcessing(true);
        setError(null);
        try {
            for (const ref of selectedRefs) {
                const res = await fetchWithAuth(`/api/ppob/admin/transactions/${ref}`, {
                    method: 'PUT',
                    body: JSON.stringify({ status: bulkStatus, message: 'Updated via bulk action' }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || `Gagal mengubah status ${ref}`);
            }
            setTransactions(prev => prev.map(tx => selectedRefs.includes(tx.transaction_ref_id) ? { ...tx, status: bulkStatus, message: tx.message || 'Updated via bulk action' } : tx));
            setSelectedRefs([]);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsBulkProcessing(false);
        }
    };

    const bulkDelete = async () => {
        if (selectedRefs.length === 0) return;
        if (!window.confirm(`Hapus ${selectedRefs.length} transaksi?`)) return;
        setIsBulkProcessing(true);
        setError(null);
        try {
            for (const ref of selectedRefs) {
                const res = await fetchWithAuth(`/api/ppob/admin/transactions/${ref}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || `Gagal menghapus ${ref}`);
            }
            setTransactions(prev => prev.filter(tx => !selectedRefs.includes(tx.transaction_ref_id)));
            setSelectedRefs([]);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsBulkProcessing(false);
        }
    };

    return (
        <div className="p-6 bg-gray-100 dark:bg-gray-900 min-h-screen">
            <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
                <div className="flex flex-wrap gap-2 items-center mb-4">
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Transaksi PPOB</h1>
                    <div className="flex-1" />
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="px-3 py-1.5 border rounded text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        aria-label="Tanggal mulai"
                    />
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="px-3 py-1.5 border rounded text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        aria-label="Tanggal akhir"
                    />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Cari ref, nomor, produk, customer..."
                        className="px-3 py-1.5 border rounded text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="px-3 py-1.5 border rounded text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        <option value="all">Semua Status</option>
                        <option value="PENDING">Pending</option>
                        <option value="SUCCESS">Success</option>
                        <option value="FAILED">Failed</option>
                        <option value="ENDING">Ending</option>
                    </select>
                    <button onClick={fetchData} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">Reload</button>
                </div>

                {error && <div className="p-3 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-100 border border-red-300 dark:border-red-700 rounded mb-3 text-sm">{error}</div>}
                {error && <div className="p-3 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-100 border border-red-300 dark:border-red-700 rounded mb-3 text-sm">{error}</div>}
                {isLoading ? (
                    <p className="text-center text-gray-500 dark:text-gray-300">Memuat transaksi...</p>
                ) : (
                    <>
                        {selectedRefs.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <div className="flex items-center gap-2">
                                    <label className="text-sm text-gray-700 dark:text-gray-200">Bulk status:</label>
                                    <select
                                        value={bulkStatus}
                                        onChange={(e) => setBulkStatus(e.target.value as any)}
                                        className="px-3 py-1.5 border rounded text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    >
                                        {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <button
                                        onClick={bulkUpdateStatus}
                                        disabled={isBulkProcessing}
                                        className="px-3 py-1.5 bg-green-600 text-white rounded text-sm disabled:opacity-50"
                                    >
                                        {isBulkProcessing ? 'Processing...' : 'Set Status'}
                                    </button>
                                </div>
                                <button
                                    onClick={bulkDelete}
                                    disabled={isBulkProcessing}
                                    className="px-3 py-1.5 bg-red-600 text-white rounded text-sm disabled:opacity-50"
                                >
                                    {isBulkProcessing ? 'Processing...' : `Hapus (${selectedRefs.length})`}
                                </button>
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-800 text-white">
                                    <tr>
                                        <th className="px-3 py-2 text-center">
                                            <input
                                                type="checkbox"
                                                checked={filtered.length > 0 && filtered.every(tx => selectedRefs.includes(tx.transaction_ref_id))}
                                                onChange={(e) => toggleSelectAll(e.target.checked, filtered)}
                                            />
                                        </th>
                                        <th className="px-3 py-2 text-left">Ref</th>
                                        <th className="px-3 py-2 text-left">Customer</th>
                                        <th className="px-3 py-2 text-left">Produk</th>
                                        <th className="px-3 py-2 text-left">Nomor/ID</th>
                                        <th className="px-3 py-2 text-right">Jumlah</th>
                                        <th className="px-3 py-2 text-left">Status</th>
                                        <th className="px-3 py-2 text-left">Pesan</th>
                                        <th className="px-3 py-2 text-left">Tanggal</th>
                                        <th className="px-3 py-2 text-center">Aksi</th>
                                        <th className="px-3 py-2 text-center">Cek Status</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-800 dark:text-gray-200">
                                    {filtered.length > 0 ? filtered.map(tx => {
                                        const isEditing = editingRef === tx.transaction_ref_id;
                                        return (
                                            <tr key={tx.transaction_ref_id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/60">
                                                <td className="px-3 py-2 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedRefs.includes(tx.transaction_ref_id)}
                                                        onChange={(e) => toggleSelect(tx.transaction_ref_id, e.target.checked)}
                                                    />
                                                </td>
                                                <td className="px-3 py-2 font-mono">{tx.transaction_ref_id}</td>
                                                <td className="px-3 py-2">{tx.customer_name || tx.customer_id}</td>
                                                <td className="px-3 py-2">
                                                    <div className="font-semibold">{tx.product_name}</div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">{tx.product_code}</div>
                                                </td>
                                                <td className="px-3 py-2 font-mono">{tx.customer_no}</td>
                                                <td className="px-3 py-2 text-right font-semibold">{formatRupiah(tx.selling_price)}</td>
                                                <td className="px-3 py-2">
                                                    {isEditing ? (
                                                        <select value={editingStatus} onChange={(e) => setEditingStatus(e.target.value as any)} className="border rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                                            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                    ) : (
                                                        <span className={`px-2 py-1 text-xs font-bold rounded ${tx.status === 'SUCCESS' ? 'bg-green-200 text-green-800' : tx.status === 'FAILED' ? 'bg-red-200 text-red-800' : 'bg-yellow-200 text-yellow-800'}`}>
                                                            {tx.status}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {isEditing ? (
                                                        <input type="text" value={editingMessage} onChange={(e) => setEditingMessage(e.target.value)} className="w-48 border rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                    ) : (
                                                        <span className="text-xs text-gray-700 dark:text-gray-300">{tx.message}</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{formatDateTimeDisplay(tx.created_at)}</td>
                                                <td className="px-3 py-2 text-center space-x-1">
                                                    {isEditing ? (
                                                        <>
                                                            <button onClick={saveEdit} disabled={isSaving} className="px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:opacity-50">Save</button>
                                                            <button onClick={cancelEdit} className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded">Cancel</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => startEdit(tx)} className="px-2 py-1 text-xs bg-yellow-200 text-yellow-900 rounded">Edit</button>
                                                            <button onClick={() => deleteTx(tx.transaction_ref_id)} className="px-2 py-1 text-xs bg-red-200 text-red-900 rounded">Hapus</button>
                                                        </>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRefreshStatus(tx.transaction_ref_id)}
                                                        disabled={refreshingRef === tx.transaction_ref_id}
                                                        className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {refreshingRef === tx.transaction_ref_id ? 'Memeriksa...' : 'Cek Status'}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    }) : (
                                        <tr>
                                            <td colSpan={10} className="text-center py-6 text-gray-500 dark:text-gray-300">Tidak ada transaksi.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {statusError && (
                            <div className="p-3 text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded mt-2">
                                {statusError}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default PPOBTransactions;
