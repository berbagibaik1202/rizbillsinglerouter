// screens/customer/PlnForm.tsx
import React, { useState, useMemo } from 'react';
import { fetchWithAuth } from '~/components/api';
import { PPOBProduct, formatRupiah } from '~/types';
import { summarizeBill } from './ppobBillHelpers';

interface PlnFormProps {
    products: PPOBProduct[];
    onTransactionSuccess: () => void;
    onClose?: () => void;
}

// Sub-component for Prabayar Form (tanpa inquiry)
const PrabayarForm: React.FC<PlnFormProps> = ({ products, onTransactionSuccess, onClose }) => {
    const [customerNo, setCustomerNo] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<PPOBProduct | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [purchaseError, setPurchaseError] = useState<string | null>(null);
    
    const prabayarProducts = products.filter(p => p.category.toUpperCase().includes('PLN') && !p.product_name.toUpperCase().includes('TAGIHAN'));

    const handlePurchase = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProduct || !customerNo) return;

        setIsSubmitting(true);
        setPurchaseError(null);

        try {
            const response = await fetchWithAuth('/api/ppob/purchase', {
                method: 'POST',
                body: JSON.stringify({
                    product_code: selectedProduct.product_code,
                    customer_no: customerNo,
                }),
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Transaction failed.');
            }
            
            alert('Transaction successful!');
            onTransactionSuccess();
        } catch (err: any) {
            setPurchaseError(err.message);
        } finally {
            setIsSubmitting(false);
            setSelectedProduct(null);
            setCustomerNo('');
            onClose?.();
            const historyAnchor = document.getElementById('ppob-history');
            if (historyAnchor) {
                historyAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };
    
    return (
         <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            {/* <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Beli Token Listrik (Prabayar)</h3> */}
            <form onSubmit={handlePurchase}>
                <div className="mb-4">
                    <label htmlFor="customerNo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nomor Meter/ID Pelanggan</label>
                    <input
                        type="tel"
                        id="customerNo"
                        value={customerNo}
                        onChange={(e) => setCustomerNo(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        placeholder="Contoh: 140123456789"
                        required
                        autoFocus
                    />
                </div>

                {purchaseError && <p className="text-red-500 text-sm mb-3">{purchaseError}</p>}

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pilih Nominal Token</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {prabayarProducts.map(product => (
                            <button
                                key={product.product_code}
                                type="button"
                                onClick={() => setSelectedProduct(product)}
                                className={`text-left p-3 rounded-lg shadow-md transition-all duration-200 ${selectedProduct?.product_code === product.product_code ? 'bg-indigo-600 text-white ring-2 ring-indigo-500' : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                            >
                                <div className="font-bold text-sm">{product.product_name}</div>
                                <div className="text-right text-md font-bold">{formatRupiah(product.selling_price)}</div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-4">
                    <button 
                        type="submit"
                        className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300"
                        disabled={isSubmitting || !customerNo || !selectedProduct}
                    >
                        {isSubmitting ? 'Memproses...' : 'Beli Sekarang'}
                    </button>
                </div>
            </form>
        </div>
        
    );
};

// Sub-component for Pascabayar Form
    const PascabayarForm: React.FC<PlnFormProps> = ({ products, onTransactionSuccess, onClose }) => {
        const [customerNo, setCustomerNo] = useState('');
        const [selectedProduct, setSelectedProduct] = useState<PPOBProduct | null>(null);
        const [isSubmitting, setIsSubmitting] = useState(false);
    const [purchaseError, setPurchaseError] = useState<string | null>(null);
        const [billInfo, setBillInfo] = useState<any>(null);
        const [isCheckingBill, setIsCheckingBill] = useState(false);
        const [checkBillError, setCheckBillError] = useState<string | null>(null);

    const billDisplay = useMemo(() => summarizeBill(billInfo), [billInfo]);
    const descDetails = billDisplay?.descDetails ?? {};
    const meterDetail = billDisplay?.detailList?.[0] ?? {};

    // Cari produk pascabayar PLN; hindari SKU non-tag (PLNONTAG)
    // Prefer specific PLN pascabayar SKU jika tersedia
    const skuPriority = ['PLN', 'PLNPASCABAYAR', 'PLNPASCA', 'PLNPASCA1', 'PLNPASCA2', 'PLNPOST', 'PLNPOSTPAID'];

    const pascaCandidates = products
        .filter(p => (p.product_type || '').toLowerCase().includes('post'))
        .filter(p => (p.category || '').toUpperCase().includes('PLN'))
        .filter(p => {
            const code = (p.product_code || '').toUpperCase();
            const name = (p.product_name || '').toUpperCase();
            return !code.includes('ONTAG') && !name.includes('NONTAG');
        });

    const overrideSku = 'PLN';
    const explicitMatch = products.find(p => (p.product_code || '').toUpperCase() === overrideSku);
    const pascabayarProduct =
        explicitMatch ||
        pascaCandidates.find(p => skuPriority.includes((p.product_code || '').toUpperCase())) ||
        pascaCandidates.find(p => (p.product_name || '').toUpperCase().includes('TAGIHAN')) ||
        pascaCandidates[0] ||
        null;

    const handleCheckBill = async () => {
        if (!pascabayarProduct) {
            setCheckBillError('Produk PLN pascabayar tidak tersedia.');
            return;
        }
        if (!customerNo) return;
        
        setIsCheckingBill(true);
        setCheckBillError(null);
        setBillInfo(null);

        try {
            const response = await fetchWithAuth('/api/ppob/check-bill', {
                method: 'POST',
                body: JSON.stringify({
                    product_code: pascabayarProduct.product_code,
                    customer_no: customerNo,
                }),
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Gagal mengecek tagihan.');
            }
            const status = (result.data?.status || '').toUpperCase();
            if (status === 'GAGAL' || status === 'FAILED') {
                throw new Error(result.data.message || 'Tagihan belum tersedia atau sudah terbayarkan.');
            }

            setBillInfo(result.data);
            setSelectedProduct(pascabayarProduct); // Set the product for purchase
        } catch (err: any) {
            setCheckBillError(err.message);
        } finally {
            setIsCheckingBill(false);
        }
    };

    React.useEffect(() => {
        if (billInfo?.customer_name) {
            console.log('[PascabayarForm] customer_name', billInfo.customer_name);
        }
    }, [billInfo]);

    const handlePurchase = async (e: React.FormEvent) => {
        e.preventDefault();
        // For pascabayar, the amount is determined by the bill
        if (!selectedProduct || !customerNo || !billInfo) return;

        setIsSubmitting(true);
        setPurchaseError(null);

        try {
            const payload: Record<string, unknown> = {
                product_code: selectedProduct.product_code,
                customer_no: customerNo,
            };
            if (billInfo?.ref_id) payload.bill_ref_id = billInfo.ref_id;
            
            // Menggunakan hasil kalkulasi dari `summarizeBill`
            if (billDisplay?.total) payload.bill_total_charge = billDisplay.total;
            if (billDisplay?.admin) payload.bill_admin = billDisplay.admin;

            // `selling_price` di sini adalah harga dasar dari tagihan (sebelum admin, dll)
            const sellingPrice = billInfo?.selling_price ?? billInfo?.price;
            if (sellingPrice) payload.bill_selling_price = sellingPrice;

             const response = await fetchWithAuth('/api/ppob/purchase', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Transaction failed.');
            }
            
            alert('Transaksi Anda sedang diproses. Status akan diperbarui secara otomatis.');
            onTransactionSuccess();
        } catch (err: any) {
            setPurchaseError(err.message);
        } finally {
            setIsSubmitting(false);
            setSelectedProduct(null);
            setCustomerNo('');
            onClose?.();
            const historyAnchor = document.getElementById('ppob-history');
            if (historyAnchor) {
                historyAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };

    return (
         <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            {/* <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Bayar Tagihan Listrik</h3> */}
             <div className="mb-4">
                <label htmlFor="customerNoPascabayar" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ID Pelanggan</label>
                <div className="flex gap-0">
                    <input
                        type="tel"
                        id="customerNoPascabayar"
                        value={customerNo}
                        onChange={(e) => { setBillInfo(null); setCustomerNo(e.target.value); }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        placeholder="Contoh: 530123456789"
                        required
                    />
                    <button onClick={handleCheckBill} disabled={isCheckingBill || !customerNo} className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 whitespace-nowrap">
                        {isCheckingBill ? 'Mengecek...' : 'Cek Tagihan'}
                    </button>
                </div>
             </div>

            {checkBillError && <p className="text-red-500 text-sm my-3">{checkBillError}</p>}

            {billInfo && billDisplay && (
                <div className="mb-4">
                    <form onSubmit={handlePurchase}>
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 my-4 space-y-4">
                            <h4 className="font-bold text-gray-800 dark:text-gray-100">Detail Tagihan</h4>
                            <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                    <strong>Nama Pelanggan:</strong> {billInfo.customer_name || '-'}
                                </p>
                                {[
                                    { label: 'Periode', value: billDisplay.period },
                                    { label: 'Lembar Tagihan', value: descDetails.lembar_tagihan ?? '-' },
                                    { label: 'Tarif', value: descDetails.tarif || '-' },
                                    { label: 'Daya', value: descDetails.daya ?? '-' },
                                ].map((row) => (
                                    <div key={row.label} className="flex items-center justify-between">
                                        <span className="uppercase tracking-wider text-[10px] text-gray-500 dark:text-gray-400">{row.label}</span>
                                        <span className="font-semibold text-sm text-right text-gray-900 dark:text-gray-100">{row.value}</span>
                                    </div>
                                ))}
                                {billInfo.sn && (
                                    <div className="flex items-center justify-between">
                                        <span className="uppercase tracking-wider text-[10px] text-gray-500 dark:text-gray-400">SN</span>
                                        <span className="font-semibold text-sm text-right text-gray-900 dark:text-gray-100">{billInfo.sn}</span>
                                    </div>
                                )}
                                {meterDetail?.meter_awal && meterDetail?.meter_akhir && (
                                    <div className="flex items-center justify-between">
                                        <span className="uppercase tracking-wider text-[10px] text-gray-500 dark:text-gray-400">Detail Meter</span>
                                        <span className="font-semibold text-sm text-right text-gray-900 dark:text-gray-100">
                                            {meterDetail.meter_awal} - {meterDetail.meter_akhir}
                                        </span>
                                    </div>
                                )}
                                {[
                                    { label: 'Tagihan', value: formatRupiah(billDisplay.tagihan) },
                                    { label: 'Admin', value: formatRupiah(billDisplay.admin) },
                                    { label: 'Denda', value: formatRupiah(billDisplay.detailDendaSum) },
                                ].map((row) => (
                                    <div key={row.label} className="flex items-center justify-between">
                                        <span className="uppercase tracking-wider text-[10px] text-gray-500 dark:text-gray-400">{row.label}</span>
                                        <span className="font-semibold text-sm text-right text-gray-900 dark:text-gray-100">{row.value}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="pt-3 border-t border-dashed border-gray-200 dark:border-gray-700 text-lg font-bold text-indigo-700 dark:text-indigo-300">
                                Total Bayar: {formatRupiah(billDisplay.total)}
                            </div>
                        </div>

                        {purchaseError && <p className="text-red-500 text-sm mb-3">{purchaseError}</p>}

                        <div className="flex justify-end gap-3 mt-4">
                            <button
                                type="submit"
                                className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'Memproses...' : `Bayar Sekarang`}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};


// Main PlnForm Component
const PlnForm: React.FC<PlnFormProps> = ({ products, onTransactionSuccess, onClose }) => {
    const [activeTab, setActiveTab] = useState<'prabayar' | 'pascabayar'>('prabayar');

    return (
        <div>
            <div className="border-b border-gray-200 dark:border-gray-700 mb-4">
                <nav className="-mb-px flex w-full" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('prabayar')}
                        className={`flex-1 border-b-2 px-1 pb-4 text-sm font-medium text-center ${
                            activeTab === 'prabayar'
                                ? 'border-indigo-500 text-indigo-600'
                                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-300'
                        }`}
                    >
                        PLN Prabayar
                    </button>
                    <button
                        onClick={() => setActiveTab('pascabayar')}
                        className={`flex-1 border-b-2 px-1 pb-4 text-sm font-medium text-center ${
                            activeTab === 'pascabayar'
                                ? 'border-indigo-500 text-indigo-600'
                                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-300'
                        }`}
                    >
                        PLN Pascabayar
                    </button>
                </nav>
            </div>

            <div>
                {activeTab === 'prabayar'
                    ? <PrabayarForm products={products} onTransactionSuccess={onTransactionSuccess} onClose={onClose} />
                    : <PascabayarForm products={products} onTransactionSuccess={onTransactionSuccess} onClose={onClose} />
                }
            </div>
        </div>
    );
};

export default PlnForm;
