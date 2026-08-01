// screens/customer/PulsaForm.tsx
import React, { useState, useEffect } from 'react'; // ✅ PERBAIKAN: Hapus useCallback yang tidak digunakan
import { fetchWithAuth } from '~/components/api';
import { PPOBProduct, formatRupiah } from '~/types';

interface PulsaFormProps {
  products?: PPOBProduct[]; // Make products optional
  onTransactionSuccess: () => void;
  onClose?: () => void;
}

const getProviderFromPrefix = (phone: string) => {
    let normalizedPhone = phone.trim();
    if (normalizedPhone.startsWith('+62')) {
        normalizedPhone = '0' + normalizedPhone.slice(3);
    } else if (normalizedPhone.startsWith('62')) {
        normalizedPhone = '0' + normalizedPhone.slice(2);
    }

    const telkomselPrefixes = ['0811', '0812', '0813', '0821', '0822', '0852', '0853', '0823', '0851'];
    const indosatPrefixes = ['0814', '0815', '0816', '0855', '0856', '0857', '0858'];
    const xlPrefixes = ['0817', '0818', '0819', '0859', '0877', '0878'];
    const axisPrefixes = ['0838', '0831', '0832', '0833'];
    const threePrefixes = ['0895', '0896', '0897', '0898', '0899'];
    const smartfrenPrefixes = ['0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889'];

    if (telkomselPrefixes.some(p => normalizedPhone.startsWith(p))) return 'TSEL';
    if (indosatPrefixes.some(p => normalizedPhone.startsWith(p))) return 'ISAT';
    if (xlPrefixes.some(p => normalizedPhone.startsWith(p))) return 'XL';
    if (axisPrefixes.some(p => normalizedPhone.startsWith(p))) return 'AXIS';
    if (threePrefixes.some(p => normalizedPhone.startsWith(p))) return 'TRI';
    if (smartfrenPrefixes.some(p => normalizedPhone.startsWith(p))) return 'SMART';

    return null;
}

const providerBrandMap: Record<string, string[]> = {
    TSEL: ['TSEL', 'TELKOMSEL'],
    ISAT: ['ISAT', 'INDOSAT', 'IM3'],
    XL: ['XL'],
    AXIS: ['AXIS'],
    TRI: ['TRI', '3'],
    SMART: ['SMART', 'SMARTFREN'],
};

const PulsaForm: React.FC<PulsaFormProps> = ({ products = [], onTransactionSuccess, onClose }) => {
    const [customerNo, setCustomerNo] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<PPOBProduct | null>(null);
    const [filteredProducts, setFilteredProducts] = useState<PPOBProduct[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [purchaseError, setPurchaseError] = useState<string | null>(null);

    useEffect(() => {
        if (customerNo.length >= 4) {
            const provider = getProviderFromPrefix(customerNo);
            if (provider) {
                const brandList = providerBrandMap[provider] || [provider];
                const providerProducts = products.filter(p => {
                    const brand = (p.brand || '').toUpperCase();
                    return brandList.some(b => brand.includes(b));
                });
                // urutkan dari harga termurah
                providerProducts.sort((a, b) => a.selling_price - b.selling_price);
                setFilteredProducts(providerProducts);
                setSelectedProduct(providerProducts[0] || null);
            } else {
                setFilteredProducts([]);
                setSelectedProduct(null);
            }
        } else {
            setFilteredProducts([]);
            setSelectedProduct(null);
        }
    }, [customerNo, products]);

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
            
            alert('Transaksi Anda sedang diproses. Status akan diperbarui secara otomatis.');
            onTransactionSuccess();
        } catch (err: any) {
            setPurchaseError(err.message);
            onTransactionSuccess();
            alert(err.message || 'Transaksi gagal.');
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
            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Isi Ulang Pulsa</h3>
            <form onSubmit={handlePurchase}>
                <div className="mb-4">
                    <label htmlFor="customerNo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nomor Handphone</label>
                    <input
                        type="tel"
                        id="customerNo"
                        value={customerNo}
                        onChange={(e) => setCustomerNo(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        placeholder="Contoh: 081234567890"
                        required
                        autoFocus
                    />
                </div>

                {filteredProducts.length > 0 && (
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pilih Nominal</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {filteredProducts.map(product => (
                                <button
                                    key={product.product_code}
                                    type="button"
                                    onClick={() => setSelectedProduct(product)}
                                    className={`text-left p-3 rounded-lg shadow-md transition-all duration-200 ${selectedProduct?.product_code === product.product_code ? 'bg-indigo-600 text-white ring-2 ring-indigo-500' : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                                >
                                    <div className="font-bold text-xs">{product.product_name}</div>
                                    <div className="text-xs font-bold text-gray-800 dark:text-gray-100 mb-1">{product.description}</div>
                                    <div className="text-right text-xs font-bold">{formatRupiah(product.selling_price)}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                
                {purchaseError && <p className="text-red-500 text-sm mb-3">{purchaseError}</p>}

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

export default PulsaForm;
