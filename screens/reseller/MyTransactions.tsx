import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AdminUser, Payment, HotspotVoucher, HotspotProfile, formatRupiah, formatDateTimeDisplay, formatDuration } from '~/types';
import Card from '~/components/common/Card';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

interface MyTransactionsProps {
    user: AdminUser;
}

type ResellerTransaction = Payment & {
    transactionType: 'Voucher Sale' | 'Balance Top Up';
    basePrice?: number;
    profit?: number;
    voucherDetails?: HotspotVoucher;
};


const StatCard: React.FC<{ title: string; value: string | number; }> = ({ title, value }) => (
  <Card className="text-center">
    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{title}</p>
    <p className="mt-1 text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
  </Card>
);


const MyTransactions: React.FC<MyTransactionsProps> = ({ user }) => {
    const [allTransactions, setAllTransactions] = useState<ResellerTransaction[]>([]);
    const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [paymentsRes, usersRes, vouchersRes, profilesRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/billing/payments`),
                fetchWithAuth(`${API_URL}/admin/users`),
                fetchWithAuth(`${API_URL}/hotspot/vouchers`),
                fetchWithAuth(`${API_URL}/hotspot/profiles`),
            ]);

            if (!paymentsRes.ok) throw new Error('Failed to fetch payments');
            if (!usersRes.ok) throw new Error('Failed to fetch user data');
            if (!vouchersRes.ok) throw new Error('Failed to fetch voucher data');
            if (!profilesRes.ok) throw new Error('Failed to fetch profile data');

            const allPaymentsData: Payment[] = await paymentsRes.json();
            const allUsers: AdminUser[] = await usersRes.json();
            const allVouchers: HotspotVoucher[] = await vouchersRes.json();
            const allProfiles: HotspotProfile[] = await profilesRes.json();

            const loggedInUserDetails = allUsers.find(u => u.id === user.id);
            setCurrentUser(loggedInUserDetails || user);

            const vouchersMap = allVouchers.reduce((map, v) => {
                map[v.username] = v;
                return map;
            }, {} as Record<string, HotspotVoucher>);

            const profilesMap = allProfiles.reduce((map, p) => {
                map[p.name] = p;
                return map;
            }, {} as Record<string, HotspotProfile>);

            const resellerTransactions = allPaymentsData
                .filter(p => p.sold_by_user_id === user.id)
                .map((p): ResellerTransaction => {
                    if (p.invoiceId === 'Balance Top Up') {
                        return { ...p, transactionType: 'Balance Top Up' };
                    }
                    
                    const username = p.invoiceId.replace('Voucher: ', '');
                    const voucher = vouchersMap[username];
                    let basePrice = 0;
                    let profit = 0;
                    if (voucher) {
                        const profile = profilesMap[voucher.profile];
                        if (profile) {
                            basePrice = profile.price || 0;
                            profit = p.amount - basePrice;
                        }
                    }
                    return { ...p, transactionType: 'Voucher Sale', basePrice, profit, voucherDetails: voucher };
                })
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                
            setAllTransactions(resellerTransactions);

        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [user.id, user]);

    useEffect(() => {
        fetchData();
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const todayStr = new Date().toISOString().split('T')[0];
        setStartDate(firstDayOfMonth);
        setEndDate(todayStr);

    }, [fetchData]);
    
    const filteredTransactionsForTable = useMemo(() => {
        if (!startDate || !endDate) {
            return allTransactions;
        }
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);

        return allTransactions.filter(transaction => {
            const transactionDate = new Date(transaction.date);
            return transactionDate >= start && transactionDate <= end;
        });
    }, [allTransactions, startDate, endDate]);

    const summaryStats = useMemo(() => {
        return filteredTransactionsForTable.reduce(
            (acc, transaction) => {
                if (transaction.transactionType === 'Voucher Sale') {
                    acc.totalSalesCount++;
                    acc.totalRevenue += Number(transaction.amount) || 0;
                    acc.totalProfit += Number(transaction.profit) || 0;
                }
                return acc;
            },
            { totalSalesCount: 0, totalRevenue: 0, totalProfit: 0 }
        );
    }, [filteredTransactionsForTable]);


    if (isLoading) {
        return <p>Loading your transactions...</p>;
    }

    const inputClasses = "p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white";

    return (
        <div className="py-6 space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">My Transactions</h2>
            
            {error && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}

            <Card>
                <div className="flex flex-col sm:flex-row items-center gap-4 mb-4 border-b dark:border-gray-700 pb-4">
                    <div className="flex items-center gap-2">
                        <label htmlFor="startDate" className="text-sm font-medium">From:</label>
                        <input type="date" id="startDate" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputClasses} />
                    </div>
                    <div className="flex items-center gap-2">
                         <label htmlFor="endDate" className="text-sm font-medium">To:</label>
                        <input type="date" id="endDate" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputClasses} />
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard title="Voucher Terjual" value={summaryStats.totalSalesCount} />
                    <StatCard title="Total Penjualan" value={formatRupiah(summaryStats.totalRevenue)} />
                    <StatCard title="Total Laba" value={formatRupiah(summaryStats.totalProfit)} />
                    <StatCard title="Sisa Saldo" value={formatRupiah(Number(currentUser?.balance || 0))} />
                </div>
            </Card>

            <Card title="Transaction Details">
                 <div className="md:hidden space-y-3">
                    {filteredTransactionsForTable.length > 0 ? filteredTransactionsForTable.map(transaction => (
                        <div key={transaction.id} className="p-3 border dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className={`font-semibold ${transaction.transactionType === 'Balance Top Up' ? 'text-purple-600 dark:text-purple-400' : 'text-green-600 dark:text-green-400'}`}>
                                        {transaction.transactionType}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(transaction.date)}</p>
                                </div>
                                <p className="text-lg font-bold text-gray-800 dark:text-gray-200">{formatRupiah(transaction.amount)}</p>
                            </div>
                            <div className="mt-2 pt-2 border-t dark:border-gray-600 text-sm space-y-1">
                                <p className="text-gray-600 dark:text-gray-300">
                                    Details: <span className="font-mono">{transaction.transactionType === 'Voucher Sale' ? transaction.invoiceId.replace('Voucher: ', '') : transaction.invoiceId}</span>
                                </p>
                                {transaction.transactionType === 'Voucher Sale' && transaction.voucherDetails && (
                                    <>
                                        <p className="text-gray-600 dark:text-gray-300">
                                            Durasi: <span className="font-semibold">{formatDuration(transaction.voucherDetails.duration_minutes)}</span>
                                        </p>
                                        <p className="text-gray-600 dark:text-gray-300">
                                            First Login: <span className="font-semibold">{formatDateTimeDisplay(transaction.voucherDetails.first_used_at)}</span>
                                        </p>
                                    </>
                                )}
                                {transaction.transactionType === 'Voucher Sale' && (
                                     <p className="text-gray-600 dark:text-gray-300">
                                        Profit: <span className="font-semibold text-green-700 dark:text-green-400">{formatRupiah(transaction.profit || 0)}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    )) : (
                        <p className="text-center py-6 text-gray-500 dark:text-gray-400">No transactions found in this period.</p>
                    )}
                </div>

                 <div className="overflow-x-auto hidden md:block">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Details</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Durasi</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">First Login</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Harga Modal</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Laba</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredTransactionsForTable.length > 0 ? filteredTransactionsForTable.map(transaction => (
                                <tr key={transaction.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(transaction.date)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {transaction.transactionType === 'Voucher Sale' ? (
                                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
                                                Voucher Sale
                                            </span>
                                        ) : (
                                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">
                                                Balance Top Up
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-800 dark:text-gray-200">
                                        {transaction.transactionType === 'Voucher Sale' ? transaction.invoiceId.replace('Voucher: ', '') : transaction.invoiceId}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {transaction.transactionType === 'Voucher Sale' && transaction.voucherDetails
                                            ? formatDuration(transaction.voucherDetails.duration_minutes)
                                            : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                        {formatDateTimeDisplay(transaction.voucherDetails?.first_used_at)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{formatRupiah(transaction.amount)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{transaction.transactionType === 'Voucher Sale' ? formatRupiah(transaction.basePrice || 0) : 'N/A'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">{transaction.transactionType === 'Voucher Sale' ? formatRupiah(transaction.profit || 0) : 'N/A'}</td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={8} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                        No transactions found in this period.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

export default MyTransactions;