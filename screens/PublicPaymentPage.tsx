import React, { useState, useEffect } from 'react';
import Card from '~/components/common/Card';
import { formatRupiah, formatDateDisplay } from '~/types';

const API_URL = '/api';

interface PublicPaymentPageProps {
    invoiceId: string;
}

interface PublicInvoiceDetails {
    id: string;
    amount: number;
    dueDate: string;
    customerName: string;
    status: 'Paid' | 'Unpaid' | 'Overdue';
}

interface PaymentChannel {
    code: string;
    name: string;
    icon_url: string;
}

const PublicPaymentPage: React.FC<PublicPaymentPageProps> = ({ invoiceId }) => {
    const [invoice, setInvoice] = useState<PublicInvoiceDetails | null>(null);
    const [channels, setChannels] = useState<PaymentChannel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState<string | null>(null); // Menyimpan kode metode yang sedang diproses

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // Ambil detail invoice dan channel pembayaran secara paralel
                const [invoiceRes, channelsRes] = await Promise.all([
                    fetch(`${API_URL}/public/invoice/${invoiceId}`),
                    fetch(`${API_URL}/public/payment-channels`).catch(err => {
                        console.error('[Public Payment DEBUG] CATCH block for fetching payment channels:', err);
                        // Return a synthetic error response to be handled below
                        return new Response(JSON.stringify({ message: err.message }), { status: 500 });
                    })
                ]);

                if (!invoiceRes.ok) {
                    const errData = await invoiceRes.json();
                    throw new Error(errData.message || 'Invoice tidak ditemukan atau link tidak valid.');
                }
                const invoiceData: PublicInvoiceDetails = await invoiceRes.json();
                setInvoice(invoiceData);

                if (invoiceData.status === 'Paid') {
                    setIsLoading(false);
                    return;
                }
                
                if (!channelsRes.ok) {
                    const errorText = await channelsRes.text();
                    console.error(`[Public Payment DEBUG] Failed to fetch payment channels. Status: ${channelsRes.status}. Response:`, errorText);
                    throw new Error('Gagal memuat metode pembayaran.');
                }
                const channelsData: PaymentChannel[] = await channelsRes.json();
                console.log('[Public Payment DEBUG] Successfully fetched payment channels:', channelsData);
                
                const ewalletOrder = ['QRIS', 'SHOPEEPAY', 'OVO', 'DANA', 'LINKAJA'];
                const sortedChannels = channelsData.sort((a, b) => {
                    const aIsEwallet = ewalletOrder.includes(a.code);
                    const bIsEwallet = ewalletOrder.includes(b.code);

                    if (aIsEwallet && !bIsEwallet) return -1;
                    if (!aIsEwallet && bIsEwallet) return 1;
                    if (aIsEwallet && bIsEwallet) {
                        return ewalletOrder.indexOf(a.code) - ewalletOrder.indexOf(b.code);
                    }
                    return a.name.localeCompare(b.name);
                });

                setChannels(sortedChannels);

            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [invoiceId]);

    const handlePayment = async (methodCode: string) => {
        if (!invoice || isProcessing) return;

        console.log(`[Public Payment DEBUG] Clicked payment method for Invoice ID: ${invoice.id} with method: ${methodCode}`);
        setIsProcessing(methodCode);
        setError(null);

        try {
            console.log(`[Public Payment DEBUG] Sending API request to create payment link...`);
            const res = await fetch(`${API_URL}/public/create-public-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method: methodCode,
                    invoiceId: invoice.id,
                }),
            });
            const data = await res.json();
            console.log('[Public Payment DEBUG] Received response from create-payment API:', data);

            if (!res.ok) throw new Error(data.message || 'Gagal membuat link pembayaran.');

            // Redirect ke halaman pembayaran Tripay
            window.location.href = data.paymentUrl;
            console.log(`[Public Payment DEBUG] Redirecting to payment URL: ${data.paymentUrl}`);

        } catch (err: any) {
            console.error('[Public Payment DEBUG] Error creating payment link:', err);
            setError(err.message);
            setIsProcessing(null);
        }
    };

    if (isLoading) {
        return (
            <Card className="w-full max-w-lg text-center">
                <p className="text-gray-600 dark:text-gray-400">Memuat detail pembayaran...</p>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="w-full max-w-lg text-center">
                <h2 className="text-xl font-bold text-red-600 dark:text-red-400 mb-2">Terjadi Kesalahan</h2>
                <p className="text-gray-600 dark:text-gray-400">{error}</p>
            </Card>
        );
    }
    
    if (invoice?.status === 'Paid') {
         return (
            <Card className="w-full max-w-lg text-center">
                <div className="text-green-500 mb-4">
                    <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h2 className="text-xl font-bold text-green-600 dark:text-green-400 mb-2">Pembayaran Lunas</h2>
                <p className="text-gray-600 dark:text-gray-400">Tagihan dengan nomor <strong>{invoice.id}</strong> sudah dibayar. Terima kasih!</p>
            </Card>
        );
    }

    return (
        <Card className="w-full max-w-lg">
            <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-gray-100 mb-2">Detail Tagihan</h2>
            <div className="text-center mb-6 border-b dark:border-gray-700 pb-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Pembayaran untuk</p>
                <p className="font-semibold text-gray-800 dark:text-gray-200">{invoice?.customerName}</p>
                <p className="text-4xl font-bold text-blue-600 dark:text-blue-400 my-2">{formatRupiah(invoice?.amount || 0)}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Jatuh tempo pada: {formatDateDisplay(invoice?.dueDate)}</p>
            </div>

            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Pilih Metode Pembayaran</h3>
            <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                {channels.length > 0 ? (
                    channels.map(channel => (
                        <button
                            key={channel.code}
                            onClick={() => handlePayment(channel.code)}
                            disabled={!!isProcessing}
                            className="w-full p-3 border-2 rounded-lg flex items-center cursor-pointer transition-all duration-200 border-gray-200 dark:border-gray-600 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/50 disabled:opacity-50 disabled:cursor-wait"
                        >
                            <img src={channel.icon_url} alt={channel.name} className="h-6 w-auto object-contain" />
                            <span className="ml-4 text-sm font-medium text-gray-800 dark:text-gray-200">{channel.name}</span>
                            {isProcessing === channel.code ? (
                                <svg className="animate-spin h-5 w-5 ml-auto text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-auto text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                </svg>
                            )}
                        </button>
                    ))
                ) : (
                    <p className="text-sm text-center text-gray-500 dark:text-gray-400 py-4">Metode pembayaran tidak tersedia.</p>
                )}
            </div>
        </Card>
    );
};

export default PublicPaymentPage;