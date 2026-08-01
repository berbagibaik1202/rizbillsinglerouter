import React, { useState, useEffect } from 'react';
import { Invoice, ApiSettings, Customer, Package, PaymentStatus, formatRupiah, formatBillingPeriod, formatDateDisplay } from '../../types';
import Card from '../../components/common/Card';
import { PaymentStatusTag } from './shared/PaymentStatusTag';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

interface PaymentChannel {
    code: string;
    name: string;
    icon_url: string;
}

interface PaymentMethodModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (method: string) => void;
    channels: PaymentChannel[];
    isLoading: boolean;
}

const PaymentMethodModal: React.FC<PaymentMethodModalProps> = ({ isOpen, onClose, onConfirm, channels, isLoading }) => {
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
                    <div className="mt-4 space-y-3 max-h-80 overflow-y-auto">
                        {isLoading ? (
                            <p>Loading payment methods...</p>
                        ) : channels.length > 0 ? (
                            channels.map(channel => (
                                <div key={channel.code} onClick={() => setSelectedMethod(channel.code)} className={`p-3 border-2 rounded-lg flex items-center cursor-pointer ${selectedMethod === channel.code ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/50' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                    <input
                                        type="radio"
                                        name="payment-method"
                                        value={channel.code}
                                        checked={selectedMethod === channel.code}
                                        onChange={() => setSelectedMethod(channel.code)}
                                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                    />
                                    <img src={channel.icon_url} alt={channel.name} className="h-6 w-auto mx-3 object-contain" />
                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{channel.name}</span>
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


interface CustomerBillsProps {
    invoices: Invoice[];
    settings: ApiSettings | null;
    customer: Customer;
    customerPackage: Package | null;
}

const CustomerBills: React.FC<CustomerBillsProps> = ({ invoices, settings, customer, customerPackage }) => {
    const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
    const [paymentChannels, setPaymentChannels] = useState<PaymentChannel[]>([]);
    const [isLoadingChannels, setIsLoadingChannels] = useState(true);

    useEffect(() => {
        const fetchChannels = async () => {
            setIsLoadingChannels(true);
            try {
                console.log("[Customer Bills] Fetching payment channels...");
                const res = await fetchWithAuth(`${API_URL}/public/payment-channels`);
                 if (!res.ok) {
                    const errorText = await res.text();
                    console.error(`[Customer Bills DEBUG] Failed to fetch payment channels. Status: ${res.status}. Response:`, errorText);
                    throw new Error(`Failed to fetch channels: ${res.statusText}`);
                }
                const channelsData: PaymentChannel[] = await res.json();
                console.log('[Customer Bills DEBUG] Successfully fetched payment channels:', channelsData);
                
                const ewalletOrder = ['QRIS', 'SHOPEEPAY', 'OVO', 'DANA', 'LINKAJA'];
                const sortedChannels = channelsData.sort((a: PaymentChannel, b: PaymentChannel) => {
                    const aIsEwallet = ewalletOrder.includes(a.code);
                    const bIsEwallet = ewalletOrder.includes(b.code);

                    if (aIsEwallet && !bIsEwallet) return -1;
                    if (!aIsEwallet && bIsEwallet) return 1;
                    if (aIsEwallet && bIsEwallet) return ewalletOrder.indexOf(a.code) - ewalletOrder.indexOf(b.code);
                    return a.name.localeCompare(b.name);
                });

                setPaymentChannels(sortedChannels);
            } catch (e) {
                console.error("[Customer Bills DEBUG] CATCH block for fetching payment channels", e);
            } finally {
                setIsLoadingChannels(false);
            }
        }
        fetchChannels();
    }, []);

    const handleOpenPaymentModal = (invoice: Invoice) => {
        setPayingInvoice(invoice);
        setIsPaymentModalOpen(true);
    };

    const handleConfirmPayment = async (method: string) => {
        if (!payingInvoice || !method) return;

        console.log(`[Customer Bills DEBUG] Clicked 'Confirm Payment' for Invoice ID: ${payingInvoice.id} with method: ${method}`);
        setIsPaymentModalOpen(false);
        setPayingInvoiceId(payingInvoice.id);

        try {
            console.log(`[Customer Bills DEBUG] Sending API request to create payment link...`);
            const res = await fetchWithAuth(`${API_URL}/billing/invoices/${payingInvoice.id}/create-payment`, {
                method: 'POST',
                body: JSON.stringify({
                    method: method,
                }),
            });
            const data = await res.json();
            console.log('[Customer Bills DEBUG] Received response from create-payment API:', data);
            
            if (!res.ok) throw new Error(data.message);
            
            window.location.href = data.paymentUrl;
            console.log(`[Customer Bills DEBUG] Redirecting to payment URL: ${data.paymentUrl}`);
        } catch (error: any) {
            console.error('[Customer Bills DEBUG] Error creating payment link:', error);
            alert(`Error: ${error.message}`);
            setPayingInvoiceId(null);
        }
    };
    
    const unpaidInvoices = invoices.filter(inv => inv.status === PaymentStatus.Unpaid || inv.status === PaymentStatus.Overdue);
    const totalUnpaid = unpaidInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    
    const handleDownloadPdf = (invoiceToDownload: Invoice) => {
        if (!customer || !settings) return;

        const toPdfText = (value: unknown, fallback = '-') => {
            if (value === null || value === undefined) return fallback;
            const text = String(value).trim();
            return text.length > 0 ? text : fallback;
        };
        const safeDateText = (value?: string | null) => {
            const formatted = formatDateDisplay(value);
            return formatted === 'Invalid Date' || formatted === 'N/A' ? '-' : formatted;
        };
        const safeBillingPeriodText = (start?: string | null, end?: string | null) => {
            const formatted = formatBillingPeriod(start, end);
            return formatted.includes('Invalid Date') || formatted === 'N/A' ? '-' : formatted;
        };
        const safeAmount = (value: unknown) => {
            const num = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(num) ? num : 0;
        };

        const openPrintFallback = (
            subtotal: number,
            taxAmount: number,
            taxRate: number,
            description: string,
            issueDateText: string,
            dueDateText: string,
            periodText: string,
            status: string
        ) => {
            const invoiceHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${toPdfText(invoiceToDownload.id, 'unknown')}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 24px; background: #f9fafb; }
    .sheet { max-width: 800px; margin: 0 auto; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
    .topbar { height: 6px; background: #2563eb; border-radius: 999px; margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; gap: 24px; }
    .muted { color: #6b7280; }
    .title { color: #2563eb; font-size: 28px; font-weight: bold; margin: 0; }
    .section-title { font-size: 12px; font-weight: bold; color: #6b7280; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { padding: 12px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
    th:last-child, td:last-child { text-align: right; }
    .totals { margin-top: 24px; margin-left: auto; width: 280px; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
    .totals .final { font-weight: bold; font-size: 18px; border-top: 2px solid #d1d5db; margin-top: 8px; padding-top: 12px; }
    @media print {
      body { background: white; padding: 0; }
      .sheet { box-shadow: none; border-radius: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="topbar"></div>
    <div class="row">
      <div>
        <h1 class="title">${toPdfText(settings.app?.appName, 'ISP Billing Pro')}</h1>
        <div class="muted">${toPdfText(settings.app?.companyAddress, '-')}</div>
        <div class="muted">${toPdfText(settings.app?.companyPhone, '-')}</div>
      </div>
      <div>
        <h2 class="title">INVOICE</h2>
        <div><strong>Invoice #</strong> ${toPdfText(invoiceToDownload.id)}</div>
        <div><strong>Issue Date</strong> ${issueDateText}</div>
        <div><strong>Due Date</strong> ${dueDateText}</div>
      </div>
    </div>
    <div style="margin-top:24px;">
      <div class="section-title">BILLED TO</div>
      <div><strong>${toPdfText(customer.name)}</strong></div>
      <div class="muted">${toPdfText(customer.address, '-')}</div>
      <div class="muted">${toPdfText(customer.email, '-')}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>DESCRIPTION</th>
          <th>STATUS</th>
          <th>AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div>${toPdfText(description)}</div>
            <div class="muted" style="font-size:12px; margin-top:4px;">${periodText}</div>
          </td>
          <td>${status}</td>
          <td>${formatRupiah(subtotal)}</td>
        </tr>
      </tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${formatRupiah(subtotal)}</span></div>
      ${taxAmount > 0 ? `<div><span>Tax (${taxRate}%)</span><span>${formatRupiah(taxAmount)}</span></div>` : ''}
      <div class="final"><span>TOTAL</span><span>${formatRupiah(invoiceToDownload.amount)}</span></div>
    </div>
    ${invoiceToDownload.notes ? `<div style="margin-top:24px;"><div class="section-title">Notes</div><div>${toPdfText(invoiceToDownload.notes)}</div></div>` : ''}
    <div class="muted" style="margin-top:32px; text-align:center;">Thank you for choosing ${toPdfText(settings.app?.appName, 'our service')}.</div>
  </div>
  <script>
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>`;

            const printWindow = window.open('', '_blank', 'width=900,height=700');
            if (!printWindow) {
                alert('Popup diblokir browser. Izinkan popup untuk mencetak invoice.');
                return;
            }
            printWindow.document.open();
            printWindow.document.write(invoiceHtml);
            printWindow.document.close();
        };
        const taxRate = (customerPackage?.useTax ? settings.billing?.taxRate : 0) || 0;
        const totalAmount = safeAmount(invoiceToDownload.amount);
        const subtotal = taxRate > 0 ? totalAmount / (1 + taxRate / 100) : totalAmount;
        const taxAmount = totalAmount - subtotal;
        const description = customerPackage
            ? `${toPdfText(customerPackage.name)} Internet Plan (${safeAmount(customerPackage.speed)} Mbps)`
            : 'Paket lama / data paket tidak tersedia';
        const issueDateText = toPdfText(safeDateText(invoiceToDownload.issueDate));
        const dueDateText = toPdfText(safeDateText(invoiceToDownload.dueDate));
        const periodText = `Periode Tagihan: ${toPdfText(safeBillingPeriodText(invoiceToDownload.billingPeriodStart, invoiceToDownload.billingPeriodEnd))}`;
        const status = toPdfText(invoiceToDownload.status, 'Unknown');

        openPrintFallback(subtotal, taxAmount, taxRate, description, issueDateText, dueDateText, periodText, status);
    };

    return (
        <div className="py-6 space-y-6">
            <PaymentMethodModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                onConfirm={handleConfirmPayment}
                channels={paymentChannels}
                isLoading={isLoadingChannels}
            />
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Bills & Payments</h2>

            {totalUnpaid > 0 && (
                <Card className="!bg-yellow-50 dark:!bg-yellow-800/20 border-l-4 border-yellow-500">
                    <p className="font-semibold text-yellow-800 dark:text-yellow-300">Total Outstanding Bills</p>
                    <p className="text-3xl font-bold text-yellow-900 dark:text-yellow-200">{formatRupiah(totalUnpaid)}</p>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                        You have {unpaidInvoices.length} unpaid invoice(s). Please make a payment to avoid service interruption.
                    </p>
                </Card>
            )}

            <Card title="Billing History">
                {invoices.length > 0 ? (
                    <div className="space-y-4">
                        {invoices.map(invoice => (
                            <div key={invoice.id} className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border dark:border-gray-700">
                                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3">
                                            <h4 className="font-semibold text-gray-800 dark:text-gray-200">{invoice.id}</h4>
                                            <PaymentStatusTag status={invoice.status} />
                                        </div>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">
                                            Billing Period: {formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd)}
                                        </p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">
                                            Due Date: {formatDateDisplay(invoice.dueDate)}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto">
                                        <p className="text-lg font-bold text-gray-800 dark:text-gray-100 text-left sm:text-right">{formatRupiah(invoice.amount)}</p>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleDownloadPdf(invoice)}
                                                className="flex-1 sm:flex-none bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 text-sm font-semibold shadow-sm"
                                            >
                                                Cetak / Simpan PDF
                                            </button>
                                            {(invoice.status === 'Unpaid' || invoice.status === 'Overdue') && (
                                                <button
                                                    onClick={() => handleOpenPaymentModal(invoice)}
                                                    disabled={!!payingInvoiceId}
                                                    className="flex-1 sm:flex-none bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm font-semibold shadow-sm disabled:bg-gray-400 disabled:cursor-wait"
                                                >
                                                    {payingInvoiceId === invoice.id ? 'Processing...' : 'Pay Now'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-center text-gray-500 dark:text-gray-400 py-8">
                        You have no billing history yet.
                    </p>
                )}
            </Card>
        </div>
    );
};

export default CustomerBills;
