import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Card from '~/components/common/Card';
import type { AdminPage } from '~/screens/AdminDashboard';
import { CashMutation, formatRupiah, formatDateTimeDisplay } from '~/types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

interface DashboardSummary {
    serverTime: string;
    routerStatsEnabled: boolean;
    routerStats?: {
        pppoeOnline: number;
        hotspotOnline: number;
        onlineVouchers: number;
    };
    totals: {
        totalCustomers: number;
        activeCustomers: number;
        pendingRegistrations: number;
        revenueThisMonth: number;
        revenueLastMonth: number;
        expenseThisMonth: number;
        cashBalance: number;
        totalOverdue: { count: number; amount: number };
        totalUnpaid: { count: number; amount: number };
        resellerCount: number;
    };
    recentTransactions: CashMutation[];
}

const borderColorClasses = {
  blue: 'border-blue-500',
  green: 'border-green-500',
  yellow: 'border-yellow-500',
  red: 'border-red-500',
  purple: 'border-purple-500',
  teal: 'border-teal-500',
  indigo: 'border-indigo-500',
  pink: 'border-pink-500',
  orange: 'border-orange-500', // New color for Unpaid
};

const gradientColorClasses = {
  blue: 'from-blue-100 to-blue-50 dark:from-blue-700/50 dark:to-gray-700/30',
  green: 'from-green-100 to-green-50 dark:from-green-700/50 dark:to-gray-700/30',
  yellow: 'from-yellow-100 to-yellow-50 dark:from-yellow-700/50 dark:to-gray-700/30',
  red: 'from-red-100 to-red-50 dark:from-red-700/50 dark:to-gray-700/30',
  purple: 'from-purple-100 to-purple-50 dark:from-purple-700/50 dark:to-gray-700/30',
  teal: 'from-teal-100 to-teal-50 dark:from-teal-700/50 dark:to-gray-700/30',
  indigo: 'from-indigo-100 to-indigo-50 dark:from-indigo-700/50 dark:to-gray-700/30',
  pink: 'from-pink-100 to-pink-50 dark:from-pink-700/50 dark:to-gray-700/30',
  orange: 'from-orange-100 to-orange-50 dark:from-orange-700/50 dark:to-gray-700/30',
};

const iconColorClasses = {
  blue: 'text-blue-600 dark:text-blue-300',
  green: 'text-green-600 dark:text-green-300',
  yellow: 'text-yellow-600 dark:text-yellow-300',
  red: 'text-red-600 dark:text-red-300',
  purple: 'text-purple-600 dark:text-purple-300',
  teal: 'text-teal-600 dark:text-teal-300',
  indigo: 'text-indigo-600 dark:text-indigo-300',
  pink: 'text-pink-600 dark:text-pink-300',
  orange: 'text-orange-600 dark:text-orange-300',
};


const StatCard: React.FC<{ title: string; value: string; icon: React.ReactNode; color: keyof typeof borderColorClasses; subValue?: string; onClick?: () => void; isLoading?: boolean; }> = ({ title, value, icon, color, subValue, onClick, isLoading }) => (
    <button
        onClick={onClick}
        disabled={!onClick || isLoading}
        className={`w-full text-left transition-transform duration-200 ${onClick ? 'transform hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg' : 'cursor-default'}`}
    >
        <Card className={`flex items-start border-l-4 ${borderColorClasses[color]} bg-gradient-to-br ${gradientColorClasses[color]}`}>
            <div className={`flex-shrink-0 mr-4 ${iconColorClasses[color]}`}>{icon}</div>
            <div className="flex-grow min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{title}</p>
                {isLoading ? (
                    <div className="mt-2 h-7 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                ) : (
                    <p className="mt-1 text-2xl lg:text-xl font-semibold text-gray-900 dark:text-gray-100 break-all">{value}</p>
                )}
                {subValue && <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">{subValue}</p>}
            </div>
        </Card>
    </button>
);

const ServerTimeClock: React.FC = () => {
    const [time, setTime] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let timerId: number | undefined;

        const fetchAndStartClock = async () => {
            try {
                const res = await fetchWithAuth(`${API_URL}/admin/server-time`);
                if (!res.ok) throw new Error('Failed to fetch time');
                const data = await res.json();
                const serverTime = new Date(data.serverTime);
                setTime(serverTime);

                // Hapus interval yang mungkin sudah ada sebelumnya
                if (timerId) clearInterval(timerId);

                // Mulai interval baru untuk memperbarui jam setiap detik
                timerId = window.setInterval(() => {
                    setTime(prevTime => prevTime ? new Date(prevTime.getTime() + 1000) : null);
                }, 1000);

            } catch (err: any) {
                console.error("Failed to fetch server time:", err);
                setError("Failed to load time");
            }
        };

        fetchAndStartClock();

        // Fungsi cleanup untuk membersihkan interval saat komponen dilepas
        return () => {
            if (timerId) {
                clearInterval(timerId);
            }
        };
    }, []); // Array dependensi kosong memastikan ini hanya berjalan sekali saat komponen dimuat

    if (error) {
        return <span className="text-sm font-medium text-red-500 dark:text-red-400">{error}</span>;
    }

    if (!time) {
        return <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Loading server time...</span>;
    }

    return (
        <div className="text-right">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
                {time.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
        </div>
    );
};

const Dashboard: React.FC<{ setPage: (page: AdminPage) => void }> = ({ setPage }) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const fetchDashboardData = useCallback(async () => {
      setErrors([]);
      setIsInitialLoading(true);

      try {
          const res = await fetchWithAuth(`${API_URL}/admin/dashboard-summary`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
              throw new Error(data.message || 'Failed to load dashboard summary.');
          }

          setSummary(data as DashboardSummary);
      } catch (err: any) {
          setErrors([err.message || 'Failed to load dashboard summary.']);
      } finally {
          setIsInitialLoading(false);
      }
  }, []);

  useEffect(() => {
      fetchDashboardData();
  }, [fetchDashboardData]);
  
  const stats = useMemo(() => {
    const totalCustomers = summary?.totals.totalCustomers ?? 0;
    const activeCustomers = summary?.totals.activeCustomers ?? 0;
    const pendingRegistrations = summary?.totals.pendingRegistrations ?? 0;
    const revenueThisMonth = summary?.totals.revenueThisMonth ?? 0;
    const revenueLastMonth = summary?.totals.revenueLastMonth ?? 0;
    const expenseThisMonth = summary?.totals.expenseThisMonth ?? 0;
    const cashBalance = summary?.totals.cashBalance ?? 0;
    const totalOverdue = summary?.totals.totalOverdue ?? { count: 0, amount: 0 };
    const totalUnpaid = summary?.totals.totalUnpaid ?? { count: 0, amount: 0 };
    const resellerCount = summary?.totals.resellerCount ?? 0;
    const recentTransactions = summary?.recentTransactions ?? [];
    const onlinePppoe = summary?.routerStats?.pppoeOnline ?? 0;
    const onlineHotspot = summary?.routerStats?.hotspotOnline ?? 0;
    const onlineVouchers = summary?.routerStats?.onlineVouchers ?? 0;

    return {
        totalCustomers, activeCustomers, pendingRegistrations,
        revenueThisMonth, revenueLastMonth, expenseThisMonth, cashBalance, totalOverdue, totalUnpaid,
        onlinePppoe, onlineHotspot, onlineVouchers,
        resellerCount, recentTransactions
    };
  }, [summary]);

  // Icons for Stat Cards (color classes removed)
  const UsersIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21a6 6 0 00-9-5.197M15 11a4 4 0 110-5.292M12 4.354a4 4 0 010 5.292" /></svg>;
  const UserPlusIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 11a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1v-1z" /></svg>;
  const DollarIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 6v-1m0-1V4m0 2.01M12 14v4m0 2v-2m0-2.01M12 16.01V16m0 2.01V18m0 2v-2" /></svg>;
  const AlertIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
  const WifiIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.555a5.5 5.5 0 017.778 0M12 20.25a.75.75 0 100-1.5.75.75 0 000 1.5zM4.444 12.889a10 10 0 0115.112 0" /></svg>;
  const NetworkIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" /></svg>;
  const TicketIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5h14a2 2 0 012 2v3a2 2 0 000 4v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 000-4V7a2 2 0 012-2h14z" /></svg>;
  const ResellerIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" /></svg>;
  
  if (isInitialLoading) {
      return (
          <div className="text-center p-10">
              <p className="text-gray-600 dark:text-gray-400">Loading dashboard data...</p>
          </div>
      );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Dashboard Overview</h2>
      
      {errors.length > 0 && (
        <Card className="bg-red-50 dark:bg-red-900/40 border-red-500 border-l-4">
          <p className="font-bold text-red-700 dark:text-red-300">Data Loading Error</p>
          <ul className="list-disc list-inside text-sm text-red-600 dark:text-red-300">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      )}

      
      <>
          <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Router Connection:</span>
                  <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${summary?.routerStatsEnabled ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-900/50 dark:text-gray-300'}`}>
                      {summary ? (summary.routerStatsEnabled ? 'Online' : 'Unavailable') : 'Checking...'}
                  </span>
              </div>
              <ServerTimeClock />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-4">
              <StatCard title="Penerimaan Bulan Ini" value={formatRupiah(stats.revenueThisMonth)} icon={<DollarIcon />} color="green" onClick={() => setPage('transactions')} />
              <StatCard title="Pengeluaran Bulan Ini" value={formatRupiah(stats.expenseThisMonth)} icon={<DollarIcon />} color="red" onClick={() => setPage('transactions')} />
              <StatCard title="Saldo Kas" value={formatRupiah(stats.cashBalance)} icon={<DollarIcon />} color="blue" onClick={() => setPage('transactions')} />
              <StatCard title="Penerimaan Bulan Lalu" value={formatRupiah(stats.revenueLastMonth)} icon={<DollarIcon />} color="teal" onClick={() => setPage('transactions')} />
              <StatCard title="Overdue Invoices" value={stats.totalOverdue.count.toString()} subValue={formatRupiah(stats.totalOverdue.amount)} icon={<AlertIcon />} color="red" onClick={() => window.location.hash = 'admin/billing?status=Overdue'} />
              <StatCard title="Unpaid Invoices" value={stats.totalUnpaid.count.toString()} subValue={formatRupiah(stats.totalUnpaid.amount)} icon={<AlertIcon />} color="orange" onClick={() => window.location.hash = 'admin/billing?status=Unpaid'} />
              
              <StatCard title="Total Customers" value={stats.totalCustomers.toString()} icon={<UsersIcon />} color="blue" onClick={() => setPage('customers')} />
              <StatCard title="Active Customers" value={stats.activeCustomers.toString()} icon={<UsersIcon />} color="teal" onClick={() => window.location.hash = 'admin/customers?status=Active'} />
              <StatCard title="Pending Registrations" value={stats.pendingRegistrations.toString()} icon={<UserPlusIcon />} color="purple" onClick={() => window.location.hash = 'admin/customers?status=Unregister'} />
              
              <StatCard title="PPPoE Online" value={stats.onlinePppoe.toString()} subValue={summary?.routerStatsEnabled ? undefined : 'Live router data unavailable'} icon={<NetworkIcon />} color="indigo" onClick={() => setPage('pppoe_active')} />
              
              <StatCard title="Hotspot Online" value={stats.onlineHotspot.toString()} subValue={summary?.routerStatsEnabled ? undefined : 'Live router data unavailable'} icon={<WifiIcon />} color="pink" onClick={() => setPage('hotspot_active')} />
              <StatCard title="Online Vouchers" value={stats.onlineVouchers.toString()} subValue={summary?.routerStatsEnabled ? undefined : 'Live router data unavailable'} icon={<TicketIcon />} color="yellow" onClick={() => setPage('hotspot_vouchers')} />
              <StatCard title="Resellers" value={stats.resellerCount.toString()} icon={<ResellerIcon />} color="orange" onClick={() => setPage('users')} />
          </div>

          <Card title="Recent Cash Mutations">
              <div className="overflow-x-auto">
                  {stats.recentTransactions.length > 0 ? (
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                          <thead className="bg-gray-50 dark:bg-gray-700/50">
                              <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Description</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Method</th>
                              </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                              {stats.recentTransactions.map(tx => (
                                  <tr key={tx.id}>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(tx.date)}</td>
                                      <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold ${tx.direction === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                          {tx.direction === 'in' ? 'Cash In' : 'Cash Out'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                          {tx.customer_name || tx.user_name || tx.created_by_name || '-'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{tx.description || tx.category}</td>
                                      <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold ${tx.direction === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatRupiah(tx.amount)}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{tx.method || '-'}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  ) : (
                      <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">No recent transactions found.</p>
                  )}
              </div>
          </Card>

      </>
      
    </div>
  );
};

export default Dashboard;
