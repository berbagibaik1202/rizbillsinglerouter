// screens/customer/TopUpModal.tsx
import React, { useState, useEffect } from 'react';
import { fetchWithAuth } from '~/components/api';

interface PaymentChannel {
    code: string;
    name: string;
    icon_url: string;
}

interface TopUpModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void; // ✅ PERBAIKAN: Jadikan optional atau hapus jika tidak digunakan
}

const TopUpModal: React.FC<TopUpModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [amount, setAmount] = useState('');
    const [selectedMethod, setSelectedMethod] = useState<string>('');
    const [channels, setChannels] = useState<PaymentChannel[]>([]);
    const [isLoadingChannels, setIsLoadingChannels] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
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
                    setChannels(sortedChannels);
                    if (sortedChannels.length > 0) {
                        setSelectedMethod(sortedChannels[0].code);
                    }
                } catch (e: any) {
                    setError(e.message);
                } finally {
                    setIsLoadingChannels(false);
                }
            };
            fetchChannels();
        }
    }, [isOpen]);

    const handleTopUp = async () => {
        const topupAmount = parseInt(amount, 10);
        if (isNaN(topupAmount) || topupAmount <= 0) {
            setError('Silakan masukkan jumlah yang valid.');
            return;
        }
        if (!selectedMethod) {
            setError('Silakan pilih metode pembayaran.');
            return;
        }

        setIsProcessing(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`/api/customers/affiliate/request-topup`, {
                method: 'POST',
                body: JSON.stringify({ amount: topupAmount, method: selectedMethod }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            
            // Redirect to payment URL
            window.location.href = data.paymentUrl;
            
            // ✅ PERBAIKAN: Panggil onSuccess jika ada
            if (onSuccess) {
                onSuccess();
            }
            
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed z-50 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-lg">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Isi Saldo PPOB</h3>
                    
                    {error && <p className="text-red-500 bg-red-100 dark:bg-red-900/50 p-3 rounded-md mb-4">{error}</p>}

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="topupAmount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Jumlah Isi Saldo (Rp)</label>
                            <input
                                type="number"
                                id="topupAmount"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="mt-1 w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 dark:border-gray-600"
                                placeholder="Contoh: 50000"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Pilih Metode Pembayaran</label>
                            <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                                {isLoadingChannels ? (
                                    <p>Memuat metode pembayaran...</p>
                                ) : channels.length > 0 ? (
                                    channels.map(channel => (
                                        <div key={channel.code} onClick={() => setSelectedMethod(channel.code)} className={`p-3 border-2 rounded-lg flex items-center cursor-pointer ${selectedMethod === channel.code ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/50' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                            <input type="radio" name="payment-method" value={channel.code} checked={selectedMethod === channel.code} onChange={() => {}} className="h-4 w-4 text-indigo-600" />
                                            <img src={channel.icon_url} alt={channel.name} className="h-6 w-auto mx-4 object-contain" />
                                            <span className="text-sm font-medium">{channel.name}</span>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-sm text-gray-500">Metode pembayaran tidak tersedia.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Batal</button>
                        <button onClick={handleTopUp} disabled={isProcessing || isLoadingChannels} type="button" className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400">
                            {isProcessing ? 'Memproses...' : 'Lanjutkan ke Pembayaran'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TopUpModal;