import React, { useState, useEffect, useMemo } from 'react';
// FIX: Import `HotspotVoucher` type to resolve 'Cannot find name' error.
import { Customer, HotspotProfile, Commission, TopupRequest, formatRupiah, formatDateTimeDisplay, HotspotVoucher } from '~/types';
import Card from '~/components/common/Card';
import { fetchWithAuth } from '~/components/api';
import PrintVouchers from '~/components/admin/PrintVouchers';

interface AffiliateData {
    balance: number;
    sellableProfiles: HotspotProfile[];
    transactions: (Commission | TopupRequest)[];
}

interface CustomerAffiliateProps {
    customer: Customer;
    affiliateData: AffiliateData | null;
    onRefresh: () => void;
}

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

// --- Sell Confirmation Modal Component ---
const ConfirmSellModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    profile: HotspotProfile | null;
    currentBalance: number;
    isSelling: boolean;
}> = ({ isOpen, onClose, onConfirm, profile, currentBalance, isSelling }) => {
    if (!isOpen || !profile) return null;

    const costPrice = profile.price || 0;
    const sellingPrice = profile.sellingPrice || 0;
    const profit = sellingPrice - costPrice;
    const remainingBalance = currentBalance - sellingPrice;

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-md">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Rincian Transaksi</h3>
                    <div className="mt-4 space-y-3 text-sm">
                        <p>Anda akan menjual voucher <span className="font-bold">{profile.name}</span>.</p>
                        <div className="border-t border-b border-gray-200 dark:border-gray-600 py-3 space-y-2">
                            <div className="flex justify-between"><span>Harga Jual ke Pelanggan:</span> <span className="font-semibold">{formatRupiah(sellingPrice)}</span></div>
                            <div className="flex justify-between"><span>Saldo Anda Saat Ini:</span> <span className="font-semibold">{formatRupiah(currentBalance)}</span></div>
                            <div className="flex justify-between text-green-600 dark:text-green-400"><span>Laba yang Anda Dapatkan:</span> <span className="font-semibold">+ {formatRupiah(profit)}</span></div>
                            <div className="flex justify-between text-red-600 dark:text-red-400"><span>Saldo Terpotong (Harga Jual):</span> <span className="font-semibold">- {formatRupiah(sellingPrice)}</span></div>
                        </div>
                        <div className="flex justify-between font-bold text-lg"><span>Sisa Saldo Afiliasi:</span> <span>{formatRupiah(remainingBalance)}</span></div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 pt-2">
                            Catatan: Laba dari penjualan ini akan diakumulasikan dan digunakan sebagai diskon pada tagihan internet bulanan Anda.
                        </p>
                    </div>
                    <div className="mt-6 flex justify-end space-x-2">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Batal</button>
                        <button onClick={onConfirm} disabled={isSelling} type="button" className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:bg-gray-400">
                            {isSelling ? 'Memproses...' : 'Ya, Jual Voucher'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


const CustomerAffiliate: React.FC<CustomerAffiliateProps> = ({ affiliateData, onRefresh }) => {
    const [topupAmount, setTopupAmount] = useState('');
    const [isProcessingTopup, setIsProcessingTopup] = useState(false);
    const [isSellingVoucher, setIsSellingVoucher] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [soldVoucher, setSoldVoucher] = useState<HotspotVoucher | null>(null);

    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [paymentChannels, setPaymentChannels] = useState<PaymentChannel[]>([]);
    const [isLoadingChannels, setIsLoadingChannels] = useState(true);
    const [profileToSell, setProfileToSell] = useState<HotspotProfile | null>(null);

     const totalProfit = useMemo(() => {
        if (!affiliateData?.transactions) return 0;
        return affiliateData.transactions.reduce((sum, tx) => {
            if ('profit_amount' in tx) {
                return sum + Number((tx as Commission).profit_amount || 0);
            }
            return sum;
        }, 0);
    }, [affiliateData]);

    useEffect(() => {
        const fetchChannels = async () => {
            setIsLoadingChannels(true);
            try {
                const res = await fetchWithAuth(`/api/public/payment-channels`);
                if (!res.ok) throw new Error('Gagal memuat metode pembayaran.');
                const channelsData: PaymentChannel[] = await res.json();
                
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
            } catch (e: any) {
                setError(e.message);
            } finally {
                setIsLoadingChannels(false);
            }
        };
        fetchChannels();
    }, []);

    const handleTopupRequest = () => {
        const amount = parseInt(topupAmount, 10);
        if (isNaN(amount) || amount <= 0) {
            setError('Silakan masukkan jumlah yang valid.');
            return;
        }
        setError(null);
        setIsPaymentModalOpen(true);
    };

    const handleConfirmTopup = async (method: string) => {
        if (!method) return;
        const amount = parseInt(topupAmount, 10);
        setIsPaymentModalOpen(false);
        setIsProcessingTopup(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`/api/customers/affiliate/request-topup`, {
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

    const handleConfirmSellVoucher = async () => {
        if (!profileToSell) return;

        setIsSellingVoucher(profileToSell.id);
        setError(null);
        try {
            const res = await fetchWithAuth(`/api/customers/affiliate/sell-voucher`, {
                method: 'POST',
                body: JSON.stringify({ profileId: profileToSell.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            setSoldVoucher(data);
            onRefresh(); // Refresh data to show new balance and transaction
        } catch (err: any) {
            setError(`Gagal menjual voucher: ${err.message}`);
        } finally {
            setIsSellingVoucher(null);
            setProfileToSell(null); // Close the modal
        }
    };

    if (!affiliateData) {
        return <div className="p-4">Loading affiliate data...</div>;
    }

    return (
        <div className="py-6 space-y-6">
            <PaymentMethodModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                onConfirm={handleConfirmTopup}
                channels={paymentChannels}
                isLoading={isLoadingChannels}
            />
            <ConfirmSellModal
                isOpen={!!profileToSell}
                onClose={() => setProfileToSell(null)}
                onConfirm={handleConfirmSellVoucher}
                profile={profileToSell}
                currentBalance={affiliateData.balance}
                isSelling={!!isSellingVoucher}
            />
            {soldVoucher && (
                <PrintVouchers
                    isOpen={!!soldVoucher}
                    onClose={() => setSoldVoucher(null)}
                    vouchers={[soldVoucher]}
                    appName="Voucher Internet"
                />
            )}
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Program Afiliasi</h2>
            {error && <div className="p-4 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-md shadow-sm">{error}</div>}

             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                    <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">Saldo Voucher Anda</h3>
                    <p className="text-4xl font-bold text-green-600 dark:text-green-400">{formatRupiah(affiliateData.balance)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Gunakan saldo ini untuk menjual voucher.</p>
                </Card>
                 <Card>
                    <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">Total Laba Anda</h3>
                    <p className="text-4xl font-bold text-teal-600 dark:text-teal-400">{formatRupiah(totalProfit)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Laba dari penjualan akan menjadi diskon tagihan bulanan Anda.</p>
                </Card>
            </div>


            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

                <Card title="Jual Voucher">
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                        {affiliateData.sellableProfiles.map(profile => {
                            const profit = (profile.sellingPrice || 0) - (profile.price || 0);
                            return (
                                <div key={profile.id} className="p-3 border rounded-lg bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center">
                                    <div>
                                        <h4 className="font-bold text-md text-gray-800 dark:text-gray-100">{profile.name}</h4>
                                        <p className="text-sm font-semibold text-green-600 dark:text-green-400">{formatRupiah(profile.sellingPrice || 0)}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Laba: {formatRupiah(profit)}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setProfileToSell(profile)}
                                        disabled={!!isSellingVoucher}
                                        className="bg-green-600 text-white px-3 py-1.5 rounded-md hover:bg-green-700 text-sm font-semibold shadow-sm transition-colors disabled:bg-gray-400"
                                    >
                                        {isSellingVoucher === profile.id ? '...' : 'Jual'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            </div>

            <Card title="Riwayat Transaksi Afiliasi">
                <div className="space-y-2">
                    {affiliateData.transactions.map((tx, index) => {
                        const isCommission = 'profit_amount' in tx;
                        return (
                            <div key={index} className="flex justify-between items-center p-2 border-b dark:border-gray-700">
                                <div>
                                    <p className="font-semibold">{isCommission ? `Penjualan Voucher (${(tx as Commission).voucher_username})` : 'Isi Saldo'}</p>
                                    <p className="text-xs text-gray-500">{formatDateTimeDisplay(tx.created_at)}</p>
                                </div>
                                <div className="text-right">
                                    <p className={`font-bold ${isCommission ? 'text-green-600' : 'text-blue-600'}`}>
                                        {isCommission ? `+${formatRupiah((tx as Commission).profit_amount)}` : `+${formatRupiah((tx as TopupRequest).amount)}`}
                                    </p>
                                    <p className="text-xs">{isCommission ? `Laba (${(tx as Commission).status})` : `Saldo (${(tx as TopupRequest).status})`}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Card>
        </div>
    );
};

export default CustomerAffiliate;