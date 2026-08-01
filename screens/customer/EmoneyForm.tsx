import React, { useMemo, useState } from 'react';
import { fetchWithAuth } from '~/components/api';
import { PPOBProduct, formatRupiah } from '~/types';

interface EmoneyFormProps {
    products: PPOBProduct[];
    onTransactionSuccess: () => void;
    title?: string;
    inputLabel?: string;
    inputPlaceholder?: string;
    onClose?: () => void;
}

const EmoneyForm: React.FC<EmoneyFormProps> = ({
    products,
    onTransactionSuccess,
    title,
    inputLabel,
    inputPlaceholder,
    onClose,
}) => {
    const [customerNo, setCustomerNo] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<PPOBProduct | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [purchaseError, setPurchaseError] = useState<string | null>(null);

    const sortedProducts = useMemo(
        () => [...products].sort((a, b) => (a.selling_price ?? a.price ?? 0) - (b.selling_price ?? b.price ?? 0)),
        [products]
    );

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
            {title && <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">{title}</h3>}
            <form onSubmit={handlePurchase}>
                <div className="mb-4">
                    <label htmlFor="emoneyCustomerNo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {inputLabel || 'ID/No Akun'}
                    </label>
                    <input
                        type="tel"
                        id="emoneyCustomerNo"
                        value={customerNo}
                        onChange={(e) => setCustomerNo(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        placeholder={inputPlaceholder || 'Contoh: 081234567890'}
                        required
                        autoFocus
                    />
                </div>

                {purchaseError && <p className="text-red-500 text-sm mb-3">{purchaseError}</p>}

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pilih Nominal</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {sortedProducts.map(product => (
                            <button
                                key={product.product_code}
                                type="button"
                                onClick={() => setSelectedProduct(product)}
                                className={`text-left p-3 rounded-lg shadow-md transition-all duration-200 ${selectedProduct?.product_code === product.product_code ? 'bg-indigo-600 text-white ring-2 ring-indigo-500' : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                            >
                                <div className="font-bold text-sm">{product.product_name}</div>
                                <div className="text-right text-md font-bold">{formatRupiah(product.selling_price ?? product.price ?? 0)}</div>
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

export default EmoneyForm;
