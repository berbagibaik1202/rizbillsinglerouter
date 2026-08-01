import React, { useState, useEffect, useMemo } from 'react';
import Card from '~/components/common/Card';
import { fetchWithAuth } from '~/components/api';
import { formatRupiah, formatDateTimeDisplay } from '~/types';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type ReportTab = 'overview' | 'resellers' | 'customers';

// --- Reseller Sales Detail Modal Component ---
interface ResellerSalesDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    resellerName: string;
    salesData: any[];
    isLoading: boolean;
}

const ResellerSalesDetailModal: React.FC<ResellerSalesDetailModalProps> = ({ isOpen, onClose, resellerName, salesData, isLoading }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-3xl max-h-[90vh] flex flex-col">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Sales Details</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">For Reseller: <span className="font-semibold">{resellerName}</span></p>
                        </div>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    
                    <div className="flex-grow overflow-y-auto">
                        {isLoading ? (
                            <p className="text-center p-8">Loading details...</p>
                        ) : salesData.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Sale Date</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Voucher Code</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Profile</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Selling Price</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Profit</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                        {salesData.map((sale, index) => (
                                            <tr key={index}>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(sale.saleDate)}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-800 dark:text-gray-200">{sale.username}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{sale.profile}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatRupiah(sale.sellingPrice)}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-green-600 dark:text-green-400">{formatRupiah(sale.profit)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-center p-8 text-gray-500 dark:text-gray-400">No voucher sales found for this reseller in the selected period.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};


const StatCard: React.FC<{ title: string; value: string; icon: React.ReactNode; }> = ({ title, value, icon }) => (
    <Card className="flex items-start">
        <div className="flex-shrink-0 mr-4">{icon}</div>
        <div className="flex-grow">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{title}</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
        </div>
    </Card>
);

const Reports: React.FC = () => {
    const [reportData, setReportData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<ReportTab>('overview');
    
    // State for reseller detail modal
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [selectedReseller, setSelectedReseller] = useState<{ resellerId: string; resellerName: string } | null>(null);
    const [resellerSalesDetails, setResellerSalesDetails] = useState([]);
    const [isDetailsLoading, setIsDetailsLoading] = useState(false);
    
    const [startDate, setStartDate] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => {
        const now = new Date();
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return lastDayOfMonth.toISOString().split('T')[0];
    });

    useEffect(() => {
        const fetchReportData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetchWithAuth(`/api/admin/reports?startDate=${startDate}&endDate=${endDate}`);
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'Failed to fetch report data.');
                }
                setReportData(await res.json());
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        if (startDate && endDate) {
            fetchReportData();
        }
    }, [startDate, endDate]);

    useEffect(() => {
        if (selectedReseller) {
            const fetchDetails = async () => {
                setIsDetailsLoading(true);
                try {
                    const res = await fetchWithAuth(`/api/admin/reports/reseller-sales?resellerId=${selectedReseller.resellerId}&startDate=${startDate}&endDate=${endDate}`);
                    if (!res.ok) throw new Error('Failed to fetch reseller sales details.');
                    setResellerSalesDetails(await res.json());
                } catch (err: any) {
                    setError((err as Error).message); // Show error in modal or main page
                } finally {
                    setIsDetailsLoading(false);
                }
            };
            fetchDetails();
        }
    }, [selectedReseller, startDate, endDate]);

    const handleCloseDetailModal = () => {
        setIsDetailModalOpen(false);
        setSelectedReseller(null);
        setResellerSalesDetails([]);
    };


    const lineChartData = useMemo(() => {
        if (!reportData?.charts?.monthlyRevenue) return { labels: [], datasets: [] };
        const labels = reportData.charts.monthlyRevenue.map((item: any) => {
            const [year, month] = item.month.split('-');
            const date = new Date(parseInt(year), parseInt(month) - 1);
            return date.toLocaleString('default', { month: 'short', year: 'numeric' });
        });
        const data = reportData.charts.monthlyRevenue.map((item: any) => item.total);
        return {
            labels,
            datasets: [{ label: 'Monthly Revenue', data, fill: true, backgroundColor: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgb(59, 130, 246)', tension: 0.3 }],
        };
    }, [reportData]);
    
    const barChartData = useMemo(() => {
        if (!reportData?.charts?.newCustomersByMonth) return { labels: [], datasets: [] };
        const labels = reportData.charts.newCustomersByMonth.map((item: any) => {
             const [year, month] = item.month.split('-');
            const date = new Date(parseInt(year), parseInt(month) - 1);
            return date.toLocaleString('default', { month: 'short', year: 'numeric' });
        });
        const data = reportData.charts.newCustomersByMonth.map((item: any) => item.count);
        return {
            labels,
            datasets: [{ label: 'New Customers', data, backgroundColor: 'rgba(22, 163, 74, 0.6)', borderColor: 'rgb(22, 163, 74)' }],
        };
    }, [reportData]);

    const chartOptions = (title: string, formatter: (val: any) => string) => ({
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { callback: formatter } } },
        plugins: { legend: { display: false }, title: { display: true, text: title, color: '#6b7280' } },
    });

    // Icons for Stat Cards
    const DollarIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 6v-1m0-1V4m0 2.01M12 14v4m0 2v-2m0-2.01M12 16.01V16m0 2.01V18m0 2v-2" /></svg>;
    const UserPlusIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-teal-500" viewBox="0 0 20 20" fill="currentColor"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 11a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1v-1z" /></svg>;
    const UsersIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21a6 6 0 00-9-5.197M15 11a4 4 0 110-5.292M12 4.354a4 4 0 010 5.292" /></svg>;
    const AlertIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
    const UserMinusIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-orange-500" viewBox="0 0 20 20" fill="currentColor"><path d="M12.5 5a3.5 3.5 0 10-7 0 3.5 3.5 0 007 0zM5 11a5 5 0 00-5 5v1h14v-1a5 5 0 00-5-5H5z" /><path d="M15 12H9a1 1 0 100 2h6a1 1 0 100-2z" /></svg>;

    const inputClasses = "p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 text-sm";
    
    const TabButton: React.FC<{ tab: ReportTab, label: string }> = ({ tab, label }) => (
        <button
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === tab ? 'bg-blue-600 text-white shadow' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
        >
            {label}
        </button>
    );

    return (
        <div className="space-y-6">
            <ResellerSalesDetailModal
                isOpen={isDetailModalOpen}
                onClose={handleCloseDetailModal}
                resellerName={selectedReseller?.resellerName || ''}
                salesData={resellerSalesDetails}
                isLoading={isDetailsLoading}
            />

            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Reports</h2>
            
            <Card>
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex flex-wrap gap-2">
                        <TabButton tab="overview" label="Financial Overview" />
                        <TabButton tab="resellers" label="Reseller Performance" />
                        <TabButton tab="customers" label="Customer Trends" />
                    </div>
                     <div className="flex items-center gap-2">
                        <label htmlFor="startDate" className="text-sm font-medium">From:</label>
                        <input type="date" id="startDate" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputClasses} />
                        <label htmlFor="endDate" className="text-sm font-medium">To:</label>
                        <input type="date" id="endDate" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputClasses} />
                    </div>
                </div>
            </Card>

            {isLoading ? (
                <p>Loading report data...</p>
            ) : error ? (
                <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>
            ) : !reportData ? (
                <p>No data available for the selected period.</p>
            ) : (
                <>
                    {activeTab === 'overview' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <StatCard title="Total Revenue" value={formatRupiah(reportData.kpi.totalRevenue)} icon={<DollarIcon />} />
                                <StatCard title="New Customers (in period)" value={reportData.kpi.newCustomers.toString()} icon={<UserPlusIcon />} />
                                <StatCard title="Total Active Customers" value={reportData.kpi.activeCustomers.toString()} icon={<UsersIcon />} />
                                <StatCard title="Unpaid Invoices" value={`${reportData.kpi.unpaidInvoices.count} (${formatRupiah(reportData.kpi.unpaidInvoices.amount)})`} icon={<AlertIcon />} />
                            </div>
                             <Card title="Revenue Trend (in period)">
                                <div className="h-80"><Line data={lineChartData} options={chartOptions('Monthly Revenue', (v) => formatRupiah(v)) as any} /></div>
                            </Card>
                        </div>
                    )}
                    
                    {activeTab === 'resellers' && (
                        <Card title="Reseller Leaderboard">
                             <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Reseller</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Vouchers Sold</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Sales</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Profit</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                        {reportData.tables?.resellerLeaderboard?.length > 0 ? (
                                            reportData.tables.resellerLeaderboard.map((reseller: any) => (
                                                <tr 
                                                    key={reseller.resellerId}
                                                    className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                                                    title="Click to view details"
                                                    onClick={() => {
                                                        setSelectedReseller({ resellerId: reseller.resellerId, resellerName: reseller.resellerName });
                                                        setIsDetailModalOpen(true);
                                                    }}
                                                >
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{reseller.resellerName}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{reseller.vouchersSold}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatRupiah(reseller.totalSales)}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600 dark:text-green-400">{formatRupiah(reseller.totalProfit)}</td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={4} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                                    No reseller data available for this period.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )}
                    
                    {activeTab === 'customers' && (
                        <div className="space-y-6">
                             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <StatCard title="New Customers (in period)" value={reportData.kpi.newCustomers.toString()} icon={<UserPlusIcon />} />
                                <StatCard title="Total Active Customers" value={reportData.kpi.activeCustomers.toString()} icon={<UsersIcon />} />
                                <StatCard title="Deactivated Customers" value={reportData.kpi.deactivatedCustomers.toString()} icon={<UserMinusIcon />} />
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card title="New Customer Growth">
                                    <div className="h-80"><Bar data={barChartData} options={chartOptions('New Customers', (v) => v) as any} /></div>
                                </Card>
                                <Card title="Package Popularity (All Active Customers)">
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                                <tr>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Package</th>
                                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Subscribers</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                                {reportData.tables?.packagePopularity?.length > 0 ? (
                                                    reportData.tables.packagePopularity.map((pkg: any) => (
                                                        <tr key={pkg.name}>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{pkg.name}</td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-sm">{pkg.customerCount}</td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    <tr>
                                                        <td colSpan={2} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                                            No package data available.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </Card>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default Reports;