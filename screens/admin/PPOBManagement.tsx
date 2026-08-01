// screens/admin/PPOBManagement.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '../../components/api';
import { PPOBProduct } from '../../types'; // Asumsi tipe ini akan kita buat

const formatCurrency = (val: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(val);

interface DepositModalProps {
    isOpen: boolean;
    onClose: () => void;
    ticket: any;
    error: string | null;
    isLoading: boolean;
    amount: string;
    bank: string;
    ownerName: string;
    setAmount: (val: string) => void;
    setBank: (val: string) => void;
    setOwnerName: (val: string) => void;
    onSubmit: (e: React.FormEvent) => void;
}

const DepositModal: React.FC<DepositModalProps> = ({
    isOpen,
    onClose,
    ticket,
    error,
    isLoading,
    amount,
    bank,
    ownerName,
    setAmount,
    setBank,
    setOwnerName,
    onSubmit,
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md">
                <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-100">
                    {ticket ? 'Tiket Deposit Dibuat' : 'Buat Tiket Deposit Saldo'}
                </h2>

                {ticket ? (
                    <div>
                        <p className="text-gray-600 dark:text-gray-300 mb-4">
                            Silakan transfer sejumlah nominal di bawah ini ke rekening yang tertera.
                        </p>
                        <div className="space-y-3">
                            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
                                <label className="text-sm text-gray-500 dark:text-gray-400">Jumlah Transfer</label>
                                <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{formatCurrency(ticket.amount)}</p>
                            </div>
                            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
                                <label className="text-sm text-gray-500 dark:text-gray-400">Bank Tujuan</label>
                                <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">{ticket.bank}</p>
                            </div>
                            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
                                <label className="text-sm text-gray-500 dark:text-gray-400">Nomor Rekening</label>
                                <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">{ticket.account_no}</p>
                            </div>
                            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
                                <label className="text-sm text-gray-500 dark:text-gray-400">Berita Transfer</label>
                                <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">{ticket.notes}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="mt-6 w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                            Tutup
                        </button>
                    </div>
                ) : (
                    <form onSubmit={onSubmit}>
                        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Jumlah Deposit</label>
                                <input
                                    id="amount"
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="e.g., 50000"
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                />
                            </div>
                            <div>
                                <label htmlFor="bank" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Bank</label>
                                <select
                                    id="bank"
                                    value={bank}
                                    onChange={(e) => setBank(e.target.value)}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                >
                                    <option value="BCA">BCA (Perusahaan)</option>
                                    <option value="MANDIRI">MANDIRI (Perusahaan)</option>
                                    <option value="BRI">BRI (Perusahaan)</option>
                                    <option value="BNI">BNI (Perusahaan)</option>
                                    <option value="Flip">Flip (Perorangan)</option>
                                    <option value="ShopeePay">ShopeePay (Perorangan)</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="ownerName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nama Pemilik Rekening Pengirim</label>
                                <input
                                    id="ownerName"
                                    type="text"
                                    value={ownerName}
                                    onChange={(e) => setOwnerName(e.target.value)}
                                    placeholder="Nama sesuai buku tabungan"
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                />
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button type="button" onClick={onClose} className="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 font-bold py-2 px-4 rounded">
                                Batal
                            </button>
                            <button type="submit" disabled={isLoading} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50">
                                {isLoading ? 'Membuat...' : 'Buat Tiket'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};


const PPOBManagement: React.FC = () => {
    const [products, setProducts] = useState<PPOBProduct[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'prepaid' | 'postpaid'>('prepaid');
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [editingCode, setEditingCode] = useState<string | null>(null);
    const [editingPrice, setEditingPrice] = useState<string>('');
    const [editingStatus, setEditingStatus] = useState<'active' | 'inactive'>('active');
    const [isSavingPrice, setIsSavingPrice] = useState(false);
    const [adminBalance, setAdminBalance] = useState<string>('');
    const [isLoadingBalance, setIsLoadingBalance] = useState(false);
    const [balanceError, setBalanceError] = useState<string | null>(null);
    const [markupValue, setMarkupValue] = useState<string>('');
    const [isApplyingMarkup, setIsApplyingMarkup] = useState(false);
    const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
    // State untuk modal deposit
    const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
    const [depositAmount, setDepositAmount] = useState('');
    const [depositBank, setDepositBank] = useState('Flip');
    const [depositOwnerName, setDepositOwnerName] = useState('');
    const [isCreatingTicket, setIsCreatingTicket] = useState(false);
    const [depositError, setDepositError] = useState<string | null>(null);
    const [depositTicket, setDepositTicket] = useState<any>(null);


    const fetchProducts = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetchWithAuth('/api/ppob/admin/products');
            const data = await response.json();
            setProducts(data);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch products.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProducts();
        fetchBalance();
    }, [fetchProducts]);

    const fetchBalance = async () => {
        setIsLoadingBalance(true);
        setBalanceError(null);
        try {
            const res = await fetchWithAuth('/api/ppob/admin/balance');
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Gagal mengambil saldo Digiflazz.');
            setAdminBalance(typeof data.balance !== 'undefined' ? String(data.balance) : '');
        } catch (err: any) {
            setBalanceError(err.message);
        } finally {
            setIsLoadingBalance(false);
        }
    };

    const handleSync = async () => {
        setIsSyncing(true);
        setError(null);
        setSyncMessage(null);
        try {
            const response = await fetchWithAuth('/api/ppob/admin/sync', { method: 'POST' });
            const result = await response.json();
            setSyncMessage(result.message || 'Sync completed!');
            // Refresh product list after sync
            await fetchProducts();
        } catch (err: any) {
            setError(err.message || 'Failed to sync with Digiflazz.');
        } finally {
            setIsSyncing(false);
        }
    };

        const handleCreateDeposit = async (e: React.FormEvent) => {
        e.preventDefault();
        setDepositError(null);
        setIsCreatingTicket(true);
        setDepositTicket(null);

        try {
            const res = await fetchWithAuth('/api/ppob/admin/deposit', {
                method: 'POST',
                body: JSON.stringify({
                    amount: Number(depositAmount),
                    bank: depositBank,
                    owner_name: depositOwnerName,
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                const errorMsg = result?.data?.message || result.message || 'Terjadi kesalahan';
                throw new Error(errorMsg);
            }
            setDepositTicket(result.data);
            await fetchBalance(); // Refresh balance after creating ticket
        } catch (err: any) {
            setDepositError(err.message);
        } finally {
            setIsCreatingTicket(false);
        }
    };

    const openDepositModal = () => {
        setIsDepositModalOpen(true);
        setDepositAmount('');
        setDepositOwnerName('');
        setDepositBank('Flip');
        setDepositError(null);
        setDepositTicket(null);
    };

    const productType = (p: PPOBProduct) => {
        const raw = (p.product_type || p.category || '').toLowerCase();
        if (raw.includes('post')) return 'postpaid';
        return 'prepaid';
    };

    const categories = Array.from(new Set(products.map(p => p.category || 'Tidak ada kategori')));

    const filtered = products.filter(p => {
        if (productType(p) !== activeTab) return false;
        if (statusFilter === 'active' && !p.is_active) return false;
        if (statusFilter === 'inactive' && p.is_active) return false;
        if (categoryFilter !== 'all' && (p.category || 'Tidak ada kategori') !== categoryFilter) return false;
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            const hay = `${p.product_name} ${p.product_code} ${p.brand} ${p.category}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const startEdit = (p: PPOBProduct) => {
        setEditingCode(p.product_code);
        setEditingPrice(String(p.selling_price ?? p.price ?? ''));
        setEditingStatus(p.is_active ? 'active' : 'inactive');
    };

    const cancelEdit = () => {
        setEditingCode(null);
        setEditingPrice('');
        setEditingStatus('active');
    };

    const savePrice = async (product: PPOBProduct) => {
        const newPrice = Number(editingPrice);
        if (!isFinite(newPrice) || newPrice <= 0) {
            setError('Harga jual harus berupa angka lebih besar dari 0.');
            return;
        }
        setIsSavingPrice(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`/api/ppob/admin/products/${product.product_code}`, {
                method: 'PUT',
                body: JSON.stringify({ selling_price: newPrice, is_active: editingStatus === 'active' }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Gagal memperbarui harga jual.');

            // Update lokal
            setProducts(prev => prev.map(p => p.product_code === product.product_code ? { ...p, selling_price: newPrice, is_active: editingStatus === 'active' } : p));
            cancelEdit();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSavingPrice(false);
        }
    };

    const applyMarkupAll = async () => {
        const mark = Number(markupValue);
        if (!isFinite(mark)) {
            setError('Nilai markup harus berupa angka.');
            return;
        }
        setIsApplyingMarkup(true);
        setError(null);
        try {
            const targets = products.filter(p => productType(p) === activeTab);
            for (const p of targets) {
                const newSell = (Number(p.price) || 0) + mark;
                const res = await fetchWithAuth(`/api/ppob/admin/products/${p.product_code}`, {
                    method: 'PUT',
                    body: JSON.stringify({ selling_price: newSell }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || `Gagal update ${p.product_code}`);
            }
            await fetchProducts();
            setSyncMessage(`Markup diterapkan ke ${targets.length} produk di tab ${activeTab}.`);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsApplyingMarkup(false);
        }
    };

    const toggleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedCodes(filtered.map(p => p.product_code));
        } else {
            setSelectedCodes([]);
        }
    };

    const toggleSelectOne = (code: string, checked: boolean) => {
        setSelectedCodes(prev => checked ? Array.from(new Set([...prev, code])) : prev.filter(c => c !== code));
    };

    const handleBulkDelete = async () => {
        if (selectedCodes.length === 0) return;
        if (!window.confirm(`Hapus ${selectedCodes.length} produk PPOB terpilih?`)) return;
        setError(null);
        try {
            const res = await fetchWithAuth('/api/ppob/admin/products/bulk-delete', {
                method: 'POST',
                body: JSON.stringify({ product_codes: selectedCodes }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Gagal menghapus produk.');

            setProducts(prev => prev.filter(p => !selectedCodes.includes(p.product_code)));
            setSelectedCodes([]);
            setSyncMessage(data.message || 'Produk terpilih berhasil dihapus.');
        } catch (err: any) {
            setError(err.message);
        }
    };

    const allOnPageSelected = filtered.length > 0 && filtered.every(p => selectedCodes.includes(p.product_code));
    
    return (
        <div className="p-6 min-h-screen bg-gray-100 dark:bg-gray-900">
            <DepositModal
                isOpen={isDepositModalOpen}
                onClose={() => setIsDepositModalOpen(false)}
                ticket={depositTicket}
                error={depositError}
                isLoading={isCreatingTicket}
                amount={depositAmount}
                bank={depositBank}
                ownerName={depositOwnerName}
                setAmount={setDepositAmount}
                setBank={setDepositBank}
                setOwnerName={setDepositOwnerName}
                onSubmit={handleCreateDeposit}
            />
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-start mb-6 gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Manajemen Produk PPOB</h1>
                        <div className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2 mt-2">
                            <span>Saldo Digiflazz:</span>
                            {isLoadingBalance ? (
                                <span>Memuat...</span>
                            ) : adminBalance ? (
                                <span className="font-semibold text-green-700 dark:text-green-400">
                                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(adminBalance))}
                                </span>
                            ) : (
                                <span>Tidak tersedia</span>
                            )}
                            {balanceError && <span className="text-red-500 ml-2">{balanceError}</span>}
                        </div>
                    </div>
                    <div className="flex-shrink-0 flex gap-2">
                         <button
                            onClick={openDepositModal}
                            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow transition duration-300"
                        >
                            Isi Saldo
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={isSyncing || isLoading}
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSyncing ? 'Menyinkronkan...' : 'Sinkronkan dengan Digiflazz'}
                        </button>
                    </div>
                </div>

                {error && <div className="bg-red-100 dark:bg-red-900/40 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-100 px-4 py-3 rounded relative mb-4" role="alert">{error}</div>}
                {syncMessage && <div className="bg-green-100 dark:bg-green-900/40 border border-green-400 dark:border-green-600 text-green-700 dark:text-green-100 px-4 py-3 rounded relative mb-4" role="alert">{syncMessage}</div>}

                {isLoading ? (
                    <p className="text-center text-gray-500 dark:text-gray-300">Memuat produk...</p>
                ) : (
                    <div className="overflow-x-auto">
                        <div className="flex flex-wrap gap-2 mb-4">
                            <button
                                className={`px-3 py-1.5 text-sm font-semibold rounded ${activeTab === 'prepaid' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                                onClick={() => setActiveTab('prepaid')}
                            >
                                Prabayar ({products.filter(p => productType(p) === 'prepaid').length})
                            </button>
                            <button
                                className={`px-3 py-1.5 text-sm font-semibold rounded ${activeTab === 'postpaid' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                                onClick={() => setActiveTab('postpaid')}
                            >
                                Pascabayar ({products.filter(p => productType(p) === 'postpaid').length})
                            </button>
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Cari nama/kode/brand/kategori..."
                                className="flex-1 px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            />
                            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <option value="all">Semua Kategori</option>
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <option value="all">Semua Status</option>
                                <option value="active">Aktif</option>
                                <option value="inactive">Non-Aktif</option>
                            </select>
                            <div className="flex items-center gap-2 ml-auto">
                                <input
                                    type="number"
                                    value={markupValue}
                                    onChange={(e) => setMarkupValue(e.target.value)}
                                    placeholder="Markup (Rp)"
                                    className="w-32 px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                />
                                <button
                                    onClick={applyMarkupAll}
                                    disabled={isApplyingMarkup || isLoading}
                                    className="px-3 py-1.5 text-sm font-semibold rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                >
                                    {isApplyingMarkup ? 'Menerapkan...' : 'Terapkan Markup'}
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedCodes.length > 0 && (
                                <button
                                    onClick={handleBulkDelete}
                                    disabled={isLoading}
                                    className="px-3 py-1.5 text-sm font-semibold rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                                >
                                    Hapus Terpilih ({selectedCodes.length})
                                </button>
                            )}
                        </div>
                        <table className="min-w-full bg-white dark:bg-gray-800">
                            <thead className="bg-gray-800 text-white">
                                <tr>
                                    <th className="text-center py-3 px-4 uppercase font-semibold text-sm">
                                        <input
                                            type="checkbox"
                                            checked={allOnPageSelected}
                                            onChange={(e) => toggleSelectAll(e.target.checked)}
                                            className="h-4 w-4"
                                            aria-label="Pilih semua di tabel"
                                        />
                                    </th>
                                    <th className="text-left py-3 px-4 uppercase font-semibold text-sm">Nama Produk</th>
                                    <th className="text-left py-3 px-4 uppercase font-semibold text-sm">Kategori</th>
                                    <th className="text-left py-3 px-4 uppercase font-semibold text-sm">Brand</th>
                                    <th className="text-left py-3 px-4 uppercase font-semibold text-sm">Kode</th>
                                    <th className="text-right py-3 px-4 uppercase font-semibold text-sm">Harga Modal</th>
                                    <th className="text-right py-3 px-4 uppercase font-semibold text-sm">Harga Jual</th>
                                <th className="text-center py-3 px-6 uppercase font-semibold text-sm">Status</th>
                                    <th className="text-center py-3 px-4 uppercase font-semibold text-sm">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-700 dark:text-gray-200">
                                {filtered.map((product) => (
                                    <tr key={product.product_code} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700/60">
                                        <td className="py-3 px-4 text-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedCodes.includes(product.product_code)}
                                                onChange={(e) => toggleSelectOne(product.product_code, e.target.checked)}
                                                className="h-4 w-4"
                                                aria-label={`Pilih ${product.product_name}`}
                                            />
                                        </td>
                                        <td className="py-3 px-4">{product.product_name}</td>
                                        <td className="py-3 px-4">{product.category}</td>
                                        <td className="py-3 px-4">{product.brand}</td>
                                        <td className="py-3 px-4 font-mono text-sm">{product.product_code}</td>
                                        <td className="py-3 px-4 text-right">{formatCurrency(product.price)}</td>
                                        <td className="py-3 px-4 text-right font-semibold">
                                            {editingCode === product.product_code ? (
                                                <input
                                                    type="number"
                                                    className="w-28 text-right border px-2 py-1 rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    value={editingPrice}
                                                    onChange={(e) => setEditingPrice(e.target.value)}
                                                />
                                            ) : (
                                                formatCurrency(product.selling_price)
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            {editingCode === product.product_code ? (
                                                <select
                                                    value={editingStatus}
                                                    onChange={(e) => setEditingStatus(e.target.value as 'active' | 'inactive')}
                                                    className="px-2 py-1 text-xs border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                >
                                                    <option value="active">Aktif</option>
                                                    <option value="inactive">Non-Aktif</option>
                                                </select>
                                            ) : (
                                                <span className={`px-2 py-1 text-xs font-bold rounded-full ${product.is_active ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                                                    {product.is_active ? 'Aktif' : 'Non-Aktif'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            {editingCode === product.product_code ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => savePrice(product)}
                                                        disabled={isSavingPrice}
                                                        className="px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:opacity-50"
                                                    >
                                                        {isSavingPrice ? 'Saving...' : 'Save'}
                                                    </button>
                                                    <button onClick={cancelEdit} className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded">Cancel</button>
                                                </div>
                                            ) : (
                                                <button onClick={() => startEdit(product)} className="px-2 py-1 text-xs bg-yellow-300 text-yellow-900 rounded">Edit</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filtered.length === 0 && <p className="text-center py-4 text-gray-600 dark:text-gray-300">Belum ada produk di tab ini. Coba sinkronkan dengan Digiflazz.</p>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PPOBManagement;
