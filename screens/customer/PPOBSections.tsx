// screens/customer/PPOBSections.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchWithAuth } from '~/components/api';
import { ApiSettings, PPOBProduct, formatDateTimeDisplay, formatRupiah } from '~/types';
import appLogo from '../../logo.png';
import { toPng } from 'html-to-image';
import { summarizeBill } from './ppobBillHelpers';
import PulsaForm from './PulsaForm';
import PlnForm from './PlnForm';
import TopUpModal from './TopUpModal';
import EmoneyForm from './EmoneyForm';

// Define the type for a single PPOB transaction
interface PPOBTransaction {
    id: number;
    transaction_ref_id: string;
    product_name: string;
    customer_no: string;
    selling_price: number;
    status: 'PENDING' | 'SUCCESS' | 'FAILED';
    message: string;
    created_at: string;
    product_type?: string;
    sn?: string; // Add sn to the interface
}

type GroupedProducts = Record<string, PPOBProduct[]>;
type GroupedByType = Record<'prepaid' | 'postpaid' | string, GroupedProducts>;

// --- Helper function to get an icon for a category ---
const getCategoryIcon = (category: string) => {
    const base = category.split(' - ')[0];
    const cat = base.toUpperCase();
    if (cat.includes('PULSA') || cat.includes('DATA')) return '📱';
    if (cat.includes('PLN') || cat.includes('LISTRIK') || cat.includes('TOKEN')) return '💡';
    if (cat.includes('GAME')) return '🎮';
    if (cat.includes('E-MONEY') || cat.includes('EMONEY') || cat.includes('WALLET')) return '💳';
    if (cat.includes('VOUCHER')) return '🎫';
    if (cat.includes('STREAM')) return '📡';
    if (cat.includes('SMS')) return '📧';
    if (cat.includes('TELP') || cat.includes('TELEPON') || cat.includes('VOICE')) return '📞';
    if (cat.includes('PDAM') || cat.includes('AIR')) return '🚰';
    if (cat.includes('BPJS')) return '🏥';
    if (cat.includes('TV')) return '📺';
    if (cat.includes('INTERNET') || cat.includes('TELKOM') || cat.includes('INDIHOME')) return '🌍';
    if (cat.includes('GAS')) return '⛽';
    if (cat.includes('MULTI') || cat.includes('FINANCE')) return '🏦';
    if (cat.includes('PBB')) return '🏠';
    if (cat.includes('HP') || cat.includes('HANDPHONE') || cat.includes('PASCABAYAR') || cat.includes('POSTPAID')) return '☎️';
    return '🧾';
};

const isEmoneyProduct = (product?: PPOBProduct | null) => {
    if (!product) return false;
    const text = `${product.category || ''} ${product.product_name || ''} ${product.brand || ''} ${product.product_code || ''}`.toUpperCase();
    const keywords = ['E-MONEY', 'EMONEY', 'E MONEY', 'WALLET', 'OVO', 'DANA', 'GOPAY', 'GOJEK', 'SHOPEE', 'SHOPEEPAY', 'LINKAJA', 'PAY'];
    return keywords.some(keyword => text.includes(keyword));
};

const EMONEY_BRANDS: Record<string, { letter: string; color: string }> = {
    OVO: { letter: 'O', color: '#5F259F' },
    DANA: { letter: 'D', color: '#007BFF' },
    GOPAY: { letter: 'G', color: '#00A8E0' },
    GOJEK: { letter: 'G', color: '#00AA13' },
    'GOPAY DRIVER': { letter: 'G', color: '#0099CC' },
    SHOPEE: { letter: 'S', color: '#FA6400' },
    SHOPEEPAY: { letter: 'S', color: '#FA6400' },
    LINKAJA: { letter: 'L', color: '#D6001C' },
    PAY: { letter: 'P', color: '#4B5563' },
};

const makeCircleLogo = (letter: string, color: string) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect x='4' y='4' width='56' height='56' rx='14' fill='${color}'/><text x='32' y='42' fill='#fff' font-family='Arial, sans-serif' font-weight='700' font-size='32' text-anchor='middle'>${letter}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

// URL logo eksternal per brand (case-insensitive terhadap brand/nama/SKU)
const EMONEY_LOGO_URLS: Record<string, string> = {
    OVO: 'https://upload.wikimedia.org/wikipedia/commons/5/5a/OVO_LOGO_PURPLE.png',
    OV: 'https://upload.wikimedia.org/wikipedia/commons/5/5a/OVO_LOGO_PURPLE.png',
    OVBS: 'https://upload.wikimedia.org/wikipedia/commons/5/5a/OVO_LOGO_PURPLE.png',
    DANA: 'https://upload.wikimedia.org/wikipedia/commons/b/b3/Logo_dana_blue.svg',
    DN: 'https://upload.wikimedia.org/wikipedia/commons/b/b3/Logo_dana_blue.svg',
    DNBS: 'https://upload.wikimedia.org/wikipedia/commons/b/b3/Logo_dana_blue.svg',
    GOPAY: 'https://upload.wikimedia.org/wikipedia/commons/1/16/GoPay_logo.svg',
    GP: 'https://upload.wikimedia.org/wikipedia/commons/1/16/GoPay_logo.svg',
    GPBS: 'https://upload.wikimedia.org/wikipedia/commons/1/16/GoPay_logo.svg',
    'GOPAY DRIVER': 'https://upload.wikimedia.org/wikipedia/commons/1/16/GoPay_logo.svg',
    GPD: 'https://upload.wikimedia.org/wikipedia/commons/1/16/GoPay_logo.svg',
    GOJEK: 'https://upload.wikimedia.org/wikipedia/commons/9/9d/Logo_Gojek_vector.svg',
    GJ: 'https://upload.wikimedia.org/wikipedia/commons/9/9d/Logo_Gojek_vector.svg',
    SHOPEE: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Shopee_logo.svg',
    SHOPEEPAY: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Shopee_logo.svg',
    SP: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Shopee_logo.svg',
    SPY: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Shopee_logo.svg',
    SPBS: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Shopee_logo.svg',
    SPYBS: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Shopee_logo.svg',
    LINKAJA: 'https://upload.wikimedia.org/wikipedia/commons/1/14/LinkAja%21_logo.png',
    LK: 'https://upload.wikimedia.org/wikipedia/commons/1/14/LinkAja%21_logo.png',
    LKBS: 'https://upload.wikimedia.org/wikipedia/commons/1/14/LinkAja%21_logo.png',
};

const getProductLogo = (product: PPOBProduct): string => {
    const p: any = product;
    const displayName = getEmoneyDisplayName(product).toUpperCase();
    const displayNormalized = displayName.replace(/[^A-Z0-9]/g, '');

    // Gabungkan brand/nama/KODE/kategori untuk pencocokan longgar
    const combinedKey = [
        product.brand,
        product.product_name,
        product.product_code,
        product.category,
        p?.desc?.brand,
        p?.description?.brand,
        displayName,
    ]
        .filter(Boolean)
        .join(' ')
        .toUpperCase();
    const combinedNormalized = combinedKey.replace(/[^A-Z0-9]/g, '');

    // Cocokkan langsung dari displayName
    if (EMONEY_LOGO_URLS[displayName]) {
        return EMONEY_LOGO_URLS[displayName];
    }
    const displayMatched = Object.keys(EMONEY_LOGO_URLS).find(key => {
        const upper = key.toUpperCase();
        const normalized = upper.replace(/[^A-Z0-9]/g, '');
        return displayName.includes(upper) || displayNormalized.includes(normalized);
    });
    if (displayMatched) {
        return EMONEY_LOGO_URLS[displayMatched];
    }

    // Mapping kode SKU -> brand untuk kasus produk tidak punya brand/nama yang jelas
    const codeCandidates = [
        (product.product_code || '').toUpperCase(),
        ((p && p.buyer_sku_code) || '').toUpperCase(),
    ].filter(Boolean);
    const codeBrand = (() => {
        for (const code of codeCandidates) {
            if (code.startsWith('OV')) return 'OVO';
            if (code.startsWith('DN')) return 'DANA';
            if (code.startsWith('GPD')) return 'GOPAY DRIVER';
            if (code.startsWith('GP')) return 'GOPAY';
            if (code.startsWith('GJ')) return 'GOJEK';
            if (code.startsWith('SP') || code.startsWith('SPY')) return 'SHOPEEPAY';
            if (code.startsWith('LK')) return 'LINKAJA';
            if (code.includes('PAY')) return 'PAY';
        }
        return null;
    })();
    if (codeBrand && EMONEY_LOGO_URLS[codeBrand]) {
        return EMONEY_LOGO_URLS[codeBrand];
    }

    // Coba cocokkan kata pertama dari nama produk ke logo
    const firstWord = (product.product_name || '').split(/\s+/)[0]?.toUpperCase();
    if (firstWord && EMONEY_LOGO_URLS[firstWord]) {
        return EMONEY_LOGO_URLS[firstWord];
    }

    const matchedLogoUrl = Object.keys(EMONEY_LOGO_URLS).find(key => {
        const upper = key.toUpperCase();
        const normalized = upper.replace(/[^A-Z0-9]/g, '');
        return combinedKey.includes(upper) || combinedNormalized.includes(normalized);
    });
    if (matchedLogoUrl && EMONEY_LOGO_URLS[matchedLogoUrl]) {
        return EMONEY_LOGO_URLS[matchedLogoUrl];
    }

    const matchedBrand = Object.keys(EMONEY_BRANDS).find(key => {
        const upper = key.toUpperCase();
        const normalized = upper.replace(/[^A-Z0-9]/g, '');
        return combinedKey.includes(upper) || combinedNormalized.includes(normalized);
    });
    if (matchedBrand) {
        const meta = EMONEY_BRANDS[matchedBrand];
        return makeCircleLogo(meta.letter || matchedBrand[0], meta.color);
    }

    return (
        // p.logo_url ||
        // p.image_url ||
        // p.icon ||
        // p.logo ||
        // p.desc?.logo_url ||
        // p.description?.logo_url ||
        // p.desc?.logo ||
        // p.description?.logo ||
        ''
    );
};

// Nama pendek yang ditampilkan untuk produk e-money (misal: OVO, DANA, SHOPEEPAY)
const getEmoneyDisplayName = (product: PPOBProduct): string => {
    const p: any = product;
    const combinedKey = [
        product.brand,
        product.product_name,
        product.product_code,
        product.category,
        p?.desc?.brand,
        p?.description?.brand,
    ]
        .filter(Boolean)
        .join(' ')
        .toUpperCase();
    const combinedNormalized = combinedKey.replace(/[^A-Z0-9]/g, '');

    const codeCandidates = [
        (product.product_code || '').toUpperCase(),
        ((p && p.buyer_sku_code) || '').toUpperCase(),
    ].filter(Boolean);
    const codeBrand = (() => {
        for (const code of codeCandidates) {
            if (code.startsWith('OV')) return 'OVO';
            if (code.startsWith('DN')) return 'DANA';
            if (code.startsWith('GPD')) return 'GOPAY DRIVER';
            if (code.startsWith('GP')) return 'GOPAY';
            if (code.startsWith('GJ')) return 'GOJEK';
            if (code.startsWith('SP') || code.startsWith('SPY')) return 'SHOPEEPAY';
            if (code.startsWith('LK')) return 'LINKAJA';
            if (code.includes('PAY')) return 'PAY';
        }
        return null;
    })();
    if (codeBrand) return codeBrand;

    const matchedBrand = Object.keys(EMONEY_BRANDS).find(key => {
        const upper = key.toUpperCase();
        const normalized = upper.replace(/[^A-Z0-9]/g, '');
        return combinedKey.includes(upper) || combinedNormalized.includes(normalized);
    });
    if (matchedBrand) return matchedBrand;

    const firstWord = (product.product_name || '').split(/\s+/)[0]?.toUpperCase();
    if (firstWord && EMONEY_BRANDS[firstWord]) return firstWord;

    return product.product_code || product.product_name || product.brand || 'E-MONEY';
};

// This modal is used for postpaid products that require inquiry before purchase
interface PostpaidInquiryModalProps {
    product: PPOBProduct;
    onClose: () => void;
    onSuccess: () => void;
}

const EmoneyPostpaidModal: React.FC<PostpaidInquiryModalProps> = ({ product, onClose, onSuccess }) => {
    const [customerNo, setCustomerNo] = useState('');
    const [amountInput, setAmountInput] = useState('');
    const [billInfo, setBillInfo] = useState<any>(null);
    const [isCheckingBill, setIsCheckingBill] = useState(false);
    const [checkError, setCheckError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [purchaseError, setPurchaseError] = useState<string | null>(null);
    const [refId, setRefId] = useState<string | null>(null);
    const [step, setStep] = useState<'inquiry' | 'payment'>('inquiry');

    const amountValue = useMemo(() => Number(amountInput.replace(/[^\d]/g, '')) || 0, [amountInput]);
    const billSummary = useMemo(() => summarizeBill(billInfo), [billInfo]);
    const isEmoneyBill = useMemo(() => isEmoneyProduct(product), [product]);
    const displayBill = useMemo(() => {
        if (!billSummary) return null;
        if (isEmoneyBill) {
            const tagihan = billSummary.tagihan > 0 ? billSummary.tagihan : billSummary.total;
            return { ...billSummary, admin: 0, total: tagihan, tagihan };
        }
        return billSummary;
    }, [billSummary, isEmoneyBill]);
    const resetToInquiry = () => {
        setBillInfo(null);
        setStep('inquiry');
    };

    const handleCheckBill = async () => {
        const trimmedCustomer = customerNo.trim();
        if (!trimmedCustomer) {
            setCheckError('ID Pelanggan wajib diisi.');
            return;
        }
        if (amountValue <= 0) {
            setCheckError('Nominal wajib diisi.');
            return;
        }
        setIsCheckingBill(true);
        setCheckError(null);
        setBillInfo(null);

        const generatedRef = `${Date.now()}`;

        try {
            const payload = {
                commands: 'inq-pasca',
                buyer_sku_code: product.product_code,
                product_code: product.product_code,
                customer_no: trimmedCustomer,
                ref_id: generatedRef,
                amount: amountValue,
                bill_amount: amountValue,
            };
            const response = await fetchWithAuth('/api/ppob/check-bill', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Gagal mengecek tagihan.');
            const payloadData = result.data;
            if (!payloadData) throw new Error('Data tagihan tidak ditemukan.');
            if ((payloadData.status || '').toUpperCase() === 'GAGAL') throw new Error(payloadData.message || 'Tagihan belum tersedia atau sudah terbayar.');

            setRefId(payloadData.ref_id || generatedRef);
            setBillInfo({ ...payloadData, amount: payloadData?.amount ?? amountValue });
            setStep('payment');
        } catch (err: any) {
            setCheckError(err.message);
        } finally {
            setIsCheckingBill(false);
        }
    };

    const handlePurchase = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!displayBill || displayBill.total <= 0 || !customerNo || amountValue <= 0) {
            setPurchaseError('Silakan cek tagihan terlebih dahulu.');
            return;
        }
        setIsSubmitting(true);
        setPurchaseError(null);

        try {
            const body: Record<string, unknown> = {
                product_code: product.product_code,
                customer_no: customerNo.trim(),
                bill_ref_id: billInfo?.ref_id || refId,
                bill_total_charge: displayBill.total,
                bill_selling_price: billInfo?.selling_price ?? billInfo?.price ?? amountValue,
                bill_admin: displayBill.admin,
                amount: amountValue,
                bill_amount: amountValue,
            };
            const response = await fetchWithAuth('/api/ppob/purchase', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Transaksi gagal.');
            // alert('Transaksi Anda sedang diproses. Status akan diperbarui secara otomatis.');
            onSuccess();
        } catch (err: any) {
            setPurchaseError(err.message);
        } finally {
            setIsSubmitting(false);
            setAmountInput('');
            setStep('inquiry');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{product.brand} - {product.product_name}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{product.category}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-300">✕</button>
                </div>
                <form onSubmit={handlePurchase} className="space-y-4 mt-4">
                    <div>
                        <label htmlFor="emoneyPostpaidCustomerNo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            ID Pelanggan
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="tel"
                                id="emoneyPostpaidCustomerNo"
                                value={customerNo}
                                onChange={(e) => {
                                    setCustomerNo(e.target.value);
                                    resetToInquiry();
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                placeholder="Masukkan ID Pelanggan"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Nominal
                        </label>
                        <input
                            type="tel"
                            inputMode="numeric"
                            value={amountInput}
                            onChange={(e) => {
                                const sanitized = e.target.value.replace(/[^\d]/g, '');
                                setAmountInput(sanitized);
                                resetToInquiry();
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            placeholder="Contoh: 25000"
                            required
                        />
                    </div>

                    {step === 'inquiry' && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={handleCheckBill}
                                disabled={isCheckingBill || !customerNo.trim() || amountValue <= 0}
                                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 whitespace-nowrap"
                            >
                                {isCheckingBill ? 'Mengirim...' : 'KIRIM'}
                            </button>
                        </div>
                    )}

                    {checkError && <p className="text-red-500 text-sm">{checkError}</p>}
                    {purchaseError && <p className="text-red-500 text-sm">{purchaseError}</p>}
                    {isSubmitting && (
                        <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-300">
                            <span className="h-4 w-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin"></span>
                            <span>Memproses pembayaran...</span>
                        </div>
                    )}

                    {step === 'payment' && displayBill && (
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Nama Pelanggan</span>
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{billInfo?.customer_name || '-'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Tagihan</span>
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{formatRupiah(displayBill.tagihan)}</span>
                            </div>
                            {!isEmoneyBill && (
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-500 dark:text-gray-400">Admin</span>
                                    <span className="font-semibold text-gray-900 dark:text-gray-100">{formatRupiah(displayBill.admin)}</span>
                                </div>
                            )}
                            <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-between text-base font-bold text-indigo-700 dark:text-indigo-300">
                                <span>Total Bayar</span>
                                <span>{formatRupiah(displayBill.total)}</span>
                            </div>
                        </div>
                    )}

                    {step === 'payment' && (
                        <div className="flex justify-end gap-3">
                            <button
                                type="submit"
                                disabled={isSubmitting || !customerNo || !displayBill}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300"
                            >
                                {isSubmitting ? 'Memproses...' : 'Ya Kirim'}
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
};

const PostpaidInquiryModal: React.FC<PostpaidInquiryModalProps> = ({ product, onClose, onSuccess }) => {
    const [customerNo, setCustomerNo] = useState('');
    const [billInfo, setBillInfo] = useState<any>(null);
    const [isCheckingBill, setIsCheckingBill] = useState(false);
    const [checkError, setCheckError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [purchaseError, setPurchaseError] = useState<string | null>(null);
    const [amountInput, setAmountInput] = useState('');

    const requiresAmount = useMemo(() => {
        const text = `${product.category || ''} ${product.product_name || ''} ${product.brand || ''} ${product.product_code || ''}`.toUpperCase();
        const walletKeywords = ['E-MONEY', 'EMONEY', 'E MONEY', 'WALLET', 'OVO', 'DANA', 'GOPAY', 'GOJEK', 'SHOPEE', 'SHOPEEPAY', 'LINKAJA', 'PAY'];
        return walletKeywords.some(keyword => text.includes(keyword));
    }, [product]);
    const amountValue = useMemo(() => Number(amountInput.replace(/[^\d]/g, '')) || 0, [amountInput]);

    const billSummary = useMemo(() => summarizeBill(billInfo), [billInfo]);
    const isEmoneyBill = useMemo(() => isEmoneyProduct(product), [product]);
    const displayBill = useMemo(() => {
        if (!billSummary) return null;
        if (isEmoneyBill) {
            const tagihan = billSummary.tagihan > 0 ? billSummary.tagihan : billSummary.total;
            return { ...billSummary, admin: 0, total: tagihan, tagihan };
        }
        return billSummary;
    }, [billSummary, isEmoneyBill]);

    const handleCheckBill = async () => {
        if (!customerNo) return;
        if (requiresAmount && amountValue <= 0) {
            setCheckError('Nominal wajib diisi untuk cek tagihan.');
            return;
        }
        setIsCheckingBill(true);
        setCheckError(null);
        setBillInfo(null);
        try {
            const payload: Record<string, unknown> = {
                product_code: product.product_code,
                customer_no: customerNo,
            };
            if (amountValue > 0) {
                payload.amount = amountValue;
            }
            const response = await fetchWithAuth('/api/ppob/check-bill', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Gagal mengecek tagihan.');
            const payloadData = result.data;
            if (!payloadData) throw new Error('Data tagihan tidak ditemukan.');
            if ((payloadData.status || '').toUpperCase() === 'GAGAL') throw new Error(payloadData.message || 'Tagihan belum tersedia atau sudah terbayar.');
            setBillInfo({ ...payloadData, amount: payloadData?.amount ?? (requiresAmount ? amountValue : undefined) });
        } catch (err: any) {
            setCheckError(err.message);
        } finally {
            setIsCheckingBill(false);
        }
    };

    const handlePurchase = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!displayBill || displayBill.total <= 0 || !customerNo) {
            setPurchaseError('Silakan cek tagihan terlebih dahulu.');
            return;
        }
        if (requiresAmount && amountValue <= 0) {
            setPurchaseError('Nominal wajib diisi untuk transaksi.');
            return;
        }
        setIsSubmitting(true);
        setPurchaseError(null);
        try {
            const body: Record<string, unknown> = {
                product_code: product.product_code,
                customer_no: customerNo,
                bill_ref_id: billInfo?.ref_id,
                bill_total_charge: displayBill.total,
                bill_selling_price: billInfo?.selling_price ?? billInfo?.price ?? (requiresAmount ? amountValue : undefined),
                bill_admin: displayBill.admin,
            };
            if (amountValue > 0) {
                body.amount = amountValue;
                body.bill_amount = amountValue;
            }
            const response = await fetchWithAuth('/api/ppob/purchase', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Transaksi gagal.');
            // alert('Transaksi Anda sedang diproses. Status akan diperbarui secara otomatis.');
            onSuccess();
        } catch (err: any) {
            setPurchaseError(err.message);
        } finally {
            setIsSubmitting(false);
            if (requiresAmount) setAmountInput('');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{product.brand} - {product.product_name}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{product.category}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-300">✕</button>
                </div>
                <form onSubmit={handlePurchase} className="space-y-4 mt-4">
                    <div>
                        <label htmlFor="postpaidCustomerNo" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            ID Pelanggan
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="tel"
                                id="postpaidCustomerNo"
                                value={customerNo}
                                onChange={(e) => setCustomerNo(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                placeholder="Masukkan ID Pelanggan"
                                required
                            />
                            <button
                                type="button"
                                onClick={handleCheckBill}
                                disabled={isCheckingBill || !customerNo || (requiresAmount && amountValue <= 0)}
                                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 whitespace-nowrap"
                            >
                                {isCheckingBill ? 'Mengecek...' : 'Cek Tagihan'}
                            </button>
                        </div>
                    </div>

                    {requiresAmount && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Nominal
                            </label>
                            <input
                                type="tel"
                                inputMode="numeric"
                                value={amountInput}
                                onChange={(e) => {
                                    const sanitized = e.target.value.replace(/[^\d]/g, '');
                                    setAmountInput(sanitized);
                                    setBillInfo(null);
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                placeholder="Contoh: 25000"
                            />
                        </div>
                    )}

                    {checkError && <p className="text-red-500 text-sm">{checkError}</p>}
                    {purchaseError && <p className="text-red-500 text-sm">{purchaseError}</p>}

                    {displayBill && (
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Nama Pelanggan</span>
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{billInfo?.customer_name || '-'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Periode</span>
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{displayBill.period || '-'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Tagihan</span>
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{formatRupiah(displayBill.tagihan)}</span>
                            </div>
                            {!isEmoneyBill && (
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-500 dark:text-gray-400">Admin</span>
                                    <span className="font-semibold text-gray-900 dark:text-gray-100">{formatRupiah(displayBill.admin)}</span>
                                </div>
                            )}
                            <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-between text-base font-bold text-indigo-700 dark:text-indigo-300">
                                <span>Total Bayar</span>
                                <span>{formatRupiah(displayBill.total)}</span>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-3">
                        <button
                            type="submit"
                            disabled={isSubmitting || !customerNo || !displayBill}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300"
                        >
                            {isSubmitting ? 'Memproses...' : 'Bayar Sekarang'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const getStatusChip = (status: PPOBTransaction['status']) => {
    switch (status) {
        case 'SUCCESS': return <span className="px-2 py-1 text-xs font-bold rounded-full bg-green-200 text-green-800">Success</span>;
        case 'FAILED': return <span className="px-2 py-1 text-xs font-bold rounded-full bg-red-200 text-red-800">Failed</span>;
        case 'PENDING': return <span className="px-2 py-1 text-xs font-bold rounded-full bg-yellow-200 text-yellow-800">Pending</span>;
        default: return <span className="px-2 py-1 text-xs font-bold rounded-full bg-gray-200 text-gray-800">{status}</span>;
    }
};

// Receipt Modal as a separate component for clarity
const ReceiptModal = ({
    transaction,
    onClose,
    appSettings,
}: {
    transaction: PPOBTransaction;
    onClose: () => void;
    appSettings?: ApiSettings['app'];
}) => {
    const [details, setDetails] = useState<any>(null);
    const [isSending, setIsSending] = useState(false);
    const [adminFeeInput, setAdminFeeInput] = useState('');
    const [isReceiptVisible, setIsReceiptVisible] = useState(false);
    const receiptRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (transaction?.message) {
            try {
                const parsed = JSON.parse(transaction.message);
                setDetails(parsed);
            } catch (e) {
                setDetails({ text: transaction.message }); // Fallback for old plain text format
            }
        } else {
            setDetails(null);
        }
    }, [transaction]);

    useEffect(() => {
        setIsReceiptVisible(false);
        setAdminFeeInput('');
    }, [transaction]);

    const ReceiptDetailRow = ({ label, value, mono }: { label: string; value: any; mono?: boolean }) => {
        if (value === null || value === undefined || value === '') return null;
        return (
            <div className="flex justify-between items-start gap-2">
                <span className="text-gray-500 dark:text-gray-400 text-xs flex-shrink-0">{label}</span>
                <span className={`font-semibold text-gray-800 dark:text-gray-100 text-sm text-right ${mono ? 'font-mono' : ''}`}>{String(value)}</span>
            </div>
        );
    };

    const getSerialNumber = () => {
        // 1. Check top-level transaction property
        if (transaction.sn) return transaction.sn;

        if (!details) return '-';

        // 2. Check top-level properties of parsed message
        if (details.sn) return details.sn;
        if (details.token) return details.token;

        // 3. Check 'data' property (common for API responses)
        if (details.data) {
            if (details.data.sn) return details.data.sn;
            if (details.data.token) return details.data.token;
        }

        // 4. Check 'desc' property
        if (details.desc) {
            if (details.desc.sn) return details.desc.sn;
            if (details.desc.token) return details.desc.token;
        }
        
        // 5. Regex fallback for plain text message
        const messageString = typeof details === 'string' ? details : details.text || details.message || transaction.message;
        if (typeof messageString === 'string') {
            const match = messageString.match(/(?:SN|TOKEN)[:\s]*([\d-]+)/i);
            if (match && match[1]) {
                // Check for very short matches that might be wrong
                if (match[1].replace(/-/g, '').length > 4) {
                    return match[1];
                }
            }
        }

        return '-';
    };

    const serialNumber = getSerialNumber();

    const desc = details?.desc;
    const descDetail = desc?.detail?.[0];
    const logoSrc = appSettings?.appLogoUrl?.trim() || appLogo;
    const basePrice = Number(transaction?.selling_price || 0);
    const adminFeeValue = Number(adminFeeInput.replace(/[^\d]/g, '')) || 0;
    const totalPay = basePrice + adminFeeValue;

    const handlePrintReceipt = () => {
        const printWindow = window.open('', '_blank', 'width=480,height=700');
        if (!printWindow) {
            alert('Popup diblokir. Izinkan popup untuk mencetak struk.');
            return;
        }

        const safe = (value: any) => String(value ?? '-');
        const title = appSettings?.appName || 'ISP Billing Pro';
        const address = appSettings?.companyAddress || 'Alamat belum diatur';
        const content = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Struk Transaksi</title>
  <style>
    @page { size: 58mm auto; margin: 0; }
    body { font-family: Arial, sans-serif; padding: 6mm 4mm; color: #111; width: 58mm; box-sizing: border-box; }
    .header { display: flex; gap: 12px; align-items: center; border-bottom: 1px dashed #ccc; padding-bottom: 12px; }
    .logo { width: 56px; height: 56px; object-fit: contain; background: #f3f4f6; border-radius: 8px; padding: 6px; }
    .title { font-size: 16px; font-weight: 700; margin: 0; }
    .addr { font-size: 11px; color: #555; margin: 2px 0 0 0; }
    .section { margin-top: 12px; }
    .row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 2px 0; }
    .label { color: #666; }
    .value { font-weight: 600; text-align: right; }
    .mono { font-family: 'Courier New', monospace; }
    .divider { border-top: 1px dashed #ccc; margin: 10px 0; }
    .footer { margin-top: 10px; font-size: 11px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <img src="${logoSrc}" alt="Logo" class="logo" />
    <div>
      <p class="title">${title}</p>
      <p class="addr">${address}</p>
    //   <p class="addr"><strong>Bukti Transaksi</strong></p>
    </div>
  </div>
  <div class="section">
    <div class="row"><span class="label">Tanggal</span><span class="value">${safe(formatDateTimeDisplay(transaction.created_at))}</span></div>
    <div class="row"><span class="label">Produk</span><span class="value">${safe(transaction.product_name)}</span></div>
    <div class="row"><span class="label">ID Pelanggan</span><span class="value mono">${safe(transaction.customer_no)}</span></div>
    <div class="row"><span class="label">Nama Pelanggan</span><span class="value">${safe(details?.customer_name)}</span></div>
    
    <div class="divider"></div>
    <div class="row"><span class="label">Periode</span><span class="value">${safe(details?.periode)}</span></div>
    <div class="row"><span class="label">Tarif/Daya</span><span class="value">${safe(desc?.tarif && desc?.daya ? `${desc.tarif} / ${desc.daya}VA` : '-')}</span></div>
    <div class="row"><span class="label">Lembar Tagihan</span><span class="value">${safe(desc?.lembar_tagihan)}</span></div>
    <div class="row"><span class="label">SN</span><span class="value mono">${safe(serialNumber)}</span></div>
    <div class="row"><span class="label">Meter Awal</span><span class="value mono">${safe(descDetail?.meter_awal)}</span></div>
    <div class="row"><span class="label">Meter Akhir</span><span class="value mono">${safe(descDetail?.meter_akhir)}</span></div>
    <div class="divider"></div>
    <div class="row"><span class="label">Total Tagihan</span><span class="value">${safe(formatRupiah(basePrice))}</span></div>
    <div class="row"><span class="label">Admin</span><span class="value">${safe(formatRupiah(adminFeeValue))}</span></div>
    <div class="row"><span class="label">Total Bayar</span><span class="value">${safe(formatRupiah(totalPay))}</span></div>
    <div class="row"><span class="label">Status</span><span class="value">${safe(transaction.status)}</span></div>
  </div>
  <div class="footer">
    <div>Terimakasi Sudah Menggunakan Layanan Kami, Ini merupakan bukti transaksi yang sah</div>
    <div class="mono">Ref: ${safe(transaction.transaction_ref_id)}</div>
  </div>
  <script>
    window.onload = function () {
      window.print();
      window.onafterprint = function () { window.close(); };
    };
  </script>
</body>
</html>`;

        printWindow.document.open();
        printWindow.document.write(content);
        printWindow.document.close();
    };

    const handleSendReceipt = async () => {
        if (!receiptRef.current) return;
        setIsSending(true);
        try {
            const dataUrl = await toPng(receiptRef.current, {
                cacheBust: true,
                pixelRatio: 2,
                backgroundColor: '#ffffff',
            });
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const filename = `struk-${transaction.transaction_ref_id || transaction.id}.png`;
            const file = new File([blob], filename, { type: 'image/png' });

            if (navigator.share && navigator.canShare?.({ files: [file] })) {
                await navigator.share({
                    title: 'Struk Transaksi',
                    files: [file],
                });
                return;
            }

            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            alert('Struk disimpan sebagai gambar. Silakan kirim dari galeri.');
        } catch (err) {
            console.error('Gagal mengirim struk:', err);
            alert('Gagal membuat gambar struk. Silakan coba lagi.');
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-6">
                <div className="flex justify-end mb-4">
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-300">✕</button>
                </div>
                {!isReceiptVisible && (
                    <div className="mb-3">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Admin</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            placeholder="0"
                        value={adminFeeInput}
                        onChange={(e) => {
                            const sanitized = e.target.value.replace(/[^\d]/g, '');
                            setAdminFeeInput(sanitized);
                        }}
                        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100"
                    />
                    </div>
                )}
                {isReceiptVisible && (
                    <div ref={receiptRef} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-2">
                        <div className="flex items-start gap-3 pb-2 border-b border-dashed border-gray-300 dark:border-gray-600">
                            {logoSrc ? (
                                <img
                                    src={logoSrc}
                                    alt="Logo Aplikasi"
                                    className="h-12 w-12 object-contain rounded-md bg-gray-100 dark:bg-gray-700 p-1"
                                />
                            ) : (
                                <div className="h-12 w-12 rounded-md bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 text-xs">
                                    Logo
                                </div>
                            )}
                            <div>
                                <p className="text-base font-bold text-gray-800 dark:text-gray-100">
                                    {appSettings?.appName || 'ISP Billing Pro'}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {appSettings?.companyAddress || 'Alamat belum diatur'}
                                </p>
                                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mt-1">Bukti Transaksi</p>
                            </div>
                        </div>
                        <ReceiptDetailRow label="Tanggal" value={formatDateTimeDisplay(transaction.created_at)} />
                        <ReceiptDetailRow label="Produk" value={transaction.product_name} />
                        <ReceiptDetailRow label="ID Pelanggan" value={transaction.customer_no} mono />
                        <ReceiptDetailRow label="Nama Pelanggan" value={details?.customer_name} />
                        <div className="border-t border-dashed border-gray-300 dark:border-gray-600 my-1"></div>
                        <ReceiptDetailRow label="Periode" value={details?.periode} />
                        <ReceiptDetailRow label="Tarif/Daya" value={desc?.tarif && desc?.daya ? `${desc.tarif} / ${desc.daya}VA` : null} />
                        <ReceiptDetailRow label="Lembar Tagihan" value={desc?.lembar_tagihan} />
                        <ReceiptDetailRow label="SN" value={serialNumber} mono />
                        <ReceiptDetailRow label="Meter Awal" value={descDetail?.meter_awal} mono />
                        <ReceiptDetailRow label="Meter Akhir" value={descDetail?.meter_akhir} mono />
                        <div className="border-t border-dashed border-gray-300 dark:border-gray-600 my-1"></div>
                        <ReceiptDetailRow label="Total Tagihan" value={formatRupiah(basePrice)} />
                        <ReceiptDetailRow label="Admin" value={formatRupiah(adminFeeValue)} />
                        <ReceiptDetailRow label="Total Bayar" value={formatRupiah(totalPay)} />
                        <div className="flex justify-between items-center">
                            <span className="text-gray-500 dark:text-gray-400 text-xs">Status</span>
                            {getStatusChip(transaction.status)}
                        </div>
                         <div className="text-center pt-2 border-t border-dashed border-gray-300 dark:border-gray-600">
                            {/* <p className="text-xs text-gray-500 dark:text-gray-400 break-words">{details?.text || transaction.message}</p> */}
                            <p className="text-xs text-gray-500 dark:text-gray-400 break-words">Terimakasi Sudah Menggunakan Layanan Kami, Ini merupakan bukti transaksi yang sah</p>
                            
                            <p className="font-mono text-xs text-gray-500 dark:text-gray-400">Ref: {transaction.transaction_ref_id || '-'}</p>
                        </div>
                    </div>
                )}
                <div className="mt-5 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm rounded-md bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100">Tutup</button>
                    {!isReceiptVisible ? (
                        <button
                            onClick={() => setIsReceiptVisible(true)}
                            className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                            Lihat Struk
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={handleSendReceipt}
                                disabled={isSending}
                                className="px-4 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                                {isSending ? 'Mengirim...' : 'Send Struk'}
                            </button>
                            <button
                                onClick={handlePrintReceipt}
                                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                            >
                                Print Struk
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

interface PPOBSectionsProps {
    appSettings?: ApiSettings['app'];
}

const PPOBSections: React.FC<PPOBSectionsProps> = ({ appSettings }) => {
    const [isAdmin, setIsAdmin] = useState(false);
    const [transactions, setTransactions] = useState<(PPOBTransaction & { customerName?: string })[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [groupedProducts, setGroupedProducts] = useState<GroupedByType>({});
    const [selectedProduct, setSelectedProduct] = useState<PPOBProduct | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [receiptTx, setReceiptTx] = useState<PPOBTransaction | null>(null);
    const [balance, setBalance] = useState<number>(0);
    const [isLoadingBalance, setIsLoadingBalance] = useState(true);
    const [showTopUpModal, setShowTopUpModal] = useState(false);
    const [refreshingRef, setRefreshingRef] = useState<string | null>(null);
    const [purchaseCustomerNo, setPurchaseCustomerNo] = useState('');
    const [purchaseError, setPurchaseError] = useState<string | null>(null);
    const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);
    const [postPurchaseLoading, setPostPurchaseLoading] = useState(false);
    const [emoneyTab, setEmoneyTab] = useState<'prepaid' | 'postpaid'>('prepaid');

    const historyRef = useRef<HTMLDivElement | null>(null);
    const postPurchaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const closeProductModal = () => {
        setSelectedProduct(null);
    };

    const [editingProduct] = useState<PPOBProduct | null>(null);

    const fetchBalance = useCallback(async () => {
        setIsLoadingBalance(true);
        try {
            const response = await fetchWithAuth('/api/customers/me');
            const data = await response.json();
            setBalance(data.voucher_balance || 0);
        } catch (err) {
            console.error("Failed to fetch balance", err);
        } finally {
            setIsLoadingBalance(false);
        }
    }, []);

    const fetchHistory = useCallback(async (): Promise<(PPOBTransaction & { customerName?: string })[] | undefined> => {
        setIsLoadingHistory(true);
        setHistoryError(null);
        try {
            const response = await fetchWithAuth('/api/ppob/transactions');
            const data = await response.json();
            const normalized = (Array.isArray(data) ? data : []).map((tx: PPOBTransaction) => {
                let status = tx.status;
                if (status === 'FAILED' && tx?.message) {
                    const msg = tx.message.toString();
                    const upper = msg.toUpperCase();
                    if (upper.includes('PENDING')) {
                        status = 'PENDING';
                    } else {
                        try {
                            const parsed = JSON.parse(msg);
                            const parsedStatus = (parsed?.status || parsed?.data?.status || '').toString().toUpperCase();
                            if (parsedStatus === 'PENDING') status = 'PENDING';
                        } catch {
                            /* ignore parse errors */
                        }
                    }
                }
                
                let customerName = '-';
                if (tx.message) {
                    try {
                        const details = JSON.parse(tx.message);
                        customerName = details?.customer_name 
                            || details?.name 
                            || details?.data?.customer_name 
                            || details?.data?.name 
                            || (details?.desc?.customer_name)
                            || '-';
                    } catch (e) {
                        // ignore
                    }
                }

                return { ...tx, status, customerName };
            });
            setTransactions(normalized);
            return normalized;
        } catch (err: any) {
            setHistoryError(err.message || 'Failed to fetch transaction history.');
        } finally {
            setIsLoadingHistory(false);
        }
    }, []);

    const fetchProducts = useCallback(async () => {
        try {
            const response = await fetchWithAuth('/api/ppob/products');
            const raw: GroupedByType = await response.json();
            setIsAdmin(false);
            setGroupedProducts(raw);
        } catch (err: any) {
        } finally {
        }
    }, []);

    useEffect(() => {
        fetchHistory();
        fetchProducts();
        fetchBalance();
    }, [fetchHistory, fetchProducts, fetchBalance]);

    useEffect(() => {
        return () => {
            if (postPurchaseTimer.current) clearTimeout(postPurchaseTimer.current);
        };
    }, []);

    useEffect(() => {
        setPurchaseCustomerNo('');
        setPurchaseError(null);
        setIsSubmittingPurchase(false);
    }, [selectedProduct]);

    const handleRefreshStatus = async (refId: string) => {
        try {
            setRefreshingRef(refId);
            const response = await fetchWithAuth(`/api/ppob/transactions/${refId}/refresh`, { method: 'POST' });
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.message || 'Failed to refresh status.');
            }
            await fetchHistory();
        } catch (err: any) {
            err.message || 'Failed to refresh status.';
        } finally {
            setRefreshingRef(null);
        }
    };

    // Auto-refresh pending transactions when the list loads, but keep manual refresh button available
    const autoRefreshed = useRef<Set<string>>(new Set());
    const refreshPending = useCallback(
        async (list?: PPOBTransaction[]) => {
            const src = list ?? transactions;
            const pendingRefs = src
                .filter(tx => tx.status === 'PENDING' && tx.transaction_ref_id)
                .map(tx => tx.transaction_ref_id);
            const toRefresh = pendingRefs.filter(ref => !autoRefreshed.current.has(ref));
            for (const ref of toRefresh) {
                autoRefreshed.current.add(ref);
                await handleRefreshStatus(ref);
            }
        },
        [transactions, handleRefreshStatus]
    );

    const handleTransactionSuccess = async () => {
        if (postPurchaseTimer.current) clearTimeout(postPurchaseTimer.current);
        setSelectedProduct(null);
        setSelectedCategory(null);
        setPostPurchaseLoading(true);

        postPurchaseTimer.current = setTimeout(async () => {
            const latest = await fetchHistory();
            await refreshPending(latest);
            fetchBalance();
            setPostPurchaseLoading(false);
            setTimeout(() => {
                historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }, 3000);
    };

    useEffect(() => {
        refreshPending();
    }, [transactions, refreshPending]);

    const buildCombinedCategories = () => {
        // Function content is unchanged
        const combined: Record<string, PPOBProduct[]> = {};
        const push = (k: string, items: PPOBProduct[]) => {
            if (!combined[k]) combined[k] = [];
            combined[k].push(...items);
        };

        const normalizeCat = (cat?: string | null, suffix?: string) => {
            const cleaned = (cat || 'Lainnya').trim();
            const base = cleaned.length > 0 ? cleaned : 'Lainnya';
            return suffix ? `${base} - ${suffix}` : base;
        };

        Object.entries(groupedProducts || {}).forEach(([typeKey, catMap]) => {
            const isPost = typeKey.toLowerCase().includes('post');
            const cats = catMap || {};

            if (!isPost) {
                Object.entries(cats).forEach(([k, list]) => {
                    const filtered = isAdmin ? list : list.filter(p => p.is_active !== false);
                    if (filtered.length > 0) {
                        const key = k.toUpperCase().includes('PLN') ? 'PLN' : normalizeCat(k, 'Prabayar');
                        push(key, filtered);
                    }
                });
            } else {
                const allPost = Object.values(cats).flat().filter(p => (isAdmin ? true : p.is_active !== false));
                const buckets: Record<string, PPOBProduct[]> = {};
                const ensure = (k: string) => { if (!buckets[k]) buckets[k] = []; return buckets[k]; };
                allPost.forEach(p => {
                    const name = `${p.product_name} ${p.category} ${p.brand}`.toUpperCase();
                    if (isEmoneyProduct(p)) ensure('E-MONEY').push(p);
                    else if (name.includes('PLN') || name.includes('LISTRIK')) ensure('PLN').push(p);
                    else if (name.includes('BPJS')) ensure('BPJS').push(p);
                    else if (name.includes('PDAM') || name.includes('AIR')) ensure('PDAM').push(p);
                    else if (name.includes('TV') || name.includes('VISION')) ensure('TV').push(p);
                    else if (name.includes('INTERNET') || name.includes('TELKOM') || name.includes('INDIHOME')) ensure('INTERNET').push(p);
                    else if (name.includes('GAS')) ensure('GAS').push(p);
                    else if (name.includes('MULTI') || name.includes('FINANCE') || name.includes('CICIL')) ensure('MULTIFINANCE').push(p);
                    else if (name.includes('PBB')) ensure('PBB').push(p);
                    else if (name.includes('HANDPHONE') || name.includes('HP') || name.includes('PASCABAYAR')) ensure('HP PASCABAYAR').push(p);
                    else ensure(p.category || 'Lainnya').push(p);
                });
                Object.entries(buckets).forEach(([k, list]) => {
                    const upper = k.toUpperCase();
                    const key =
                        upper === 'PLN'
                            ? 'PLN'
                            : upper === 'E-MONEY'
                            ? 'E-MONEY - Pascabayar'
                            : normalizeCat(k, 'Pascabayar');
                    push(key, list);
                });
            }
        });
        return combined;
    };

    const getPrepaidListMeta = (category: string) => {
        const upper = category.toUpperCase();
        if (upper.includes('SMS')) {
            return { title: 'Paket SMS', label: 'Nomor Handphone', placeholder: 'Contoh: 081234567890' };
        }
        if (upper.includes('GAME')) {
            return { title: 'Game', label: 'User ID', placeholder: 'Masukkan User ID' };
        }
        if (upper.includes('TV')) {
            return { title: 'TV Prabayar', label: 'ID Pelanggan', placeholder: 'Masukkan ID Pelanggan' };
        }
        if (upper.includes('STREAM')) {
            return { title: 'Streaming Prabayar', label: 'ID/No Akun', placeholder: 'Masukkan ID/No Akun' };
        }
        if (upper.includes('VOUCHER')) {
            return { title: 'Voucher Prabayar', label: 'ID/No Akun', placeholder: 'Masukkan ID/No Akun' };
        }
        if (upper.includes('E-MONEY') || upper.includes('EMONEY') || upper.includes('WALLET')) {
            return { title: 'E-Money', label: 'ID/No Akun', placeholder: 'Contoh: 081234567890' };
        }
        return { title: category.replace(' - Prabayar', ''), label: 'ID/No Akun', placeholder: 'Masukkan ID/No Akun' };
    };

    const isPrepaidListCategory = (category: string) => {
        const upper = category.toUpperCase();
        if (!upper.includes('PRABAYAR')) return false;
        const keywords = ['E-MONEY', 'EMONEY', 'WALLET', 'GAME', 'SMS', 'VOUCHER', 'STREAM', 'STREAMING', 'TV'];
        return keywords.some(keyword => upper.includes(keyword));
    };

    const renderCategoryContent = () => {
        const categories = buildCombinedCategories();

        // Ambil daftar e-money langsung dari sumber groupedProducts untuk menghindari mismatch bucket
        const flattenByType = (predicate: (typeKey: string) => boolean) =>
            Object.entries(groupedProducts || {})
                .filter(([typeKey]) => predicate(typeKey))
                .flatMap(([, catMap]) => Object.values(catMap || {}).flat())
                .filter(p => (isAdmin ? true : p.is_active !== false));
        const emoneyPre = flattenByType(typeKey => !typeKey.toLowerCase().includes('post')).filter(isEmoneyProduct);
        const emoneyPost = flattenByType(typeKey => typeKey.toLowerCase().includes('post')).filter(isEmoneyProduct);
        const showEmoneyCombined = emoneyPre.length > 0 || emoneyPost.length > 0;

        const categoryKeys = Object.keys(categories).filter(k => !k.toUpperCase().startsWith('E-MONEY - '));
        if (showEmoneyCombined) categoryKeys.push('E-MONEY');

        // Ubah label kategori di sini jika perlu penyesuaian tampilan
        const categoryDisplay: Record<string, string> = {
            'PLN': 'PLN',
            'BPJS': 'BPJS',
            'PDAM': 'PDAM',
            'TV': 'TV',
            'TV - PRABAYAR': 'Paket TV ',
            'TV - PASCABAYAR': 'Tagihan TV',
            'INTERNET': 'Internet',
            'GAS': 'Gas',
            'MULTIFINANCE': 'Multifinance',
            'PBB': 'Pajak',
            'HP PASCABAYAR': 'HP Pascabayar',
            'PULSA': 'Pulsa',
            'DATA': 'Paket Data',
            'E-MONEY': 'E-Wallet',
            'E-MONEY - PRABAYAR': 'EWALLET',
            'E-MONEY - PASCABAYAR': 'E-Money Tagihan',
        };
        const getCategoryLabel = (category: string) => {
            const rawKey = category.toUpperCase();
            const normalizedKey = category.replace(/\s*-\s*(Prabayar|Pascabayar)/i, '').trim().toUpperCase();
            if (categoryDisplay[rawKey]) return categoryDisplay[rawKey];
            if (categoryDisplay[normalizedKey]) return categoryDisplay[normalizedKey];
            return category.replace(/\s*-\s*(Prabayar|Pascabayar)/i, '').trim();
        };

        const renderProductCards = (
            products: PPOBProduct[],
            options?: { hidePrice?: boolean; useLogo?: boolean }
        ) => {
            const hidePrice = options?.hidePrice || selectedCategory?.toUpperCase().includes('PASCABAYAR');
            if (!products.length) {
                return <p className="text-center text-gray-500 py-8">Belum ada produk di kategori ini.</p>;
            }
            return (
                <div className="grid gap-3 md:grid-cols-2">
                    {products.map((product) => (
                        <button
                            key={product.product_code}
                            type="button"
                            onClick={() => {
                                setSelectedProduct(product);
                            }}
                            className="rounded-md border border-gray-200 dark:border-gray-700 px-4 py-3 flex flex-col gap-2 text-left hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-gray-700/50 transition"
                        >
                            <div className="flex justify-between items-start">
                                {options?.useLogo ? (
                                    <div className="flex items-center gap-3">
                                        {(() => {
                                            const logoSrc = getProductLogo(product);
                                            const displayName = getEmoneyDisplayName(product);
                                            const fallbackLogo = makeCircleLogo(
                                                (displayName || product.brand || product.product_name || 'E')[0].toUpperCase(),
                                                '#4B5563'
                                            );
                                            return (
                                                <img
                                                    src={logoSrc || fallbackLogo}
                                                    alt={product.product_name}
                                                    referrerPolicy="no-referrer"
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null;
                                                        e.currentTarget.src = fallbackLogo;
                                                    }}
                                                    className="h-10 w-10 rounded-md object-contain bg-gray-100 dark:bg-gray-700 p-1"
                                                />
                                            );
                                        })()}
                                        <div>
                                            <h4 className="font-semibold text-gray-800 dark:text-gray-100">{getEmoneyDisplayName(product)}</h4>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{product.product_name}</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <h4 className="font-semibold text-gray-800 dark:text-gray-100">{product.product_name}</h4>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">{product.category}</p>
                                    </div>
                                )}
                                {!hidePrice && (
                                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                                        {formatRupiah(product.selling_price ?? product.price ?? 0)}
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            );
        };

        const renderBackButton = (
            <button
                onClick={() => {
                    setSelectedCategory(null);
                    setSelectedProduct(null);
                    setEmoneyTab('prepaid');
                }}
                className="mb-4 text-indigo-600 hover:underline flex items-center gap-1"
            >
                <span aria-hidden>←</span> Kembali
            </button>
        );

        let content: JSX.Element;

        if (!selectedCategory) {
            content = (
                <div className="space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                            {/* <p className="text-sm text-gray-500 dark:text-gray-400">Pilih kategori layanan</p> */}
                            {/* <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">Menu PPOB</p> */}
                        </div>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
  {categoryKeys.sort().map(category => (
    <button
      key={category}
      onClick={() => setSelectedCategory(category)}
      className="flex flex-col items-center justify-center gap-2 px-3 py-3 rounded-md hover:bg-indigo-50 dark:hover:bg-gray-700/50 transition"
    >
      <span className="text-4xl">{getCategoryIcon(category)}</span>
      <span className="text-[8px] font-semibold text-center text-gray-800 dark:text-gray-100 line-clamp-2 leading-tight">
        {getCategoryLabel(category)}
      </span>
    </button>
  ))}
</div>
                </div>
            );
        } else if (selectedCategory === 'E-MONEY') {
            content = (
                <div className="space-y-4">
                    {renderBackButton}
                    <div className="border-b border-gray-200 dark:border-gray-700 mb-2 flex">
                        {[
                            { key: 'prepaid', label: 'Prabayar' },
                            { key: 'postpaid', label: 'Pascabayar' },
                        ].map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => {
                                    setEmoneyTab(tab.key as 'prepaid' | 'postpaid');
                                    setSelectedProduct(null);
                                }}
                                className={`flex-1 px-3 py-2 text-sm font-medium border-b-2 ${
                                    emoneyTab === tab.key
                                        ? 'border-indigo-500 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                                }`}
                                type="button"
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    {emoneyTab === 'prepaid' ? (
                        <EmoneyForm
                            products={emoneyPre}
                            onTransactionSuccess={handleTransactionSuccess}
                            onClose={() => {
                                setSelectedCategory(null);
                                setSelectedProduct(null);
                            }}
                        />
                    ) : (
                        renderProductCards(emoneyPost, { hidePrice: true, useLogo: true })
                    )}
                </div>
            );
        } else {
            const list = categories[selectedCategory] || [];

            if (selectedCategory.toUpperCase().includes('PULSA') || selectedCategory.toUpperCase().includes('DATA')) {
                content = (
                    <div className="space-y-4">
                        {renderBackButton}
                        <PulsaForm
                            products={list}
                            onTransactionSuccess={handleTransactionSuccess}
                            onClose={() => {
                                setSelectedCategory(null);
                                setSelectedProduct(null);
                            }}
                        />
                    </div>
                );
            } else if (selectedCategory.toUpperCase().includes('PLN')) {
                content = (
                    <div className="space-y-4">
                        {renderBackButton}
                        <PlnForm
                            products={list}
                            onTransactionSuccess={handleTransactionSuccess}
                            onClose={() => {
                                setSelectedCategory(null);
                                setSelectedProduct(null);
                            }}
                        />
                    </div>
                );
            } else if (isPrepaidListCategory(selectedCategory)) {
                const meta = getPrepaidListMeta(selectedCategory);
                content = (
                    <div className="space-y-4">
                        {renderBackButton}
                        <EmoneyForm
                            products={list}
                            onTransactionSuccess={handleTransactionSuccess}
                            title={meta.title}
                            inputLabel={meta.label}
                            inputPlaceholder={meta.placeholder}
                            onClose={() => {
                                setSelectedCategory(null);
                                setSelectedProduct(null);
                            }}
                        />
                    </div>
                );
            } else {
                content = (
                    <div className="space-y-4">
                        {renderBackButton}
                        {renderProductCards(list)}
                    </div>
                );
            }
        }

        return (
            <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
                {content}
            </div>
        );
    };

    const isPostpaidCategory = selectedCategory?.toUpperCase().includes('PASCABAYAR');
    const isProductPostpaid = Boolean(selectedProduct)
        ? (selectedProduct?.product_type || '').toLowerCase().includes('post') || (selectedProduct?.category || '').toUpperCase().includes('POST')
        : false;
    const isEmoneyPostpaid = Boolean(selectedProduct) && isEmoneyProduct(selectedProduct) && (isProductPostpaid || emoneyTab === 'postpaid');
    const shouldUsePostpaidModal = Boolean(selectedProduct) && isPostpaidCategory && isProductPostpaid && !isEmoneyPostpaid;

    return (
        <div className="py-6">
            {/* <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-6">PPOB & Saldo</h2> */}

            {/* Balance Info */}
            <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6 mb-8 flex items-center justify-between">
                <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Saldo Anda</p>
                    {isLoadingBalance ? <p className="text-2xl font-bold">Memuat...</p> : <p className="text-2xl font-bold">{formatRupiah(balance)}</p>}
                </div>
                <button
                    onClick={() => setShowTopUpModal(true)}
                    className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700"
                >
                    Isi Saldo
                </button>
            </div>
            
            {/* PPOB Product Grid */}
            <div className="mb-8">
                {renderCategoryContent()}
            </div>

            {/* Transaction History */}
            <h3 id="ppob-history" ref={historyRef} className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Riwayat Transaksi</h3>
            {isLoadingHistory ? (
                <p className="text-center text-gray-500 p-8">Loading history...</p>
            ) : historyError ? (
                <p className="text-center text-red-500 p-8">{historyError}</p>
            ) : (
                <>
                    <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <thead className="bg-gray-50 dark:bg-gray-700">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Tanggal</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Produk</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ID Pelanggan</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Nama Pelanggan</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Harga</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    {transactions.length > 0 ? (
                                        transactions.map((tx) => (
                                            <tr key={tx.id}>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{formatDateTimeDisplay(tx.created_at)}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{tx.product_name}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300 font-mono">{tx.customer_no}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">{tx.customerName}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{formatRupiah(tx.selling_price)}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm">{getStatusChip(tx.status)}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                                    {tx.status === 'PENDING' && (
                                                        <button
                                                            onClick={() => handleRefreshStatus(tx.transaction_ref_id)}
                                                            disabled={refreshingRef === tx.transaction_ref_id}
                                                            className="text-blue-600 hover:text-blue-800 disabled:opacity-50"
                                                        >
                                                            {refreshingRef === tx.transaction_ref_id ? '...' : 'Refresh'}
                                                        </button>
                                                    )}
                                                    {tx.status === 'SUCCESS' && (
                                                         <button onClick={() => setReceiptTx(tx)} className="text-indigo-600 hover:text-indigo-900">
                                                            Lihat Struk
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={7} className="text-center py-8 text-gray-500">
                                                Belum ada riwayat transaksi.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {isEmoneyPostpaid && selectedProduct && (
                <EmoneyPostpaidModal product={selectedProduct} onClose={closeProductModal} onSuccess={handleTransactionSuccess} />
            )}

            {shouldUsePostpaidModal && selectedProduct && (
                <PostpaidInquiryModal product={selectedProduct} onClose={closeProductModal} onSuccess={handleTransactionSuccess} />
            )}
            
            {/* Generic Purchase Modal */}
            {selectedProduct && !shouldUsePostpaidModal && !isEmoneyPostpaid && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 mx-4">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h4 className="text-lg font-bold text-gray-800 dark:text-gray-100">{selectedProduct.product_name}</h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{selectedProduct.category}</p>
                            </div>
                            <button onClick={closeProductModal} className="text-gray-500 hover:text-gray-700 dark:text-gray-300">✕</button>
                        </div>
                        <form
                            onSubmit={async (e) => {
                                e.preventDefault();
                                if (!selectedProduct || !purchaseCustomerNo) return;
                                setIsSubmittingPurchase(true);
                                setPurchaseError(null);
                                try {
                                    const response = await fetchWithAuth('/api/ppob/purchase', {
                                        method: 'POST',
                                        body: JSON.stringify({
                                            product_code: selectedProduct.product_code,
                                            customer_no: purchaseCustomerNo,
                                        }),
                                    });
                                    const result = await response.json();
                                    if (!response.ok) throw new Error(result.message || 'Transaksi gagal.');
                                    // alert('Transaksi Anda sedang diproses. Status akan diperbarui secara otomatis.');
                                    handleTransactionSuccess();
                                } catch (err: any) {
                                    setPurchaseError(err.message || 'Transaksi gagal.');
                                } finally {
                                    setIsSubmittingPurchase(false);
                                    setPurchaseCustomerNo('');
                                    setSelectedProduct(null);
                                    setSelectedCategory(null);
                                    const historyAnchor = document.getElementById('ppob-history');
                                    if (historyAnchor) {
                                        historyAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                }
                            }}
                            className="space-y-4"
                        >
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ID/No Pelanggan</label>
                                <input
                                    type="tel"
                                    value={purchaseCustomerNo}
                                    onChange={(e) => setPurchaseCustomerNo(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="Masukkan ID atau nomor pelanggan"
                                    required
                                />
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-600 dark:text-gray-300">Harga</span>
                                <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                                    {formatRupiah(selectedProduct.selling_price ?? selectedProduct.price ?? 0)}
                                </span>
                            </div>
                            {purchaseError && <p className="text-sm text-red-500">{purchaseError}</p>}
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={closeProductModal}
                                    className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingPurchase}
                                    className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400"
                                >
                                    {isSubmittingPurchase ? 'Memproses...' : 'Bayar Sekarang'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isAdmin && editingProduct && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    {/* Admin Modal Content Unchanged */}
                </div>
            )}

            <TopUpModal isOpen={showTopUpModal} onClose={() => setShowTopUpModal(false)} onSuccess={handleTransactionSuccess} />

            {/* NEW RECEIPT MODAL LOGIC */}
            {receiptTx && <ReceiptModal transaction={receiptTx} onClose={() => setReceiptTx(null)} appSettings={appSettings} />}

            {postPurchaseLoading && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl px-6 py-5 flex flex-col items-center gap-3 w-full max-w-sm text-center">
                        <div className="h-10 w-10 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin"></div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Memproses transaksi...</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Mohon tunggu beberapa detik, transaksi sedang di proses.</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PPOBSections;
