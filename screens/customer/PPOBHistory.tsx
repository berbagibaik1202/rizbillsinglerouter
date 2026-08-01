// screens/customer/PPOBHistory.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '~/components/api';
import { formatDateTimeDisplay, formatRupiah } from '~/types';

// Define the type for a single PPOB transaction
interface PPOBTransaction {
    id: number;
    transaction_ref_id: string;
    product_name: string;
    customer_no: string;
    selling_price: number;
    status: 'PENDING' | 'SUCCESS' | 'FAILED';
    message: string;
    created_at: string;
    rc?: string | null;
    rcDescription?: string | null;
}

const PPOBHistory: React.FC = () => {
    const [transactions, setTransactions] = useState<PPOBTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchHistory = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetchWithAuth('/api/ppob/transactions');
            const data = await response.json();
            setTransactions(data);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch transaction history.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    const getStatusChip = (status: PPOBTransaction['status']) => {
        switch (status) {
            case 'SUCCESS':
                return <span className="px-2 py-1 text-xs font-bold rounded-full bg-green-200 text-green-800">Success</span>;
            case 'FAILED':
                return <span className="px-2 py-1 text-xs font-bold rounded-full bg-red-200 text-red-800">Failed</span>;
            case 'PENDING':
                return <span className="px-2 py-1 text-xs font-bold rounded-full bg-yellow-200 text-yellow-800">Pending</span>;
            default:
                return <span className="px-2 py-1 text-xs font-bold rounded-full bg-gray-200 text-gray-800">{status}</span>;
        }
    };

    if (isLoading) {
        return <p className="text-center text-gray-500 p-8">Loading history...</p>;
    }

    if (error) {
        return <p className="text-center text-red-500 p-8">{error}</p>;
    }

    return (
        <div className="py-6">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-6">PPOB Transaction History</h2>
            <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white dark:bg-gray-800">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="text-left py-3 px-4 uppercase font-semibold text-sm text-gray-600 dark:text-gray-300">Date</th>
                                <th className="text-left py-3 px-4 uppercase font-semibold text-sm text-gray-600 dark:text-gray-300">Product</th>
                                <th className="text-left py-3 px-4 uppercase font-semibold text-sm text-gray-600 dark:text-gray-300">Number/ID</th>
                                <th className="text-right py-3 px-4 uppercase font-semibold text-sm text-gray-600 dark:text-gray-300">Amount</th>
                                <th className="text-center py-3 px-4 uppercase font-semibold text-sm text-gray-600 dark:text-gray-300">Status</th>
                                <th className="text-left py-3 px-4 uppercase font-semibold text-sm text-gray-600 dark:text-gray-300">Message</th>
                            </tr>
                        </thead>
                        <tbody className="text-gray-700 dark:text-gray-200">
                            {transactions.map((tx) => (
                                <tr key={tx.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700/50">
                                    <td className="py-3 px-4 text-sm">{formatDateTimeDisplay(tx.created_at)}</td>
                                    <td className="py-3 px-4 font-medium">{tx.product_name}</td>
                                    <td className="py-3 px-4 font-mono text-sm">{tx.customer_no}</td>
                                    <td className="py-3 px-4 text-right font-semibold">{formatRupiah(tx.selling_price)}</td>
                                    <td className="py-3 px-4 text-center">{getStatusChip(tx.status)}</td>
                                    <td className="py-3 px-4 text-sm max-w-xs">
                                        <div className="space-y-1">
                                            <p className="truncate font-medium" title={tx.message || 'Tidak ada pesan'}>
                                                {tx.message || 'Tidak ada pesan tersedia'}
                                            </p>
                                            {tx.rc && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    {tx.rc}
                                                    {tx.rcDescription ? ` – ${tx.rcDescription}` : ''}
                                                </p>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {transactions.length === 0 && <p className="text-center py-8 text-gray-500">No PPOB transactions found.</p>}
                </div>
            </div>
        </div>
    );
};

export default PPOBHistory;
