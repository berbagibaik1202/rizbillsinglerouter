
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Card from '../../components/common/Card';
import Tag from '../../components/common/Tag';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { Invoice, PaymentStatus, Payment, Customer, Package, formatRupiah, ApiSettings, formatDateDisplay, formatBillingPeriod, formatDateTimeDisplay } from '../../types';
import { fetchWithAuth } from '~/components/api';

// Extend the window interface to include jspdf for TypeScript
declare global {
    interface Window {
        jspdf: any;
    }
}
const API_URL = '/api';

interface PaymentChannel {
    code: string;
    name: string;
    icon_url: string;
}

const isFixedBillingType = (billingType?: string | null) => String(billingType || '').trim().toLowerCase() === 'fixed';

type InvoiceFormState = Omit<Invoice, 'id'>;

const addMonthsKeepDay = (date: Date, deltaMonths: number): Date => {
    const nextDate = new Date(date);
    const targetDay = nextDate.getUTCDate();
    nextDate.setUTCDate(1);
    nextDate.setUTCMonth(nextDate.getUTCMonth() + deltaMonths);
    const daysInTargetMonth = new Date(Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, 0)).getUTCDate();
    nextDate.setUTCDate(Math.min(targetDay, daysInTargetMonth));
    return nextDate;
};

/**
 * Formats a Date object into a 'YYYY-MM-DD' string, respecting the local timezone.
 * This avoids timezone issues that can occur with `toISOString()`.
 */
const formatDateToYMD = (date: Date): string => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const PaymentStatusTag: React.FC<{ status: PaymentStatus }> = ({ status }) => {
    const colorMap: { [key in PaymentStatus]: 'green' | 'red' | 'yellow' } = {
      [PaymentStatus.Paid]: 'green',
      [PaymentStatus.Overdue]: 'red',
      [PaymentStatus.Unpaid]: 'yellow',
    };
    return <Tag color={colorMap[status]}>{status}</Tag>;
};

type FilterStatus = 'all' | PaymentStatus;
type SortDirection = 'asc' | 'desc' | 'none';

// --- Invoice Detail Modal ---
interface InvoiceDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    invoice: Invoice | null;
    customer: Customer | null;
    payments: Payment[];
    customerPackage: Package | null;
}

const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({ isOpen, onClose, invoice, customer, payments, customerPackage }) => {
    if (!isOpen || !invoice || !customer) return null;

    const invoicePayments = payments.filter(p => p.invoiceId === invoice.id);

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-3xl my-8 transform transition-all">
                    <div className="flex justify-between items-start">
                        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Invoice Details: <span className="text-blue-600 dark:text-blue-400">{invoice.id}</span></h2>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Left Column */}
                        <div className="space-y-4">
                           <Card title="Invoice Summary">
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Status:</p>
                                    <div><PaymentStatusTag status={invoice.status} /></div>

                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Amount:</p>
                                    <p className="text-gray-800 dark:text-gray-200 font-mono text-base">{formatRupiah(invoice.amount)}</p>

                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Issue Date:</p>
                                    <p className="text-gray-800 dark:text-gray-200">{formatDateDisplay(invoice.issueDate)}</p>
                                    
                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Due Date:</p>
                                    <p className="text-gray-800 dark:text-gray-200">{formatDateDisplay(invoice.dueDate)}</p>

                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Billing Period:</p>
                                    <p className="text-gray-800 dark:text-gray-200">{formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd)}</p>
                                </div>
                           </Card>
                           <Card title="Customer Information">
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Name:</p>
                                    <p className="text-gray-800 dark:text-gray-200">{customer.name}</p>

                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Customer ID:</p>
                                    <p className="text-gray-800 dark:text-gray-200">{customer.id}</p>
                                    
                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Email:</p>
                                    <p className="text-gray-800 dark:text-gray-200 truncate">{customer.email}</p>

                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Phone:</p>
                                    <p className="text-gray-800 dark:text-gray-200">{customer.phone}</p>
                                    
                                    <p className="font-semibold text-gray-600 dark:text-gray-400">Package:</p>
                                    <p className="text-gray-800 dark:text-gray-200">{customerPackage?.name || 'N/A'}</p>
                                </div>
                           </Card>
                        </div>
                        {/* Right Column */}
                        <div className="space-y-4">
                            <Card title="Payment History">
                                {invoicePayments.length > 0 ? (
                                    <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                                        {invoicePayments.map(p => (
                                            <li key={p.id} className="py-2">
                                                <div className="flex justify-between items-center text-sm">
                                                    <div>
                                                        <p className="font-medium text-gray-800 dark:text-gray-200">{p.id}</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(p.date)}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-semibold text-green-600">{formatRupiah(p.amount)}</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">{p.method}</p>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-gray-500 dark:text-gray-400">No payments recorded for this invoice.</p>
                                )}
                            </Card>
                            <Card title="Notes">
                                <p className="text-sm text-gray-600 dark:text-gray-400 italic">
                                    {invoice.notes || 'No notes for this invoice.'}
                                </p>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Invoice Form Modal ---
interface InvoiceFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (newInvoice: Omit<Invoice, 'id'> & { id?: string }) => void;
    customers: Customer[];
    packages: Package[];
    invoice: Invoice | null;
    settings: ApiSettings | null;
    isSaving: boolean;
    error: string | null;
}

const InvoiceFormModal: React.FC<InvoiceFormModalProps> = ({ isOpen, onClose, onSave, customers, packages, invoice, settings, isSaving, error }) => {
    const [availablePeriods, setAvailablePeriods] = useState<{label: string, value: string}[]>([]);
    const [customerSearch, setCustomerSearch] = useState('');
    const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    
    const getInitialState = useCallback(() => {
        const issueDate = new Date();
        const issueDateString = formatDateToYMD(issueDate);
        return {
            customerId: '',
            amount: 0,
            issueDate: issueDateString,
            dueDate: '',
            status: PaymentStatus.Unpaid,
            notes: '',
            billingPeriodStart: '',
            billingPeriodEnd: '',
        };
    }, []);
    
    const [formData, setFormData] = useState<InvoiceFormState>(getInitialState());
    
    useEffect(() => {
        if (isOpen) {
            if (invoice) { // Editing existing invoice
                setFormData({
                    customerId: invoice.customerId,
                    amount: invoice.amount,
                    issueDate: invoice.issueDate,
                    dueDate: invoice.dueDate,
                    status: invoice.status,
                    notes: invoice.notes || '',
                    billingPeriodStart: invoice.billingPeriodStart,
                    billingPeriodEnd: invoice.billingPeriodEnd,
                });
                const customerName = customers.find(c => c.id === invoice.customerId)?.name || 'Unknown';
                setCustomerSearch(`${customerName} (${invoice.customerId})`);
                setAvailablePeriods([]); // Not applicable for editing
            } else { // Creating new invoice
                setFormData(getInitialState());
                setCustomerSearch('');
                setAvailablePeriods([]);
            }
        }
    }, [invoice, isOpen, getInitialState, customers]);

    const fetchAndSetDetails = useCallback(async (customerId: string, targetPeriodStart?: string) => {
        if (!customerId) return;
        setIsCalculating(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/billing/invoices/calculate`, {
                method: 'POST',
                body: JSON.stringify({ customerId, targetBillingPeriodStart: targetPeriodStart }),
            });
            const data = await res.json();
            const matchedCustomer = customers.find(c => c.id === customerId);
            const isFixedCustomer = isFixedBillingType(matchedCustomer?.billing_type);

            if (data.billingPeriodStart && !targetPeriodStart) {
                const [y, m, d] = data.billingPeriodStart.split('-').map(Number);
                const baseDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

                const periods = Array.from({ length: 13 }).map((_, i) => {
                    const offset = i - 6; // -6 to +6
                    const futureDate = addMonthsKeepDay(baseDate, offset);
                    
                    const isoString = futureDate.toISOString().split('T')[0];
                    
                    const label = isFixedCustomer
                        ? `${futureDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
                        : futureDate.toLocaleDateString('id-ID', {
                            month: 'long',
                            year: 'numeric',
                            timeZone: 'UTC'
                        });

                    return {
                        value: isoString,
                        label: label + (offset === 0 ? ' (Recommended)' : ''),
                    };
                });
                setAvailablePeriods(periods);
            }
            
            setFormData(prev => ({
                ...prev,
                customerId,
                amount: data.amount,
                billingPeriodStart: targetPeriodStart || data.billingPeriodStart,
                billingPeriodEnd: data.billingPeriodEnd,
                dueDate: data.dueDate,
                notes: data.notes,
            }));

        } catch (error) {
            console.error("Error fetching calculated invoice details:", error);
        } finally {
            setIsCalculating(false);
        }
    }, [customers]);

    const handleCustomerChange = (customerId: string) => {
        setFormData(prev => ({...prev, customerId}));
        setAvailablePeriods([]); 
        if (customerId) {
            const matchedCustomer = customers.find(c => c.id === customerId);
            const targetStart = isFixedBillingType(matchedCustomer?.billing_type)
                ? undefined
                : matchedCustomer?.nextBillingStart || undefined;
            fetchAndSetDetails(customerId, targetStart);
        }
    };
    
    const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setFormData(prev => ({ ...prev, billingPeriodStart: val }));
        
        if (formData.customerId) {
            fetchAndSetDetails(formData.customerId, val);
        }
    };

    const filteredCustomers = useMemo(() => {
        if (!customerSearch) return customers;
        const lowercasedQuery = customerSearch.toLowerCase();
        const match = lowercasedQuery.match(/(.+) \((\S+)\)/);
        if (match && customers.find(c => c.id.toLowerCase() === match[2])) {
            return customers; 
        }
        return customers.filter(c =>
            c.name.toLowerCase().includes(lowercasedQuery) ||
            c.id.toLowerCase().includes(lowercasedQuery)
        );
    }, [customerSearch, customers]);

    const handleCustomerSelect = (customer: Customer) => {
        setCustomerSearch(`${customer.name} (${customer.id})`);
        handleCustomerChange(customer.id);
        setIsCustomerDropdownOpen(false);
    };


    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const amount = Number(formData.amount);
        if (!formData.customerId || !Number.isFinite(amount) || amount <= 0 || !formData.dueDate) {
            alert('Please fill out all required fields.');
            return;
        }
        onSave({ ...formData, amount, id: invoice?.id });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: name === 'amount' ? (value === '' ? 0 : Number(value)) : value }));
    };
    
    const selectedCustomer = customers.find(c => c.id === formData.customerId);
    const isFixedBillingCustomer = isFixedBillingType(selectedCustomer?.billing_type);
    const customerPackage = selectedCustomer ? packages.find(p => p.id === selectedCustomer.packageId) : null;
    const taxRate = settings?.billing?.taxRate || 0;
    const subtotal = taxRate > 0 && formData.amount > 0 && customerPackage?.useTax ? formData.amount / (1 + taxRate/100) : formData.amount;
    const inputClasses = "mt-1 block w-full shadow-sm sm:text-sm rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white";

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80 transition-opacity" aria-hidden="true" onClick={onClose}></div>
                <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                <div className="inline-block align-bottom bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                    <form onSubmit={handleSubmit}>
                        <div className="bg-white dark:bg-gray-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                            <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100" id="modal-title">
                                {invoice ? 'Edit Invoice' : 'Create New Invoice'}
                            </h3>
                            <div className="mt-4 space-y-4">
                                <div>
                                    <label htmlFor="customer-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Customer</label>
                                    <div className="relative" onBlur={() => setTimeout(() => setIsCustomerDropdownOpen(false), 150)}>
                                        <input
                                            id="customer-search"
                                            type="text"
                                            placeholder="Search by name or ID..."
                                            value={customerSearch}
                                            onChange={(e) => {
                                                setCustomerSearch(e.target.value);
                                                if (e.target.value === '') handleCustomerChange('');
                                            }}
                                            onFocus={() => setIsCustomerDropdownOpen(true)}
                                            className={inputClasses}
                                            autoComplete="off"
                                            disabled={!!invoice}
                                        />
                                        {isCustomerDropdownOpen && !invoice && (
                                            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                                <ul>
                                                    {filteredCustomers.length > 0 ? (
                                                        filteredCustomers.map(c => (
                                                            <li key={c.id}>
                                                                <button 
                                                                    type="button" 
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault(); // Prevent blur before click
                                                                        handleCustomerSelect(c);
                                                                    }} 
                                                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                                                                >
                                                                    {c.name} ({c.id})
                                                                </button>
                                                            </li>
                                                        ))
                                                    ) : (
                                                        <li className="px-4 py-2 text-sm text-gray-500">No customers found.</li>
                                                    )}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {!invoice && (
                                <div>
                                    <div className="flex justify-between">
                                        <label htmlFor="billingPeriod" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                            {isFixedBillingCustomer ? 'Billing Period' : 'Billing Period Start'}
                                        </label>
                                        {isCalculating && <span className="text-xs text-blue-500">Updating...</span>}
                                    </div>
                                    <select
                                        id="billingPeriod"
                                        name="billingPeriodStart"
                                        value={formData.billingPeriodStart}
                                        onChange={handlePeriodChange}
                                        className={inputClasses}
                                        disabled={availablePeriods.length === 0}
                                    >
                                        {availablePeriods.length > 0 ? (
                                            availablePeriods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)
                                        ) : (
                                            <option>Select a customer first</option>
                                        )}
                                    </select>
                                </div>
                                )}
                                
                                <div>
                                    <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Total Amount (Rp)</label>
                                    <input type="number" name="amount" id="amount" value={formData.amount} onChange={handleInputChange} step="1" min="0" className={inputClasses} />
                                </div>
                                {(customerPackage && subtotal > 0 && customerPackage.useTax) && (
                                    <div className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-md space-y-1">
                                        <div className="flex justify-between"><span>Base Price (Subtotal):</span> <span>{formatRupiah(subtotal)}</span></div>
                                        <div className="flex justify-between"><span>Tax ({taxRate}%):</span> <span>{formatRupiah(formData.amount - subtotal)}</span></div>
                                        <div className="flex justify-between font-bold border-t pt-1 mt-1 border-gray-200 dark:border-gray-600"><span>Calculated Total:</span> <span>{formatRupiah(formData.amount)}</span></div>
                                    </div>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                     <div>
                                        <label htmlFor="issueDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Issue Date</label>
                                        <input type="date" name="issueDate" id="issueDate" value={formData.issueDate} onChange={handleInputChange} className={inputClasses} />
                                    </div>
                                    <div>
                                        <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Due Date</label>
                                        <input type="date" name="dueDate" id="dueDate" value={formData.dueDate} onChange={handleInputChange} className={inputClasses} />
                                    </div>
                                </div>
                                 <div className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-md">
                                    <span className="font-medium text-gray-700 dark:text-gray-200">Calculated Period: </span>
                                    <span>{formatBillingPeriod(formData.billingPeriodStart, formData.billingPeriodEnd)}</span>
                                </div>
                                <div>
                                    <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
                                    <select id="status" name="status" value={formData.status} onChange={handleInputChange} className={inputClasses}>
                                        {Object.values(PaymentStatus).map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                 <div>
                                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Notes</label>
                                    <textarea name="notes" id="notes" value={formData.notes} onChange={handleInputChange} rows={3} className={inputClasses}></textarea>
                                </div>
                                {error && (
                                    <div className="p-3 my-2 text-sm text-red-700 bg-red-100 rounded-lg dark:bg-red-900/40 dark:text-red-300" role="alert">
                                        {error}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                            <button type="submit" disabled={isSaving} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-blue-400">
                                {isSaving ? 'Saving...' : 'Save'}
                            </button>
                            <button type="button" onClick={onClose} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-500 shadow-sm px-4 py-2 bg-white dark:bg-gray-600 text-base font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

// --- Manual Payment Modal ---
const ManualPaymentModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (method: string) => void;
    invoice: Invoice | null;
}> = ({ isOpen, onClose, onConfirm, invoice }) => {
    const [method, setMethod] = useState('Cash');

    useEffect(() => {
        if (isOpen) {
            setMethod('Cash'); // Reset to default when opening
        }
    }, [isOpen]);

    if (!isOpen || !invoice) return null;

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-sm">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Confirm Manual Payment</h3>
                    <div className="mt-4 space-y-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            You are marking invoice <strong className="font-semibold text-gray-700 dark:text-gray-200">{invoice.id}</strong> for <strong className="font-semibold text-gray-700 dark:text-gray-200">{formatRupiah(invoice.amount)}</strong> as paid.
                        </p>
                        <div>
                            <label htmlFor="paymentMethod" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Payment Method</label>
                            <select
                                id="paymentMethod"
                                value={method}
                                onChange={(e) => setMethod(e.target.value)}
                                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                            >
                                <option>Cash</option>
                                <option>Bank Transfer</option>
                            </select>
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end space-x-2">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Cancel</button>
                        <button onClick={() => onConfirm(method)} type="button" className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700">Confirm</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Admin Payment Modal for Generating Links ---
const AdminPaymentModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (method: string) => void;
    invoice: Invoice | null;
    channels: PaymentChannel[];
    isLoading: boolean;
}> = ({ isOpen, onClose, onConfirm, invoice, channels, isLoading }) => {
    const [selectedMethod, setSelectedMethod] = useState<string>('');

    useEffect(() => {
        if (isOpen && channels.length > 0) {
            setSelectedMethod(channels[0].code);
        }
    }, [isOpen, channels]);

    if (!isOpen || !invoice) return null;

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-md">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Generate Payment Link</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Select a method for invoice <strong className="font-semibold">{invoice.id}</strong>.</p>
                    <div className="mt-4 space-y-3 max-h-80 overflow-y-auto pr-2">
                        {isLoading ? (
                            <p>Loading payment methods...</p>
                        ) : channels.length > 0 ? (
                            channels.map(channel => (
                                <div key={channel.code} onClick={() => setSelectedMethod(channel.code)} className={`p-3 border-2 rounded-lg flex items-center cursor-pointer ${selectedMethod === channel.code ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/50' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                    <input type="radio" name="payment-method" value={channel.code} checked={selectedMethod === channel.code} onChange={() => {}} className="h-4 w-4 text-blue-600" />
                                    <img src={channel.icon_url} alt={channel.name} className="h-6 w-auto mx-3 object-contain" />
                                    <span className="text-sm font-medium">{channel.name}</span>
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-gray-500">No payment methods available.</p>
                        )}
                    </div>
                    <div className="mt-6 flex justify-end space-x-2">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Cancel</button>
                        <button onClick={() => onConfirm(selectedMethod)} disabled={!selectedMethod || isLoading} type="button" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400">
                            Generate & Copy Link
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Fallback Modal for Copying Link ---
interface CopyLinkModalProps {
    isOpen: boolean;
    onClose: () => void;
    link: string;
}

const CopyLinkModal: React.FC<CopyLinkModalProps> = ({ isOpen, onClose, link }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed z-40 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-50 w-full max-w-lg">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Copy Payment Link</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        Automatic copy failed (this can happen on insecure connections). Please copy the link below manually:
                    </p>
                    <div className="mt-4">
                        <input
                            type="text"
                            readOnly
                            value={link}
                            onFocus={(e) => e.target.select()}
                            className="w-full p-2 border rounded bg-gray-100 dark:bg-gray-700 dark:border-gray-600 font-mono text-sm"
                        />
                    </div>
                    <div className="mt-6 flex justify-end">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700">Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
};


const Billing: React.FC = () => {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [packages, setPackages] = useState<Package[]>([]);
    const [settings, setSettings] = useState<ApiSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);

    const [filter, setFilter] = useState<FilterStatus>('all');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error', visible: boolean }>({ message: '', type: 'success', visible: false });
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [deletingInvoice, setDeletingInvoice] = useState<Invoice | null>(null);
    const [manualPaymentInvoice, setManualPaymentInvoice] = useState<Invoice | null>(null);
    const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
    const [generatingLink, setGeneratingLink] = useState<string | null>(null);
    const [sendingWhatsappId, setSendingWhatsappId] = useState<string | null>(null);
    const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
    
    // State for payment link modal
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
    const [paymentChannels, setPaymentChannels] = useState<PaymentChannel[]>([]);
    const [isLoadingChannels, setIsLoadingChannels] = useState(true);
    const [linkToCopy, setLinkToCopy] = useState<string | null>(null);
    
    // Bulk Action State
    const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
    const [deletingMode, setDeletingMode] = useState<'single' | 'bulk' | null>(null);
    const [isBulkActionInProgress, setIsBulkActionInProgress] = useState(false);

    // New State for Date Filter & Pagination
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 40;

    // --- Icon Components ---
    const PaidIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;
    const LinkIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" /></svg>;
    const WhatsappIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 4.315 1.731 6.086l.107.192-.533 1.955 1.976-.518.188.112z" /></svg>;
    const EmailIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M1.5 6A2.5 2.5 0 014 3.5h16A2.5 2.5 0 0122.5 6v12A2.5 2.5 0 0120 20.5H4A2.5 2.5 0 011.5 18V6zm2.11-.5L12 11.58 20.39 5.5H3.61zM4 18.5h16a.5.5 0 00.5-.5V7.12l-8.21 5.96a1 1 0 01-1.18 0L3.5 7.12V18a.5.5 0 00.5.5z" /></svg>;
    const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>;
    const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
    const PdfIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
    const SpinnerIcon = () => <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>;
    const SortUpIcon = () => <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>;
    const SortDownIcon = () => <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>;


    useEffect(() => {
        const handleUrlFilter = () => {
            const hash = window.location.hash;
            if (hash.includes('?')) {
                const params = new URLSearchParams(hash.split('?')[1]);
                const status = params.get('status') as PaymentStatus;

                if (status && Object.values(PaymentStatus).includes(status)) {
                    setFilter(status);
                    // Bersihkan URL setelah filter diterapkan agar tidak membingungkan
                    window.history.replaceState(null, '', '#admin/billing');
                }
            }
        };
        handleUrlFilter();
    }, []);

    const fetchAllData = useCallback(async () => {
        setIsLoading(true);
        try {
            console.log("[Admin Billing] Starting to fetch all billing data...");
            const paymentChannelsUrl = `${API_URL}/public/payment-channels`;
            console.log(`[Admin Billing DEBUG] Attempting to fetch payment channels from: ${paymentChannelsUrl}`);
            
            const [invoicesRes, paymentsRes, customersRes, packagesRes, settingsRes, channelsRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/billing/invoices`),
                fetchWithAuth(`${API_URL}/billing/payments`),
                fetchWithAuth(`${API_URL}/customers`),
                fetchWithAuth(`${API_URL}/network/packages`),
                fetchWithAuth(`${API_URL}/admin/settings`),
                fetchWithAuth(paymentChannelsUrl).then(async res => {
                    if (!res.ok) {
                        const errorText = await res.text();
                        console.error(`[Admin Billing DEBUG] Failed to fetch payment channels from ${paymentChannelsUrl}. Status: ${res.status}. Response:`, errorText);
                        throw new Error(`Failed to fetch channels: ${res.statusText}`);
                    }
                    const channelsData = await res.json();
                    console.log('[Admin Billing DEBUG] Successfully fetched payment channels:', channelsData);
                    return channelsData;
                }).catch(err => {
                    console.error(`[Admin Billing DEBUG] CATCH block for fetching payment channels from ${paymentChannelsUrl}:`, err);
                    return []; // Return empty array on failure to prevent crash
                }),
            ]);

            setInvoices(await invoicesRes.json());
            setPayments(await paymentsRes.json());
            setCustomers(await customersRes.json());
            setPackages(await packagesRes.json());
            setSettings(await settingsRes.json());
            
            const channelsData: PaymentChannel[] = channelsRes;
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

        } catch (error) {
            console.error("[Admin Billing] Failed to fetch billing data:", error);
        } finally {
            setIsLoading(false);
            setIsLoadingChannels(false);
        }
    }, []);

    useEffect(() => {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), (today.getMonth()-1), 1);
        const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        setStartDate(formatDateToYMD(firstDayOfMonth));
        setEndDate(formatDateToYMD(lastDayOfMonth));
        fetchAllData();
    }, [fetchAllData]);

    const overdueInvoicesCount = useMemo(() => {
        return invoices.filter(invoice => invoice.status === PaymentStatus.Overdue).length;
    }, [invoices]);

    const customersMap = useMemo(() => {
        return customers.reduce((acc, customer) => {
            acc[customer.id] = customer;
            return acc;
        }, {} as Record<string, Customer>);
    }, [customers]);
    
     const packagesMap = useMemo(() => {
        return packages.reduce((acc, pkg) => {
            acc[pkg.id] = pkg;
            return acc;
        }, {} as Record<number, Package>);
    }, [packages]);

    const processedInvoices = useMemo(() => {
        let processedList: Invoice[] = [...invoices]; 

        if (startDate && endDate) {
            processedList = processedList.filter(invoice => 
                invoice.issueDate >= startDate && invoice.issueDate <= endDate
            );
        }

        if (filter !== 'all') {
            processedList = processedList.filter(invoice => invoice.status === filter);
        }

        if (searchQuery.trim() !== '') {
            const lowercasedQuery = searchQuery.toLowerCase();
            processedList = processedList.filter(invoice => {
                const customerName = (customersMap[invoice.customerId]?.name || '').toLowerCase();
                return (
                    invoice.id.toLowerCase().includes(lowercasedQuery) ||
                    customerName.includes(lowercasedQuery) ||
                    invoice.status.toLowerCase().includes(lowercasedQuery)
                );
            });
        }

        if (sortDirection !== 'none') {
            processedList.sort((a, b) => {
                const dateA = new Date(a.dueDate).getTime();
                const dateB = new Date(b.dueDate).getTime();
                return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
            });
        }
        
        return processedList;
    }, [invoices, filter, sortDirection, searchQuery, customersMap, startDate, endDate]);
    
    // Reset page number when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [filter, searchQuery, startDate, endDate]);

    // Pagination logic
    const totalPages = Math.ceil(processedInvoices.length / ITEMS_PER_PAGE);
    const paginatedInvoices = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return processedInvoices.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [processedInvoices, currentPage]);

    const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ message, type, visible: true });
        setTimeout(() => {
            setNotification({ message: '', type: 'success', visible: false });
        }, 3000);
    };
    
    const handleConfirmManualPayment = async (paymentMethod: string) => {
        if (manualPaymentInvoice) {
            const invoiceToPay = manualPaymentInvoice;
            setManualPaymentInvoice(null);
            
            try {
                // Kirim satu permintaan ke backend. Backend akan menangani pembuatan
                // catatan pembayaran dan pengiriman notifikasi.
                await fetchWithAuth(`${API_URL}/billing/invoices/${invoiceToPay.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ status: PaymentStatus.Paid, paymentMethod }),
                });

                await fetchAllData();
                showNotification(`Invoice ${invoiceToPay.id} marked as paid via ${paymentMethod}.`);
            } catch (error: any) {
                console.error("Failed to mark invoice as paid:", error);
                showNotification(error.message, 'error');
            }
        }
    };
    
    const handleAddInvoice = () => {
        setEditingInvoice(null);
        setModalError(null);
        setIsFormModalOpen(true);
    };
    
    const handleEditInvoice = (invoice: Invoice) => {
        setEditingInvoice(invoice);
        setModalError(null);
        setIsFormModalOpen(true);
    };

    const handleSaveInvoice = async (invoiceData: Omit<Invoice, 'id'> & { id?: string }) => {
        setIsSaving(true);
        setModalError(null);
        const isEditing = !!invoiceData.id;
        const url = isEditing ? `${API_URL}/billing/invoices/${invoiceData.id}` : `${API_URL}/billing/invoices`;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const { id, ...invoicePayload } = invoiceData;
            const normalizedInvoicePayload = {
                ...invoicePayload,
                amount: Number(invoicePayload.amount),
            };
            if (!Number.isFinite(normalizedInvoicePayload.amount) || normalizedInvoicePayload.amount <= 0) {
                throw new Error('Nominal invoice tidak valid.');
            }
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify(normalizedInvoicePayload)
            });
            const responseData = await res.json();
            await fetchAllData();
            showNotification(`Invoice ${responseData.id} ${isEditing ? 'updated' : 'created'}.`);
            setIsFormModalOpen(false);
        } catch (error: any) {
            console.error("Failed to save invoice:", error);
            setModalError(error.message);
        } finally {
            setIsSaving(false);
        }
    };

    const confirmDelete = async () => {
        setIsBulkActionInProgress(true);
        try {
            let idsToDelete: string[] = [];
            let itemNameToDisplay = '';
            
            if (deletingMode === 'bulk') {
                idsToDelete = selectedInvoices;
                itemNameToDisplay = `${selectedInvoices.length} invoice(s)`;
            } else if (deletingMode === 'single' && deletingInvoice) {
                idsToDelete = [deletingInvoice.id];
                itemNameToDisplay = deletingInvoice.id;
            } else {
                return;
            }

            await fetchWithAuth(`${API_URL}/billing/invoices/bulk-delete`, {
                method: 'POST',
                body: JSON.stringify({ ids: idsToDelete }),
            });
            
            showNotification(`${itemNameToDisplay} deleted.`);
            setSelectedInvoices([]);
            await fetchAllData();

        } catch (error: any) {
            showNotification(error.message, 'error');
        } finally {
            setDeletingInvoice(null);
            setDeletingMode(null);
            setIsBulkActionInProgress(false);
        }
    };

    const handleGenerateClosedLink = async (method: string) => {
        if (!payingInvoice) return;
    
        console.log(`[Admin Billing DEBUG] Clicked 'Generate & Copy Link' for Invoice ID: ${payingInvoice.id} with method: ${method}`);
        setGeneratingLink(payingInvoice.id);
        setIsPaymentModalOpen(false);
        try {
            console.log(`[Admin Billing DEBUG] Sending API request to create payment link...`);
            const res = await fetchWithAuth(`${API_URL}/billing/invoices/${payingInvoice.id}/create-payment`, {
                method: 'POST',
                body: JSON.stringify({
                    method: method,
                }),
            });
            const data = await res.json();
    
            console.log('[Admin Billing DEBUG] Received response from create-payment API:', data);

            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(data.paymentUrl);
                showNotification(`Link for ${method} copied to clipboard!`);
                console.log('[Admin Billing DEBUG] Payment link copied to clipboard.');
            } else {
                setLinkToCopy(data.paymentUrl);
                console.warn('[Admin Billing DEBUG] Clipboard API not available. Opening fallback modal to copy link.');
            }
            
            await fetchAllData();
        } catch (error: any) {
            console.error('[Admin Billing DEBUG] Error creating payment link:', error);
            showNotification(`Error: ${error.message}`, 'error');
        } finally {
            setGeneratingLink(null);
            setPayingInvoice(null);
        }
    };


    const handleSendWhatsapp = async (invoiceId: string) => {
        setSendingWhatsappId(invoiceId);
        try {
            const res = await fetchWithAuth(`${API_URL}/billing/invoices/${invoiceId}/send-whatsapp`, {
                method: 'POST',
            });
            const data = await res.json();
            showNotification(data.message, 'success');
        } catch (error: any) {
            console.error("Failed to send WhatsApp message:", error);
            showNotification(error.message, 'error');
        } finally {
            setSendingWhatsappId(null);
        }
    };

    const handleSendEmail = async (invoiceId: string) => {
        setSendingEmailId(invoiceId);
        try {
            const res = await fetchWithAuth(`${API_URL}/billing/invoices/${invoiceId}/send-email`, {
                method: 'POST',
            });
            const data = await res.json();
            showNotification(data.message, 'success');
        } catch (error: any) {
            console.error("Failed to send email message:", error);
            showNotification(error.message, 'error');
        } finally {
            setSendingEmailId(null);
        }
    };

    const handleGenerateInvoices = async () => {
        setIsGenerating(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/billing/generate-monthly`, {
                method: 'POST',
            });
            const data = await res.json();
            await fetchAllData();
            showNotification(data.message, 'success');
        } catch (error: any) {
            console.error("Failed to generate invoices:", error);
            showNotification(error.message, 'error');
        } finally {
            setIsGenerating(false);
        }
    };
    
    const handleDownloadPdf = (invoiceToDownload: Invoice) => {
        const customer = customersMap[invoiceToDownload.customerId];
        if (!customer || !settings) return;
        const toPrintText = (value: unknown, fallback = '-') => {
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

        const customerPackage = packagesMap[customer.packageId];
        const taxRate = (customerPackage?.useTax ? settings.billing.taxRate : 0) || 0;
        const totalAmount = safeAmount(invoiceToDownload.amount);
        const subtotal = taxRate > 0 ? totalAmount / (1 + taxRate / 100) : totalAmount;
        const taxAmount = totalAmount - subtotal;
        const description = customerPackage
            ? `${toPrintText(customerPackage.name)} Internet Plan (${safeAmount(customerPackage.speed)} Mbps)`
            : 'Paket lama / data paket tidak tersedia';
        const issueDateText = toPrintText(safeDateText(invoiceToDownload.issueDate));
        const dueDateText = toPrintText(safeDateText(invoiceToDownload.dueDate));
        const billingPeriodText = toPrintText(safeBillingPeriodText(invoiceToDownload.billingPeriodStart, invoiceToDownload.billingPeriodEnd));
        const status = toPrintText(invoiceToDownload.status, 'Unknown');

        const invoiceHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${toPrintText(invoiceToDownload.id, 'unknown')}</title>
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
        <h1 class="title">${toPrintText(settings.app?.appName, 'ISP Billing Pro')}</h1>
        <div class="muted">${toPrintText(settings.app?.companyAddress, '-')}</div>
        <div class="muted">${toPrintText(settings.app?.companyPhone, '-')}</div>
      </div>
      <div>
        <h2 class="title">INVOICE</h2>
        <div><strong>Invoice #</strong> ${toPrintText(invoiceToDownload.id)}</div>
        <div><strong>Issue Date</strong> ${issueDateText}</div>
        <div><strong>Due Date</strong> ${dueDateText}</div>
      </div>
    </div>
    <div style="margin-top:24px;">
      <div class="section-title">BILLED TO</div>
      <div><strong>${toPrintText(customer.name)}</strong></div>
      <div class="muted">${toPrintText(customer.address, '-')}</div>
      <div class="muted">${toPrintText(customer.email, '-')}</div>
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
            <div>${description}</div>
            <div class="muted" style="font-size:12px; margin-top:4px;">Periode Tagihan: ${billingPeriodText}</div>
          </td>
          <td>${status}</td>
          <td>${formatRupiah(subtotal)}</td>
        </tr>
      </tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${formatRupiah(subtotal)}</span></div>
      ${taxAmount > 0 ? `<div><span>Tax (${taxRate}%)</span><span>${formatRupiah(taxAmount)}</span></div>` : ''}
      <div class="final"><span>TOTAL</span><span>${formatRupiah(totalAmount)}</span></div>
    </div>
    ${invoiceToDownload.notes ? `<div style="margin-top:24px;"><div class="section-title">Notes</div><div>${toPrintText(invoiceToDownload.notes)}</div></div>` : ''}
    <div class="muted" style="margin-top:32px; text-align:center;">Thank you for choosing ${toPrintText(settings.app?.appName, 'our service')}.</div>
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
            showNotification('Popup diblokir browser. Izinkan popup untuk mencetak invoice.', 'error');
            return;
        }
        printWindow.document.open();
        printWindow.document.write(invoiceHtml);
        printWindow.document.close();
    };
    
    // --- Bulk Action Handlers ---
    const handleSelectOne = (invoiceId: string, isSelected: boolean) => {
        setSelectedInvoices(prev => isSelected ? [...prev, invoiceId] : prev.filter(id => id !== invoiceId));
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedInvoices(e.target.checked ? paginatedInvoices.map(i => i.id) : []);
    };
    
    const handleBulkDelete = () => {
        if (selectedInvoices.length > 0) {
            setDeletingMode('bulk');
        }
    };
    
    const handleBulkMarkPaid = async () => {
        const method = window.prompt("Enter payment method for these transactions (e.g., 'Cash', 'Bulk Transfer'):", "Cash");
        if (!method) return;
        
        setIsBulkActionInProgress(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/billing/invoices/bulk-mark-paid`, {
                method: 'POST',
                body: JSON.stringify({ ids: selectedInvoices, method }),
            });
            const data = await res.json();
            showNotification(data.message);
            setSelectedInvoices([]);
            await fetchAllData();
        } catch (err: any) {
            showNotification(err.message, 'error');
        } finally {
            setIsBulkActionInProgress(false);
        }
    };

const handleBulkSendWhatsapp = async () => {
        setIsBulkActionInProgress(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/billing/invoices/bulk-send-whatsapp`, {
                method: 'POST',
                body: JSON.stringify({ ids: selectedInvoices }),
            });
            const data = await res.json();
            showNotification(data.message);
            setSelectedInvoices([]);
        } catch (err: any) {
            showNotification(err.message, 'error');
        } finally {
            setIsBulkActionInProgress(false);
        }
    };

    const handleBulkSendEmail = async () => {
        setIsBulkActionInProgress(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/billing/invoices/bulk-send-email`, {
                method: 'POST',
                body: JSON.stringify({ ids: selectedInvoices }),
            });
            const data = await res.json();
            showNotification(data.message);
            setSelectedInvoices([]);
        } catch (err: any) {
            showNotification(err.message, 'error');
        } finally {
            setIsBulkActionInProgress(false);
        }
    };

    const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const toCsvValue = (value: string | number | null | undefined) => {
        const text = String(value ?? '');
        const escaped = text.replace(/"/g, '""');
        return `"${escaped}"`;
    };

    const handleExportExcel = () => {
        const headers = [
            'Invoice ID',
            'Customer ID',
            'Customer Name',
            'No. HP',
            'Alamat',
            'Issue Date',
            'Due Date',
            'Billing Period',
            'Amount',
            'Status',
        ];
        const rows = processedInvoices.map((invoice) => {
            const customer = customersMap[invoice.customerId];
            return [
                invoice.id,
                invoice.customerId,
                customer?.name || '',
                customer?.phone || '',
                customer?.address || '',
                formatDateDisplay(invoice.issueDate),
                formatDateDisplay(invoice.dueDate),
                formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd),
                formatRupiah(invoice.amount),
                invoice.status,
            ];
        });
        const csv = [
            headers.map(toCsvValue).join(','),
            ...rows.map(row => row.map(toCsvValue).join(',')),
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        downloadBlob(blob, `billing-export-${Date.now()}.csv`);
    };

    const handleExportPdf = () => {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            showNotification('jsPDF is not available for export.', 'error');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const margin = 36;
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const cellPadding = 5;

        const columns = [
            { label: 'Invoice ID', width: 80 },
            { label: 'Customer', width: 120 },
            { label: 'No. HP', width: 80 },
            { label: 'Alamat', width: 170 },
            { label: 'Issue', width: 60 },
            { label: 'Due', width: 60 },
            { label: 'Amount', width: 80 },
            { label: 'Status', width: 70 },
        ];
        
        let y = 0; // Start y at 0 and position dynamically

        const drawHeader = () => {
            y += 50; // Initial top margin
            let x = margin;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            columns.forEach(col => {
                doc.text(col.label, x + cellPadding, y); // y is baseline
                x += col.width;
            });
            y += 10; // Space after header text
            doc.setLineWidth(0.5);
            doc.line(margin, y, pageW - margin, y);
            y += cellPadding; // Space before first content row
        };
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('Billing Export', margin, 35);
        
        drawHeader();

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const contentLineHeight = doc.getFontSize() * 1.15; // jsPDF's default line spacing factor

        processedInvoices.forEach((invoice) => {
            const customer = customersMap[invoice.customerId];
            const rawRowData = [
                invoice.id,
                customer?.name || invoice.customerId,
                customer?.phone || '',
                customer?.address || '',
                formatDateDisplay(invoice.issueDate),
                formatDateDisplay(invoice.dueDate),
                formatRupiah(invoice.amount),
                invoice.status,
            ];

            let maxLines = 0;
            const processedRow = rawRowData.map((text, idx) => {
                const maxWidth = columns[idx].width - (cellPadding * 2);
                const lines = doc.splitTextToSize(String(text), maxWidth);
                if (lines.length > maxLines) {
                    maxLines = lines.length;
                }
                return lines;
            });
            
            const rowHeight = maxLines * contentLineHeight + (cellPadding * 2);

            if (y + rowHeight > pageH - margin) {
                doc.addPage();
                y = 0;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(14);
                doc.text('Billing Export', margin, 35);
                drawHeader();
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
            }
            
            const textBaselineY = y + cellPadding + doc.getFontSize();
            
            let x = margin;
            processedRow.forEach((lines, idx) => {
                doc.text(lines, x + cellPadding, textBaselineY);
                x += columns[idx].width;
            });
            
            y += rowHeight;
        });

        doc.save(`billing-export-${Date.now()}.pdf`);
    };

    if (isLoading) {
        return <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading billing data...</div>;
    }

    return (
        <div className="space-y-6">
            <InvoiceFormModal 
                isOpen={isFormModalOpen}
                onClose={() => setIsFormModalOpen(false)}
                onSave={handleSaveInvoice}
                customers={customers}
                packages={packages}
                invoice={editingInvoice}
                settings={settings}
                isSaving={isSaving}
                error={modalError}
            />
            <InvoiceDetailModal
                isOpen={!!viewingInvoice}
                onClose={() => setViewingInvoice(null)}
                invoice={viewingInvoice}
                customer={viewingInvoice ? customersMap[viewingInvoice.customerId] : null}
                payments={payments}
                customerPackage={viewingInvoice ? packagesMap[customersMap[viewingInvoice.customerId]?.packageId] : null}
            />
            <DeleteConfirmationModal 
                isOpen={deletingMode !== null}
                onClose={() => { setDeletingInvoice(null); setDeletingMode(null); }}
                onConfirm={confirmDelete}
                itemName={deletingMode === 'bulk' ? `${selectedInvoices.length} invoice(s)` : deletingInvoice?.id || ''}
                itemType="invoice"
                isLoading={isBulkActionInProgress}
            />
             <ManualPaymentModal
                isOpen={!!manualPaymentInvoice}
                onClose={() => setManualPaymentInvoice(null)}
                onConfirm={handleConfirmManualPayment}
                invoice={manualPaymentInvoice}
            />
            <AdminPaymentModal 
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                onConfirm={handleGenerateClosedLink}
                invoice={payingInvoice}
                channels={paymentChannels}
                isLoading={isLoadingChannels}
            />
             <CopyLinkModal 
                isOpen={!!linkToCopy}
                onClose={() => setLinkToCopy(null)}
                link={linkToCopy || ''}
            />

            {notification.visible && (
                <div className={`fixed top-20 right-8 border px-4 py-3 rounded-lg shadow-lg z-50 ${notification.type === 'success' ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700'}`}>
                    <strong>{notification.type === 'success' ? 'Success!' : 'Error!'}</strong>
                    <span className="block sm:inline ml-2">{notification.message}</span>
                </div>
            )}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Billing & Invoices</h2>
                    {overdueInvoicesCount > 0 && <p className="text-sm text-red-600 dark:text-red-400">{overdueInvoicesCount} invoice(s) are overdue.</p>}
                </div>
                <div className="flex items-center space-x-2 flex-wrap">
                    <button onClick={handleGenerateInvoices} disabled={isGenerating} className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 font-semibold shadow-sm flex items-center disabled:bg-purple-400">
                        {isGenerating && <SpinnerIcon />}
                        {isGenerating ? 'Generating...' : 'Generate Monthly'}
                    </button>
                    <button onClick={handleAddInvoice} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm">
                        Add New Invoice
                    </button>
                    <button onClick={handleExportPdf} className="bg-gray-700 text-white px-4 py-2 rounded-md hover:bg-gray-800 font-semibold shadow-sm">
                        Export PDF
                    </button>
                    <button onClick={handleExportExcel} className="bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 font-semibold shadow-sm">
                        Export Excel
                    </button>
                </div>
            </div>
            
            <Card>
                <div className="p-4 border-b dark:border-gray-700 space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                        <div className="flex flex-wrap gap-2">
                            <button onClick={() => setFilter('all')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border dark:border-gray-600'}`}>All</button>
                            <button onClick={() => setFilter(PaymentStatus.Unpaid)} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === PaymentStatus.Unpaid ? 'bg-yellow-500 text-white shadow-sm' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border dark:border-gray-600'}`}>Unpaid</button>
                            <button onClick={() => setFilter(PaymentStatus.Overdue)} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === PaymentStatus.Overdue ? 'bg-red-600 text-white shadow-sm' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border dark:border-gray-600'}`}>Overdue</button>
                            <button onClick={() => setFilter(PaymentStatus.Paid)} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === PaymentStatus.Paid ? 'bg-green-600 text-white shadow-sm' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border dark:border-gray-600'}`}>Paid</button>
                        </div>
                        <input
                            type="text"
                            placeholder="Search by ID, customer name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-4 pr-4 py-2 border dark:border-gray-600 rounded-md w-full sm:w-80 bg-white dark:bg-gray-800 dark:text-white"
                        />
                        <div className="flex items-center gap-2">
                            <label htmlFor="startDate" className="text-sm font-medium text-gray-600 dark:text-gray-300">From:</label>
                            <input type="date" id="startDate" value={startDate} onChange={e => setStartDate(e.target.value)} className="p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 text-sm" />
                        
                            <label htmlFor="endDate" className="text-sm font-medium text-gray-600 dark:text-gray-300">To:</label>
                            <input type="date" id="endDate" value={endDate} onChange={e => setEndDate(e.target.value)} className="p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 text-sm" />
                        </div>
                    </div>
                     
                     {selectedInvoices.length > 0 && (
                        <div className="flex items-center justify-start gap-4 bg-gray-100 dark:bg-gray-700 p-3 rounded-md flex-wrap">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{selectedInvoices.length} selected</span>
                             <div className="flex items-center gap-2 flex-wrap">
                                <button onClick={handleBulkMarkPaid} disabled={isBulkActionInProgress} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400">Mark Paid</button>
                                <button onClick={handleBulkSendWhatsapp} disabled={isBulkActionInProgress} className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:bg-gray-400">Send WA</button>
                                <button onClick={handleBulkSendEmail} disabled={isBulkActionInProgress} className="px-3 py-1.5 text-sm bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:bg-gray-400">Send Email</button>
                                <button onClick={handleBulkDelete} disabled={isBulkActionInProgress} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400">Delete</button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="overflow-auto" style={{ maxHeight: 'calc(110vh - 240px)' }}>
                   <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
                            <tr>
                                <th className="p-4">
                                     <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        onChange={handleSelectAll}
                                        checked={paginatedInvoices.length > 0 && selectedInvoices.length === paginatedInvoices.length}
                                    />
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Invoice ID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Customer</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                    <button onClick={() => setSortDirection(d => d === 'asc' ? 'desc' : 'asc')} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
                                        Due Date
                                        {sortDirection === 'asc' ? <SortUpIcon /> : <SortDownIcon />}
                                    </button>
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {paginatedInvoices.map(invoice => (
                                <tr key={invoice.id} className={selectedInvoices.includes(invoice.id) ? 'bg-blue-50 dark:bg-blue-900/30' : ''}>
                                    <td className="p-4">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            checked={selectedInvoices.includes(invoice.id)}
                                            onChange={(e) => handleSelectOne(invoice.id, e.target.checked)}
                                        />
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                                         <button onClick={() => setViewingInvoice(invoice)} className="text-blue-600 hover:underline">{invoice.id}</button>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{customersMap[invoice.customerId]?.name || 'N/A'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateDisplay(invoice.dueDate)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-800 dark:text-gray-200">{formatRupiah(invoice.amount)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap"><PaymentStatusTag status={invoice.status} /></td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <div className="flex items-center justify-end space-x-1">
                                            {invoice.status !== 'Paid' && (
                                                <>
                                                    <button onClick={() => setManualPaymentInvoice(invoice)} className="p-2 text-green-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Mark as Paid"><PaidIcon /></button>
                                                    <button onClick={() => { setPayingInvoice(invoice); setIsPaymentModalOpen(true); }} disabled={generatingLink === invoice.id} className="p-2 text-purple-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Generate Payment Link">{generatingLink === invoice.id ? <SpinnerIcon/> : <LinkIcon/>}</button>
                                                    <button onClick={() => handleSendWhatsapp(invoice.id)} disabled={sendingWhatsappId === invoice.id} className="p-2 text-green-500 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Send WhatsApp Notification">{sendingWhatsappId === invoice.id ? <SpinnerIcon/> : <WhatsappIcon/>}</button>
                                                    <button onClick={() => handleSendEmail(invoice.id)} disabled={sendingEmailId === invoice.id} className="p-2 text-sky-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Send Email Notification">{sendingEmailId === invoice.id ? <SpinnerIcon/> : <EmailIcon/>}</button>
                                                </>
                                            )}
                                            <button onClick={() => handleDownloadPdf(invoice)} className="p-2 text-gray-500 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Cetak / Simpan PDF"><PdfIcon /></button>
                                            <button onClick={() => handleEditInvoice(invoice)} className="p-2 text-blue-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Edit Invoice"><EditIcon /></button>
                                            <button onClick={() => { setDeletingInvoice(invoice); setDeletingMode('single'); }} className="p-2 text-red-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Delete Invoice"><TrashIcon /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-between p-4 border-t dark:border-gray-700">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, processedInvoices.length)}
                        {' to '}
                        {Math.min(currentPage * ITEMS_PER_PAGE, processedInvoices.length)}
                        {' of '}
                        {processedInvoices.length} results
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            Previous
                        </button>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Page {currentPage} of {totalPages > 0 ? totalPages : 1}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages || totalPages === 0}
                            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default Billing;
