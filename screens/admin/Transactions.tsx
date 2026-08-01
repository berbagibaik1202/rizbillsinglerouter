import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Card from '../../components/common/Card';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import Tag from '~/components/common/Tag';
import { CashMutation, CashSummary, formatDateTimeDisplay, formatRupiah } from '../../types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

type DirectionFilter = 'all' | 'in' | 'out';

type MutationFormState = {
    date: string;
    direction: 'in' | 'out';
    category: string;
    amount: number;
    method: string;
    description: string;
};

const getInitialFormState = (): MutationFormState => ({
    date: new Date().toISOString().slice(0, 16),
    direction: 'out',
    category: 'operational',
    amount: 0,
    method: 'Cash',
    description: '',
});

const CashMutationModal: React.FC<{
    isOpen: boolean;
    isSaving: boolean;
    onClose: () => void;
    onSave: (data: MutationFormState) => void;
}> = ({ isOpen, isSaving, onClose, onSave }) => {
    const [formData, setFormData] = useState<MutationFormState>(getInitialFormState());

    useEffect(() => {
        if (isOpen) {
            setFormData(getInitialFormState());
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const inputClasses = 'mt-1 block w-full shadow-sm sm:text-sm rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white';

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'amount' ? Number(value) : value,
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.category || !formData.amount || formData.amount <= 0) {
            return;
        }
        onSave(formData);
    };

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80 transition-opacity" aria-hidden="true" onClick={onClose}></div>
                <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                <div className="inline-block align-bottom bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                    <form onSubmit={handleSubmit}>
                        <div className="bg-white dark:bg-gray-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                            <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100">Tambah Mutasi Kas</h3>
                            <div className="mt-4 space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tanggal</label>
                                        <input type="datetime-local" id="date" name="date" value={formData.date} onChange={handleInputChange} className={inputClasses} />
                                    </div>
                                    <div>
                                        <label htmlFor="direction" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Jenis</label>
                                        <select id="direction" name="direction" value={formData.direction} onChange={handleInputChange} className={inputClasses}>
                                            <option value="out">Kas Keluar</option>
                                            <option value="in">Kas Masuk</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kategori</label>
                                        <select id="category" name="category" value={formData.category} onChange={handleInputChange} className={inputClasses}>
                                            <option value="operational">Operational</option>
                                            <option value="supplier_payment">Supplier Payment</option>
                                            <option value="salary">Salary</option>
                                            <option value="transport">Transport</option>
                                            <option value="maintenance">Maintenance</option>
                                            <option value="refund">Refund</option>
                                            <option value="other_income">Other Income</option>
                                            <option value="other_expense">Other Expense</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="method" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Metode</label>
                                        <input type="text" id="method" name="method" value={formData.method} onChange={handleInputChange} className={inputClasses} />
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nominal</label>
                                    <input type="number" id="amount" name="amount" min="0" step="1" value={formData.amount} onChange={handleInputChange} className={inputClasses} />
                                </div>
                                <div>
                                    <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Keterangan</label>
                                    <textarea id="description" name="description" rows={3} value={formData.description} onChange={handleInputChange} className={inputClasses}></textarea>
                                </div>
                            </div>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                            <button type="submit" disabled={isSaving} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-blue-400">
                                {isSaving ? 'Saving...' : 'Save'}
                            </button>
                            <button type="button" onClick={onClose} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-500 shadow-sm px-4 py-2 bg-white dark:bg-gray-600 text-base font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-500 sm:mt-0 sm:w-auto sm:text-sm">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

const categoryLabel = (category: string) => category.replace(/_/g, ' ');
const toLocalDateInputValue = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const Transactions: React.FC = () => {
    const [transactions, setTransactions] = useState<CashMutation[]>([]);
    const [summary, setSummary] = useState<CashSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedTransactions, setSelectedTransactions] = useState<string[]>([]);
    const [deletingMode, setDeletingMode] = useState<'bulk' | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);

    const ITEMS_PER_PAGE = 20;

    const fetchData = useCallback(async () => {
        setError(null);
        try {
            const [mutationsRes, summaryRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/billing/cash-mutations${startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : ''}`),
                fetchWithAuth(`${API_URL}/billing/cash-summary`),
            ]);

            if (!mutationsRes.ok) throw new Error('Failed to fetch cash mutations.');
            if (!summaryRes.ok) throw new Error('Failed to fetch cash summary.');

            setTransactions(await mutationsRes.json());
            setSummary(await summaryRes.json());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [startDate, endDate]);

    useEffect(() => {
        const today = new Date();
        const firstDayOfMonth = toLocalDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
        const lastDayOfMonth = toLocalDateInputValue(new Date(today.getFullYear(), today.getMonth() + 1, 0));
        setStartDate(firstDayOfMonth);
        setEndDate(lastDayOfMonth);
    }, []);

    useEffect(() => {
        if (!startDate || !endDate) return;
        setIsLoading(true);
        fetchData();
    }, [fetchData, startDate, endDate]);

    const filteredTransactions = useMemo(() => {
        return transactions
            .filter(tx => directionFilter === 'all' || tx.direction === directionFilter)
            .filter(tx => {
                if (!searchQuery) return true;
                const lower = searchQuery.toLowerCase();
                return (
                    tx.id.toLowerCase().includes(lower) ||
                    String(tx.description || '').toLowerCase().includes(lower) ||
                    String(tx.customer_name || '').toLowerCase().includes(lower) ||
                    String(tx.user_name || '').toLowerCase().includes(lower) ||
                    String(tx.category || '').toLowerCase().includes(lower) ||
                    String(tx.method || '').toLowerCase().includes(lower)
                );
            });
    }, [transactions, directionFilter, searchQuery]);

    const periodTotals = useMemo(() => {
        return transactions.reduce((acc, tx) => {
            const amount = Number(tx.amount) || 0;
            if (tx.direction === 'in') acc.totalIn += amount;
            if (tx.direction === 'out') acc.totalOut += amount;
            return acc;
        }, { totalIn: 0, totalOut: 0 });
    }, [transactions]);

    const incomingByMethod = useMemo(() => {
        const totals = {
            cash: 0,
            transfer: 0,
            tripay: 0,
        };

        for (const tx of transactions) {
            if (tx.direction !== 'in') continue;

            const method = String(tx.method || '').toLowerCase();
            const amount = Number(tx.amount) || 0;

            if (method.includes('cash') || method.includes('tunai')) {
                totals.cash += amount;
                continue;
            }

            if (method.includes('transfer')) {
                totals.transfer += amount;
                continue;
            }

            if (method.includes('tripay') || method.includes('payment gateway')) {
                totals.tripay += amount;
            }
        }

        return totals;
    }, [transactions]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, directionFilter, startDate, endDate]);

    const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
    const paginatedTransactions = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredTransactions.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredTransactions, currentPage]);

    const handleSaveMutation = async (formData: MutationFormState) => {
        setIsSaving(true);
        setError(null);
        try {
            await fetchWithAuth(`${API_URL}/billing/cash-mutations`, {
                method: 'POST',
                body: JSON.stringify(formData),
            });
            setIsModalOpen(false);
            await fetchData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSelectOne = (tx: CashMutation) => {
        if (tx.source !== 'manual') return;
        setSelectedTransactions(prev => prev.includes(tx.id) ? prev.filter(id => id !== tx.id) : [...prev, tx.id]);
    };

    const handleSelectAllOnPage = (e: React.ChangeEvent<HTMLInputElement>) => {
        const pageIds = paginatedTransactions.filter(tx => tx.source === 'manual').map(tx => tx.id);
        if (e.target.checked) {
            setSelectedTransactions(prev => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedTransactions(prev => prev.filter(id => !pageIds.includes(id)));
        }
    };

    const areAllOnPageSelected = paginatedTransactions.filter(tx => tx.source === 'manual').length > 0
        && paginatedTransactions.filter(tx => tx.source === 'manual').every(tx => selectedTransactions.includes(tx.id));

    const confirmDelete = async () => {
        if (selectedTransactions.length === 0) return;
        setIsDeleting(true);
        try {
            await fetchWithAuth(`${API_URL}/billing/cash-mutations/bulk-delete`, {
                method: 'POST',
                body: JSON.stringify({ ids: selectedTransactions }),
            });
            setSelectedTransactions([]);
            await fetchData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setDeletingMode(null);
            setIsDeleting(false);
        }
    };

    if (isLoading) {
        return <p>Loading cash mutations...</p>;
    }

    return (
        <div className="space-y-6">
            <CashMutationModal isOpen={isModalOpen} isSaving={isSaving} onClose={() => setIsModalOpen(false)} onSave={handleSaveMutation} />
            <DeleteConfirmationModal isOpen={deletingMode === 'bulk'} onClose={() => setDeletingMode(null)} onConfirm={confirmDelete} itemName={`${selectedTransactions.length} mutation(s)`} itemType="cash mutation" isLoading={isDeleting} />

            <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Cash Mutations</h2>
                <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm">
                    Add Mutation
                </button>
            </div>

            {error && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <Card><p className="text-sm text-gray-500 dark:text-gray-400">Total Cash In (Periode Dipilih)</p><p className="mt-2 text-2xl font-bold text-green-600 dark:text-green-400">{formatRupiah(periodTotals.totalIn)}</p></Card>
                <Card><p className="text-sm text-gray-500 dark:text-gray-400">Total Cash Out (Periode Dipilih)</p><p className="mt-2 text-2xl font-bold text-red-600 dark:text-red-400">{formatRupiah(periodTotals.totalOut)}</p></Card>
                <Card><p className="text-sm text-gray-500 dark:text-gray-400">Saldo Bersih (Periode Dipilih)</p><p className={`mt-2 text-2xl font-bold ${periodTotals.totalIn - periodTotals.totalOut >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>{formatRupiah(periodTotals.totalIn - periodTotals.totalOut)}</p></Card>
                <Card><p className="text-sm text-gray-500 dark:text-gray-400">Cash Balance (Semua Waktu)</p><p className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">{formatRupiah(summary?.balance || 0)}</p></Card>
                <Card>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Uang Masuk per Metode</p>
                    <div className="mt-3 space-y-1.5 text-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-600 dark:text-gray-300">Cash</span>
                            <span className="font-semibold text-green-600 dark:text-green-400">{formatRupiah(incomingByMethod.cash)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-gray-600 dark:text-gray-300">Transfer</span>
                            <span className="font-semibold text-green-600 dark:text-green-400">{formatRupiah(incomingByMethod.transfer)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-gray-600 dark:text-gray-300">TriPay</span>
                            <span className="font-semibold text-green-600 dark:text-green-400">{formatRupiah(incomingByMethod.tripay)}</span>
                        </div>
                    </div>
                </Card>
            </div>

            <Card>
                <div className="p-4 border-b dark:border-gray-700 space-y-4">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4 flex-wrap">
                        <input type="text" placeholder="Search by ID, description, category..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-4 pr-4 py-2 border dark:border-gray-600 rounded-md w-full md:w-80 bg-white dark:bg-gray-800 dark:text-white" />
                        <div className="flex flex-wrap items-center gap-4">
                            <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value as DirectionFilter)} className="p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 text-sm">
                                <option value="all">All</option>
                                <option value="in">Cash In</option>
                                <option value="out">Cash Out</option>
                            </select>
                            <div className="flex items-center gap-2">
                                <label htmlFor="startDate" className="text-sm font-medium text-gray-600 dark:text-gray-300">From:</label>
                                <input type="date" id="startDate" value={startDate} onChange={e => setStartDate(e.target.value)} className="p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 text-sm" />
                            </div>
                            <div className="flex items-center gap-2">
                                <label htmlFor="endDate" className="text-sm font-medium text-gray-600 dark:text-gray-300">To:</label>
                                <input type="date" id="endDate" value={endDate} onChange={e => setEndDate(e.target.value)} className="p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 text-sm" />
                            </div>
                        </div>
                    </div>
                    {selectedTransactions.length > 0 && (
                        <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-md flex items-center gap-4">
                            <span className="text-sm font-semibold">{selectedTransactions.length} manual mutation(s) selected</span>
                            <button onClick={() => setDeletingMode('bulk')} disabled={isDeleting} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400">
                                Delete Selected
                            </button>
                        </div>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th className="p-4"><input type="checkbox" onChange={handleSelectAllOnPage} checked={areAllOnPageSelected} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" /></th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Direction</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Category</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Reference</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Description</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Method</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Source</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {paginatedTransactions.map(tx => (
                                <tr key={tx.id} className={selectedTransactions.includes(tx.id) ? 'bg-blue-50 dark:bg-blue-900/50' : ''}>
                                    <td className="p-4"><input type="checkbox" checked={selectedTransactions.includes(tx.id)} onChange={() => handleSelectOne(tx)} disabled={tx.source !== 'manual'} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:bg-gray-300 dark:disabled:bg-gray-600" /></td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(tx.date)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap"><Tag color={tx.direction === 'in' ? 'green' : 'red'}>{tx.direction === 'in' ? 'Cash In' : 'Cash Out'}</Tag></td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{categoryLabel(tx.category)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{tx.customer_name || tx.user_name || tx.created_by_name || tx.reference_id || '-'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{tx.description || '-'}</td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold ${tx.direction === 'in' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatRupiah(tx.amount)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{tx.method || '-'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap"><Tag color={tx.source === 'manual' ? 'yellow' : 'blue'}>{tx.source}</Tag></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-between p-4 border-t dark:border-gray-700">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredTransactions.length)} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredTransactions.length)} of {filteredTransactions.length} results</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">Previous</button>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Page {currentPage} of {totalPages > 0 ? totalPages : 1}</span>
                        <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages || totalPages === 0} className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">Next</button>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default Transactions;
