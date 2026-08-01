import React, { useState, useEffect, useCallback } from 'react';
import { AdminUser, HotspotProfile, HotspotVoucher, Payment, formatRupiah, ApiSettings, formatDateTimeDisplay, VoucherStatus, formatDuration } from '~/types';
import Card from '~/components/common/Card';
import PrintVouchers from '~/components/admin/PrintVouchers';
import Tag from '~/components/common/Tag';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

interface VoucherSalesProps {
    user: AdminUser;
}

type SaleDetail = Payment & {
    voucherDetails?: HotspotVoucher;
};

// --- Payment Modal Component ---
interface PaymentChannel {
    code: string;
    name: string;
    icon_url: string;
}

const PaymentMethodModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (method: string) => void;
    channels: PaymentChannel[];
    isLoading: boolean;
}> = ({ isOpen, onClose, onConfirm, channels, isLoading }) => {
    const [selectedMethod, setSelectedMethod] = useState<string>('');

    useEffect(() => {
        if (isOpen && channels.length > 0) {
            setSelectedMethod(channels[0].code);
        }
    }, [isOpen, channels]);

    if (!isOpen) return null;

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-md">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Pilih Metode Pembayaran</h3>
                    <div className="mt-4 space-y-3 max-h-80 overflow-y-auto pr-2">
                        {isLoading ? (
                            <p>Memuat metode pembayaran...</p>
                        ) : channels.length > 0 ? (
                            channels.map(channel => (
                                <div key={channel.code} onClick={() => setSelectedMethod(channel.code)} className={`p-3 border-2 rounded-lg flex items-center cursor-pointer ${selectedMethod === channel.code ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/50' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                    <input type="radio" name="payment-method" value={channel.code} checked={selectedMethod === channel.code} onChange={() => {}} className="h-4 w-4 text-blue-600" />
                                    <img src={channel.icon_url} alt={channel.name} className="h-6 w-auto mx-3 object-contain" />
                                    <span className="text-sm font-medium">{channel.name}</span>
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-gray-500">Tidak ada metode pembayaran yang tersedia saat ini.</p>
                        )}
                    </div>
                    <div className="mt-6 flex justify-end space-x-2">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Batal</button>
                        <button onClick={() => onConfirm(selectedMethod)} disabled={!selectedMethod || isLoading} type="button" className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:bg-gray-400">
                            Lanjutkan Pembayaran
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


const VoucherStatusTag: React.FC<{ status?: VoucherStatus }> = ({ status }) => {
    if (!status) return null;
    const colorMap: { [key in VoucherStatus]: 'blue' | 'green' | 'gray' } = {
        [VoucherStatus.New]: 'blue',
        [VoucherStatus.Active]: 'green',
        [VoucherStatus.Expired]: 'gray',
    };
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return <Tag color={colorMap[status]}>{label}</Tag>;
};


const VoucherSales: React.FC<VoucherSalesProps> = ({ user }) => {
    const [profiles, setProfiles] = useState<HotspotProfile[]>([]);
    const [mySales, setMySales] = useState<SaleDetail[]>([]);
    const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [vouchersToPrint, setVouchersToPrint] = useState<HotspotVoucher[]>([]);
    const [appName, setAppName] = useState('Internet Voucher');

    // State for the quantity modal
    const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState<HotspotProfile | null>(null);
    const [quantity, setQuantity] = useState('');
    
    // State for top-up
    const [topupAmount, setTopupAmount] = useState('');
    const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
    const [isProcessingTopup, setIsProcessingTopup] = useState(false);
    const [paymentChannels, setPaymentChannels] = useState<PaymentChannel[]>([]);
    const [isLoadingChannels, setIsLoadingChannels] = useState(true);


    const syncAndSetSales = useCallback(async (payments: Payment[]) => {
        try {
            // 1. Fetch the single source of truth for voucher status.
            const liveStatusRes = await fetchWithAuth(`${API_URL}/hotspot/vouchers/live-status`);
            if (!liveStatusRes.ok) throw new Error('Failed to sync live voucher status');
            const allLiveVouchers: HotspotVoucher[] = await liveStatusRes.json();

            // 2. Create a Map for efficient lookup by username.
            const liveVouchersMap = allLiveVouchers.reduce((acc, v) => {
                acc[v.username] = v;
                return acc;
            }, {} as Record<string, HotspotVoucher>);

            // 3. Map reseller's payments and enrich them with the up-to-date voucher details.
            const detailedSales: SaleDetail[] = payments.map(payment => {
                const username = payment.invoiceId.replace('Voucher: ', '');
                const voucherDetails = liveVouchersMap[username];
                return { ...payment, voucherDetails: voucherDetails || undefined };
            });
        
            setMySales(detailedSales);
        } catch (e: any) {
            console.error("Failed to sync and set sales data. Displaying potentially stale data.", e);
            const salesWithoutDetails: SaleDetail[] = payments.map(p => ({...p}));
            setMySales(salesWithoutDetails);
            setError("Could not sync live voucher status. Data may be out of date.");
        }
    }, []);

    const fetchAllData = useCallback(async () => {
        setError(null);
        try {
            const [profilesRes, paymentsRes, settingsRes, usersRes, channelsRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/hotspot/profiles`),
                fetchWithAuth(`${API_URL}/billing/payments`),
                fetchWithAuth(`${API_URL}/admin/settings`),
                fetchWithAuth(`${API_URL}/admin/users`),
                fetchWithAuth(`${API_URL}/public/payment-channels`),
            ]);

            if (!profilesRes.ok || !paymentsRes.ok || !settingsRes.ok || !usersRes.ok || !channelsRes.ok) {
                 throw new Error('Failed to load some required data.');
            }

            const allProfiles: HotspotProfile[] = await profilesRes.json();
            const allPayments: Payment[] = await paymentsRes.json();
            const settings: ApiSettings = await settingsRes.json();
            const allUsers: AdminUser[] = await usersRes.json();
            const channelsData: PaymentChannel[] = await channelsRes.json();

            const loggedInUserDetails = allUsers.find(u => u.id === user.id);
            setCurrentUser(loggedInUserDetails || user);

            const resellerPayments = allPayments
                .filter(p => p.sold_by_user_id === user.id)
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            
            setProfiles(allProfiles.filter(p => p.sellingPrice && p.sellingPrice > 0));
            setAppName(settings?.app?.appName || 'Internet Voucher');
            
            const ewalletOrder = ['QRIS', 'SHOPEEPAY', 'OVO', 'DANA', 'LINKAJA'];
            const sortedChannels = channelsData.sort((a, b) => {
                const aIsEwallet = ewalletOrder.includes(a.code);
                const bIsEwallet = ewalletOrder.includes(b.code);
                if (aIsEwallet && !bIsEwallet) return -1;
                if (!aIsEwallet && bIsEwallet) return 1;
                if (aIsEwallet && bIsEwallet) return ewalletOrder.indexOf(a.code) - ewalletOrder.indexOf(b.code);
                return a.name.localeCompare(b.name);
            });
            setPaymentChannels(sortedChannels);
            setIsLoadingChannels(false);

            await syncAndSetSales(resellerPayments);

        } catch (err: any) {
            setError(err.message);
        }
    }, [user.id, user, syncAndSetSales]);

    useEffect(() => {
        setIsLoading(true);
        fetchAllData().finally(() => setIsLoading(false));
    }, [fetchAllData]);

    const handleOpenQuantityModal = (profile: HotspotProfile) => {
        setSelectedProfile(profile);
        setQuantity('1');
        setIsQuantityModalOpen(true);
        setError(null);
    };

    const handleConfirmSale = async () => {
        const numericQuantity = parseInt(quantity, 10) || 0;
        if (!selectedProfile || numericQuantity <= 0) return;

        setIsGenerating(true);
        setError(null);

        try {
            const res = await fetchWithAuth(`${API_URL}/hotspot/vouchers/bulk-reseller`, {
                method: 'POST',
                body: JSON.stringify({
                    profileName: selectedProfile.name,
                    quantity: numericQuantity,
                    soldByUserId: user.id,
                }),
            });
            
            const responseData = await res.json();
            if (!res.ok) throw new Error(responseData.message || 'Failed to generate vouchers.');

            const newVouchers: HotspotVoucher[] = responseData;
            setVouchersToPrint(newVouchers);
            setIsQuantityModalOpen(false);
            await fetchAllData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsGenerating(false);
        }
    };
    
    const handleTopupRequest = () => {
        const amount = parseInt(topupAmount, 10);
        if (isNaN(amount) || amount <= 0) {
            setError('Silakan masukkan jumlah yang valid.');
            return;
        }
        setError(null);
        setIsTopupModalOpen(true);
    };

    const handleConfirmTopup = async (method: string) => {
        if (!method) return;
        const amount = parseInt(topupAmount, 10);
        setIsTopupModalOpen(false);
        setIsProcessingTopup(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`/api/reseller/request-topup`, {
                method: 'POST',
                body: JSON.stringify({ amount, method }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            window.location.href = data.paymentUrl;
        } catch (err: any) {
            setError(err.message);
            setIsProcessingTopup(false);
        }
    };

    const numericQuantity = parseInt(quantity, 10) || 0;
    const totalCost = selectedProfile ? (selectedProfile.price || 0) * numericQuantity : 0;
    const totalRevenue = selectedProfile ? (selectedProfile.sellingPrice || 0) * numericQuantity : 0;
    const totalProfit = totalRevenue - totalCost;
    const balance = Number(currentUser?.balance || 0);
    const hasSufficientBalance = balance >= totalCost;


    if (isLoading) return <p className="p-4 text-gray-500 dark:text-gray-400">Loading sales dashboard...</p>;

    return (
        <div className="py-6 space-y-6">
            <PaymentMethodModal
                isOpen={isTopupModalOpen}
                onClose={() => setIsTopupModalOpen(false)}
                onConfirm={handleConfirmTopup}
                channels={paymentChannels}
                isLoading={isLoadingChannels}
            />
            <PrintVouchers
                isOpen={vouchersToPrint.length > 0}
                onClose={() => setVouchersToPrint([])}
                vouchers={vouchersToPrint}
                appName={appName}
            />

            {isQuantityModalOpen && selectedProfile && (
                <div className="fixed z-30 inset-0 overflow-y-auto">
                    <div className="flex items-center justify-center min-h-screen p-4">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={() => setIsQuantityModalOpen(false)}></div>
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-sm">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Jual Voucher</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Profil: <strong>{selectedProfile.name}</strong></p>
                            <div className="mt-4 space-y-4">
                                <div>
                                    <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kuantitas</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        id="quantity"
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                                        className="mt-1 block w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>
                                
                                <div className="p-3 bg-gray-100 dark:bg-gray-700/50 rounded-md text-sm space-y-1">
                                    <div className="flex justify-between">
                                        <span>Total Penjualan:</span>
                                        <span className="font-semibold">{formatRupiah(totalRevenue)}</span>
                                    </div>
                                    <div className="flex justify-between text-blue-600 dark:text-blue-400">
                                        <span>Potongan Saldo (Modal):</span>
                                        <span className="font-semibold">-{formatRupiah(totalCost)}</span>
                                    </div>
                                    <div className="flex justify-between font-semibold text-green-600 dark:text-green-400">
                                        <span>Estimasi Laba:</span>
                                        <span>{formatRupiah(totalProfit)}</span>
                                    </div>
                                    <div className={`flex justify-between font-bold pt-1 border-t ${hasSufficientBalance ? 'text-gray-800 dark:text-gray-200' : 'text-red-600 dark:text-red-400'}`}>
                                        <span>Sisa Saldo Anda:</span>
                                        <span>{formatRupiah(balance - totalCost)}</span>
                                    </div>
                                </div>
                                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                            </div>
                            <div className="mt-6 flex justify-end space-x-2">
                                <button onClick={() => setIsQuantityModalOpen(false)} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Batal</button>
                                <button onClick={handleConfirmSale} disabled={isGenerating || !hasSufficientBalance || numericQuantity <= 0} type="button" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400">
                                    {isGenerating ? 'Memproses...' : 'Konfirmasi Jual'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Penjualan Voucher</h2>
            {error && !isQuantityModalOpen && !isTopupModalOpen && <div className="p-4 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-md shadow-sm">{error}</div>}
            
             <Card>
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">Saldo Saya</h3>
                <p className="text-4xl font-bold text-green-600 dark:text-green-400">{formatRupiah(Number(currentUser?.balance || 0))}</p>
            </Card>
            
            <Card title="Isi Saldo">
                <div className="space-y-4">
                    <div>
                        <label htmlFor="topupAmount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Jumlah (Rp)</label>
                        <input
                            type="number"
                            id="topupAmount"
                            value={topupAmount}
                            onChange={(e) => setTopupAmount(e.target.value)}
                            className="mt-1 w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600"
                            placeholder="e.g., 50000"
                        />
                    </div>
                    <button
                        onClick={handleTopupRequest}
                        disabled={isProcessingTopup}
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm transition-colors disabled:bg-blue-400"
                    >
                        {isProcessingTopup ? 'Memproses...' : 'Lanjutkan ke Pembayaran'}
                    </button>
                </div>
            </Card>

            <Card title="Tersedia untuk Dijual">
                <div className="grid grid-cols-2 gap-4">
                    {profiles.length > 0 ? (
                        profiles.map(profile => (
                            <div key={profile.id} className="p-3 border rounded-lg bg-gray-50 dark:bg-gray-700/50 flex flex-col justify-between shadow-sm">
                                <div>
                                    <h3 className="font-bold text-md text-gray-800 dark:text-gray-100 truncate" title={profile.name}>{profile.name}</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{formatDuration(profile.duration_minutes || 0)}</p>
                                    <p className="text-xl font-bold text-green-600 dark:text-green-400 my-1">{formatRupiah(profile.sellingPrice || 0)}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Modal: {formatRupiah(profile.price || 0)}</p>
                                </div>
                                <button
                                    onClick={() => handleOpenQuantityModal(profile)}
                                    disabled={isGenerating}
                                    className="w-full mt-2 bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 text-sm font-semibold shadow-sm transition-colors disabled:bg-gray-400"
                                >
                                    Jual
                                </button>
                            </div>
                        ))
                    ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400 col-span-full">
                            Tidak ada profil voucher yang tersedia untuk dijual. Harap minta administrator untuk mengatur "Harga Jual" di halaman Profil Hotspot.
                        </p>
                    )}
                </div>
            </Card>

            <Card title="Penjualan Terkini">
                 <div className="md:hidden space-y-3">
                    {mySales.length > 0 ? (
                        mySales.slice(0, 10).map(sale => (
                            <div key={sale.id} className="p-3 border dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-mono font-semibold text-gray-800 dark:text-gray-200">{sale.invoiceId.replace('Voucher: ', '')}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(sale.voucherDetails?.created_at)}</p>
                                    </div>
                                    <p className="text-lg font-bold text-green-600 dark:text-green-400">{formatRupiah(sale.amount)}</p>
                                </div>
                                <div className="mt-2 pt-2 border-t dark:border-gray-600 flex flex-col items-start gap-1 text-xs">
                                    <div className="flex justify-between w-full">
                                        <div className="flex items-center gap-2">
                                            <VoucherStatusTag status={sale.voucherDetails?.status} />
                                            {sale.voucherDetails?.active ? (
                                                <div className="flex items-center space-x-1 text-green-600 dark:text-green-400">
                                                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                                                    <span>Online</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center space-x-1 text-gray-500">
                                                    <span className="h-2 w-2 rounded-full bg-gray-400"></span>
                                                    <span>Offline</span>
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-gray-500 dark:text-gray-400">Login: {formatDateTimeDisplay(sale.voucherDetails?.first_used_at)}</span>
                                    </div>
                                    <span className="text-gray-500 dark:text-gray-400">Kedaluwarsa: {formatDateTimeDisplay(sale.voucherDetails?.expires_at)}</span>
                                </div>
                            </div>
                        ))
                    ) : (
                         <p className="text-center py-6 text-gray-500 dark:text-gray-400">Anda belum melakukan penjualan.</p>
                    )}
                </div>
                <div className="overflow-x-auto hidden md:block">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Kode Voucher</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status Live</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Dibuat Pada</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">First Login</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Kedaluwarsa Pada</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Jumlah</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {mySales.length > 0 ? (
                                mySales.slice(0, 10).map(sale => (
                                    <tr key={sale.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-gray-800 dark:text-gray-200">{sale.invoiceId.replace('Voucher: ', '')}</td>
                                        <td className="px-6 py-4 whitespace-nowrap"><VoucherStatusTag status={sale.voucherDetails?.status} /></td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {sale.voucherDetails?.active ? (
                                                <div className="flex items-center space-x-2">
                                                    <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse"></span>
                                                    <span className="text-sm font-medium text-green-600 dark:text-green-400">Online</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center space-x-2">
                                                    <span className="h-2.5 w-2.5 rounded-full bg-gray-400"></span>
                                                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Offline</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(sale.voucherDetails?.created_at)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(sale.voucherDetails?.first_used_at)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(sale.voucherDetails?.expires_at)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600 dark:text-green-400">{formatRupiah(sale.amount)}</td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={7} className="text-center py-6 text-gray-500 dark:text-gray-400">Anda belum melakukan penjualan.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

export default VoucherSales;