import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Card from '../../components/common/Card';
import Tag from '../../components/common/Tag';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { Customer, CustomerStatus, Package, PppoeUser, Odp, formatRupiah, formatDateTimeDisplay, HotspotUser, Odc } from '../../types';
import MapPicker from '../../components/common/MapPicker';
import { fetchWithAuth } from '~/components/api';
import TechnicianDeviceModal from '~/components/technician/TechnicianDeviceModal';

interface CustomersProps {
    userRole?: 'admin' | 'technician';
    customersApiBaseOverride?: string;
}


// --- ODP Detail Modal ---
interface OdpDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    odp: Odp | null;
    allOdps: Odp[];
    customers: Customer[];
}

const OdpDetailModal: React.FC<OdpDetailModalProps> = ({ isOpen, onClose, odp, allOdps, customers }) => {
    if (!isOpen || !odp) return null;

    const usedPorts = customers.filter(c => c.odpId === odp.id).length;
    const totalPorts = odp.totalPorts || 0;
    const remainingPorts = totalPorts - usedPorts;
    const parentOdpName = odp.parentId ? (allOdps.find(o => o.id === odp.parentId)?.name || 'N/A') : 'N/A';
    
    const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
        <div className="py-2 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100 sm:mt-0 sm:col-span-2">{value}</dd>
        </div>
    );

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-lg">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">ODP Details</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{odp.name}</p>
                        </div>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    
                    <div className="mt-4 border-t dark:border-gray-700">
                        <dl className="divide-y divide-gray-200 dark:divide-gray-700">
                            <DetailRow label="Address" value={odp.address || 'N/A'} />
                            <DetailRow label="Parent ODP" value={parentOdpName} />
                            <DetailRow label="Total Capacity" value={`${totalPorts} ports`} />
                            <DetailRow label="Used Ports" value={`${usedPorts} ports`} />
                            <DetailRow label="Remaining Ports" value={<span className="font-bold text-green-600 dark:text-green-400">{`${remainingPorts} ports`}</span>} />
                        </dl>
                    </div>

                    <div className="mt-6 flex justify-end space-x-2">
                         <a
                            href={odp.location ? `https://www.google.com/maps?q=${odp.location.lat},${odp.location.lng}` : '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                !odp.location
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                    : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                            aria-disabled={!odp.location}
                            onClick={(e) => !odp.location && e.preventDefault()}
                        >
                            View on Map
                        </a>
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Add Balance Modal ---
interface AddBalanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (amount: number) => Promise<void>;
    customer: Customer | null;
    isSaving: boolean;
}

const AddBalanceModal: React.FC<AddBalanceModalProps> = ({ isOpen, onClose, onConfirm, customer, isSaving }) => {
    const [amount, setAmount] = useState('');

    useEffect(() => {
        if(isOpen) setAmount('');
    }, [isOpen]);

    if (!isOpen || !customer) return null;

    const handleConfirm = () => {
        const numericAmount = parseInt(amount, 10);
        if (numericAmount > 0) {
            onConfirm(numericAmount);
        }
    };

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-sm">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Add Affiliate Balance</h3>
                    <div className="mt-4 space-y-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Customer: <strong className="font-semibold text-gray-700 dark:text-gray-200">{customer.name}</strong>
                            <br/>
                            Current balance: <strong>{formatRupiah(customer.voucher_balance || 0)}</strong>
                        </p>
                        <div>
                            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Amount to Add (IDR)</label>
                            <input
                                type="number"
                                id="amount"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="mt-1 block w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                                min="1"
                                step="1000"
                            />
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end space-x-2">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Cancel</button>
                        <button onClick={handleConfirm} disabled={isSaving || !amount || parseInt(amount, 10) <= 0} type="button" className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:bg-gray-400">
                            {isSaving ? 'Saving...' : 'Confirm'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


const Customers: React.FC<CustomersProps> = ({ userRole = 'admin', customersApiBaseOverride }) => {
    const hoverFloatBtn = 'transition-all duration-300 transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-md';
    const API_BASE = customersApiBaseOverride ?? (userRole === 'technician' ? '/api/technician' : '/api');
    const CUSTOMERS_API_URL = `${API_BASE}/customers`;
    const ADMIN_API_URL = '/api'; // Tetap gunakan /api untuk data pendukung

    const renderCurrentMonthInvoiceStatus = (status?: Customer['currentMonthInvoiceStatus']) => {
        if (!status) {
            return <span className="text-gray-400 dark:text-gray-500">-</span>;
        }

        const statusStyles = {
            Paid: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
            Unpaid: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
            Overdue: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
        };

        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusStyles[status]}`}>
                {status}
            </span>
        );
    };

    const EXPORT_HEADERS = [
        'id',
        'name',
        'nik',
        'address',
        'phone',
        'email',
        'packageId',
        'status',
        'lat',
        'lng',
        'odpId',
        'pppoeUsername',
        'activeDate',
        'acsSerialNumber',
        'previousPppoeProfile',
        'voucher_balance',
        'billing_type',
    ] as const;

    /**
     * Creates a 'YYYY-MM-DDTHH:mm' string from a Date object using its local timezone components.
     * This is necessary because new Date().toISOString() always returns UTC.
     * @param date The date object to convert.
     * @returns A string formatted for datetime-local input.
     */
    const toLocalISOString = (date: Date): string => {
        const pad = (num: number) => num.toString().padStart(2, '0');
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const parseCsv = (text: string): string[][] => {
        const rows: string[][] = [];
        let currentValue = '';
        let currentRow: string[] = [];
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (char === '"' && nextChar === '"') {
                currentValue += '"';
                i++;
                continue;
            }

            if (char === '"') {
                inQuotes = !inQuotes;
                continue;
            }

            if (char === ',' && !inQuotes) {
                currentRow.push(currentValue);
                currentValue = '';
                continue;
            }

            if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && nextChar === '\n') {
                    i++;
                }
                currentRow.push(currentValue);
                rows.push(currentRow);
                currentRow = [];
                currentValue = '';
                continue;
            }

            currentValue += char;
        }

        if (inQuotes) throw new Error('Malformed CSV: unmatched quotes.');
        if (currentValue.length > 0 || currentRow.length > 0) {
            currentRow.push(currentValue);
            rows.push(currentRow);
        }

        return rows.filter(row => row.some(cell => cell.trim() !== ''));
    };


    // --- Icon Components for Bulk Actions ---
    const ActivateIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;
    const SuspendIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>;
    const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
    const MessageIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2-2H4a2 2 0 01-2-2V5zm3.707 2.293a1 1 0 00-1.414 1.414l2.5 2.5a1 1 0 001.414 0l2.5-2.5a1 1 0 00-1.414-1.414L8 8.586 6.707 7.293z" /></svg>;
    const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
    const ExportIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>;
    const ImportIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>;
    const SyncIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566z" clipRule="evenodd" /></svg>;

    // --- Customer Status Tag ---
    const CustomerStatusTag: React.FC<{ status: CustomerStatus }> = ({ status }) => {
        const colorMap: { [key in CustomerStatus]: 'green' | 'red' | 'yellow' | 'blue' } = {
        [CustomerStatus.Active]: 'green',
        [CustomerStatus.Inactive]: 'red',
        [CustomerStatus.Suspended]: 'yellow',
        [CustomerStatus.Unregister]: 'blue',
        };
        return <Tag color={colorMap[status]}>{status}</Tag>;
    };

    // --- Customer Form Modal ---
    interface CustomerFormModalProps {
        isOpen: boolean;
        onClose: () => void;
        onSave: (customer: any) => Promise<void>;
        customer: Customer | null;
        packages: Package[];
        pppoeUsers: PppoeUser[];
        odps: Odp[];
        odcs: Odc[];
        allCustomers: Customer[];
        isSaving: boolean;
    }

    const CustomerFormModal: React.FC<CustomerFormModalProps> = ({ isOpen, onClose, onSave, customer, packages, pppoeUsers, odps, odcs, allCustomers, isSaving }) => {
        const getInitialState = useCallback(() => ({
            name: '',
            nik: '',
            address: '',
            phone: '',
            email: '',
            packageId: packages[0]?.id || 0,
            status: CustomerStatus.Active,
            location: null,
            odpId: '',
            pppoeUsername: '',
            activeDate: toLocalISOString(new Date()),
            acsSerialNumber: '', // Initialize new field
            billing_type: 'postpaid',
            createNewPppoe: false,
            newPppoeUsername: '',
            newPppoePassword: '',
        }), [packages]);

        const [formData, setFormData] = useState<any>(getInitialState());
        const [pppoeSearch, setPppoeSearch] = useState('');
        const [isPppoeDropdownOpen, setIsPppoeDropdownOpen] = useState(false);
        const [selectedOdc, setSelectedOdc] = useState<Odc | null>(null);
        const [odcSearch, setOdcSearch] = useState('');
        const [isOdcDropdownOpen, setIsOdcDropdownOpen] = useState(false);
        const [odpSearch, setOdpSearch] = useState('');
        const [isOdpDropdownOpen, setIsOdpDropdownOpen] = useState(false);


        useEffect(() => {
            if (isOpen) {
                if (customer) {
                    const existingDate = customer.activeDate ? new Date(customer.activeDate) : new Date();
                    setFormData({
                        ...customer,
                        nik: customer.nik || '',
                        activeDate: toLocalISOString(existingDate),
                        location: customer.location || null,
                        billing_type: customer.billing_type || 'postpaid',
                        createNewPppoe: false,
                        newPppoeUsername: '',
                        newPppoePassword: '',
                    });
                    setPppoeSearch(customer.pppoeUsername || '');

                    // Pre-fill ODC and ODP
                    if (customer.odpId) {
                        const customerOdp = odps.find(o => o.id === customer.odpId);
                        if (customerOdp && customerOdp.parentId) {
                            const parentOdc = odcs.find(c => c.id === customerOdp.parentId);
                            if (parentOdc) {
                                setSelectedOdc(parentOdc);
                                setOdcSearch(parentOdc.name);
                                setOdpSearch(customerOdp.name);
                            }
                        } else if(customerOdp) {
                           setOdpSearch(customerOdp.name); // Maybe it has no parent
                        }
                    } else {
                        setSelectedOdc(null);
                        setOdcSearch('');
                        setOdpSearch('');
                    }

                } else {
                    setFormData(getInitialState());
                    setPppoeSearch('');
                    setSelectedOdc(null);
                    setOdcSearch('');
                    setOdpSearch('');
                }
            }
        }, [customer, isOpen, getInitialState, odps, odcs]);

        const customersMap = useMemo(() => {
            if (!allCustomers) return {};
            return allCustomers.reduce((acc, cust) => {
                acc[cust.id] = cust.name;
                return acc;
            }, {} as Record<string, string>);
        }, [allCustomers]);
        
        const filteredPppoeUsers = useMemo(() => {
            if (!pppoeSearch) return pppoeUsers;
            const lowercasedQuery = pppoeSearch.toLowerCase();
            return pppoeUsers.filter(u => 
                u.name.toLowerCase().includes(lowercasedQuery) ||
                (customersMap[u.comment] || '').toLowerCase().includes(lowercasedQuery)
            );
        }, [pppoeSearch, pppoeUsers, customersMap]);

        // ODC and ODP search logic
        const filteredOdcs = useMemo(() => {
            return odcs.filter(odc => odc.name.toLowerCase().includes(odcSearch.toLowerCase()));
        }, [odcs, odcSearch]);

        const filteredOdps = useMemo(() => {
            if (!selectedOdc) return [];
            return odps.filter(odp => 
                odp.parentId === selectedOdc.id &&
                odp.name.toLowerCase().includes(odpSearch.toLowerCase())
            );
        }, [odps, selectedOdc, odpSearch]);


        if (!isOpen) return null;

        const handleSubmit = (e: React.FormEvent) => {
            e.preventDefault();
            onSave({ ...formData, id: customer?.id });
        };

        const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
            const { name, value, type } = e.target;
            const checked = (e.target as HTMLInputElement).checked;
            setFormData((prev: any) => ({
                ...prev,
                [name]: type === 'checkbox' ? checked : type === 'number' ? parseInt(value, 10) : value,
            }));
        };

        const handleLocationChange = (location: { lat: number; lng: number }) => {
            setFormData((prev: any) => ({ ...prev, location }));
        };

        const handleManualCoordChange = (axis: 'lat' | 'lng', value: string) => {
            const coordValue = parseFloat(value);
            if (!isNaN(coordValue)) {
                setFormData((prev: any) => ({
                    ...prev,
                    location: {
                        ...(prev.location || { lat: 0, lng: 0 }),
                        [axis]: coordValue,
                    },
                }));
            } else {
                setFormData((prev: any) => ({
                    ...prev,
                    location: {
                        ...(prev.location || { lat: 0, lng: 0 }),
                        [axis]: '',
                    },
                }));
            }
        };

        const handlePppoeSelect = (username: string) => {
            setPppoeSearch(username);
            handleInputChange({ target: { name: 'pppoeUsername', value: username } } as any);
            setIsPppoeDropdownOpen(false);
        };

        const handleOdcSelect = (odc: Odc) => {
            setSelectedOdc(odc);
            setOdcSearch(odc.name);
            setIsOdcDropdownOpen(false);
            // Reset ODP when ODC changes
            setFormData((prev: any) => ({ ...prev, odpId: '' }));
            setOdpSearch('');
        };
        
        const handleOdpSelect = (odp: Odp) => {
            setFormData((prev: any) => ({ ...prev, odpId: odp.id }));
            setOdpSearch(odp.name);
            setIsOdpDropdownOpen(false);
        };

        const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white";
        
        return (
            <div className="fixed z-20 inset-0 overflow-y-auto">
                <div className="flex items-center justify-center min-h-screen p-4">
                    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                        <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{customer ? 'Edit Customer' : 'Add New Customer'}</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Personal Info */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <input type="text" name="name" placeholder="Full Name" value={formData.name} onChange={handleInputChange} className={inputClasses} required />
                                <input type="text" name="nik" placeholder="NIK" value={formData.nik} onChange={handleInputChange} className={inputClasses} />
                                <input type="email" name="email" placeholder="Email Address" value={formData.email} onChange={handleInputChange} className={inputClasses} />
                                <input type="tel" name="phone" placeholder="Phone Number" value={formData.phone} onChange={handleInputChange} className={inputClasses} required />
                                <input type="datetime-local" name="activeDate" value={formData.activeDate} onChange={handleInputChange} className={inputClasses} required />
                            </div>
                            <textarea name="address" placeholder="Address" value={formData.address} onChange={handleInputChange} className={inputClasses} rows={3}></textarea>
                            
                            {/* Service Info */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t dark:border-gray-600">
                                <select name="packageId" value={formData.packageId} onChange={handleInputChange} className={inputClasses} required>
                                    {packages.map(p => <option key={p.id} value={p.id}>{p.name} ({formatRupiah(p.price)})</option>)}
                                </select>
                                <select name="status" value={formData.status} onChange={handleInputChange} className={inputClasses}>
                                    {Object.values(CustomerStatus).map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Billing Type</label>
                                    <select name="billing_type" value={formData.billing_type} onChange={handleInputChange} className={inputClasses}>
                                        <option value="postpaid">Postpaid (Monthly 1st-30th)</option>
                                        <option value="fixed">Fixed Date (Anniversary)</option>
                                    </select>
                                </div>
                                
                                <div className="relative md:col-span-1">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ODC</label>
                                    <input type="text" placeholder="Search ODC" value={odcSearch} onChange={e => setOdcSearch(e.target.value)} onFocus={() => setIsOdcDropdownOpen(true)} onBlur={() => setTimeout(() => setIsOdcDropdownOpen(false), 150)} className={inputClasses} />
                                    {isOdcDropdownOpen && (
                                        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-md shadow-lg max-h-40 overflow-y-auto">
                                            {filteredOdcs.map(odc => (
                                                <button type="button" key={odc.id} onMouseDown={e => {e.preventDefault(); handleOdcSelect(odc);}} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600">{odc.name}</button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                
                                <div className="relative md:col-span-1">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ODP</label>
                                    <input type="text" placeholder="Search ODP" value={odpSearch} onChange={e => setOdpSearch(e.target.value)} onFocus={() => setIsOdpDropdownOpen(true)} onBlur={() => setTimeout(() => setIsOdpDropdownOpen(false), 150)} className={inputClasses} disabled={!selectedOdc} />
                                    {isOdpDropdownOpen && selectedOdc && (
                                        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-md shadow-lg max-h-40 overflow-y-auto">
                                            {filteredOdps.map(odp => (
                                                <button type="button" key={odp.id} onMouseDown={e => {e.preventDefault(); handleOdpSelect(odp);}} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600">{odp.name}</button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="md:col-span-2">
                                    <input
                                        type="text"
                                        name="acsSerialNumber"
                                        placeholder="ACS Device Serial Number (Optional)"
                                        value={formData.acsSerialNumber || ''}
                                        onChange={handleInputChange}
                                        className={inputClasses}
                                    />
                                </div>
                            </div>

                            {/* PPPoE Info */}
                            <div className="pt-4 border-t dark:border-gray-600 space-y-4">
                                <div className="flex items-center">
                                    <input id="createNewPppoe" name="createNewPppoe" type="checkbox" checked={formData.createNewPppoe} onChange={handleInputChange} className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                                    <label htmlFor="createNewPppoe" className="ml-2 block text-sm text-gray-900 dark:text-gray-200">Create New PPPoE User</label>
                                </div>
                                {formData.createNewPppoe ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-blue-50 dark:bg-gray-700/50 rounded-md">
                                        <input type="text" name="newPppoeUsername" placeholder="New PPPoE Username" value={formData.newPppoeUsername} onChange={handleInputChange} className={inputClasses} required />
                                        <input type="password" name="newPppoePassword" placeholder="New PPPoE Password" value={formData.newPppoePassword} onChange={handleInputChange} className={inputClasses} required />
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="Search and select PPPoE User (Optional)"
                                            value={pppoeSearch}
                                            onChange={(e) => {
                                                setPppoeSearch(e.target.value);
                                                handleInputChange(e as any); // Update form data as well
                                            }}
                                            onFocus={() => setIsPppoeDropdownOpen(true)}
                                            onBlur={() => setTimeout(() => setIsPppoeDropdownOpen(false), 150)}
                                            className={inputClasses}
                                            name="pppoeUsername"
                                        />
                                        {isPppoeDropdownOpen && (
                                            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                                <ul>
                                                    <li key="unlink">
                                                        <button 
                                                            type="button" 
                                                            onMouseDown={(e) => { e.preventDefault(); handlePppoeSelect(''); }} 
                                                            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 italic"
                                                        >
                                                            None (Unlink)
                                                        </button>
                                                    </li>
                                                    {filteredPppoeUsers.length > 0 ? (
                                                        filteredPppoeUsers.map(u => {
                                                            const isLinkedToOther = u.comment && u.comment !== customer?.id;
                                                            const linkedToText = isLinkedToOther ? `(Linked: ${customersMap[u.comment] || u.comment})` : '';
                                                            return (
                                                                <li key={u.id}>
                                                                    <button 
                                                                        type="button" 
                                                                        onMouseDown={(e) => { e.preventDefault(); handlePppoeSelect(u.name); }} 
                                                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                                                                    >
                                                                        {u.name} <span className="text-xs text-gray-500">{linkedToText}</span>
                                                                    </button>
                                                                </li>
                                                            );
                                                        })
                                                    ) : (
                                                        <li className="px-4 py-2 text-sm text-gray-500">No users found.</li>
                                                    )}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Location Info */}
                            <div className="pt-4 border-t dark:border-gray-600">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Location</label>
                                <div className="mt-2 space-y-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <input
                                            type="number"
                                            step="any"
                                            placeholder="Latitude"
                                            value={formData.location?.lat ?? ''}
                                            onChange={(e) => handleManualCoordChange('lat', e.target.value)}
                                            className={inputClasses}
                                        />
                                        <input
                                            type="number"
                                            step="any"
                                            placeholder="Longitude"
                                            value={formData.location?.lng ?? ''}
                                            onChange={(e) => handleManualCoordChange('lng', e.target.value)}
                                            className={inputClasses}
                                        />
                                    </div>
                                    <MapPicker value={formData.location} onChange={handleLocationChange} />
                                </div>
                            </div>

                            <div className="flex justify-end space-x-2 pt-4">
                                <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded">Cancel</button>
                                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400">
                                    {isSaving ? 'Saving...' : 'Save Customer'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    };

    // --- Bulk Message Modal ---
    interface BulkMessageModalProps {
        isOpen: boolean;
        onClose: () => void;
        recipientCount: number;
        onSend: (message: string) => Promise<void>;
    }

    const BulkMessageModal: React.FC<BulkMessageModalProps> = ({ isOpen, onClose, recipientCount, onSend }) => {
        const [message, setMessage] = useState('');
        const [isSending, setIsSending] = useState(false);
        const [response, setResponse] = useState<{ type: 'success' | 'error', message: string } | null>(null);

        useEffect(() => {
            if (isOpen) {
                setMessage('');
                setResponse(null);
                setIsSending(false);
            }
        }, [isOpen]);

        if (!isOpen) return null;

        const handleSend = async () => {
            if (!message.trim()) {
                setResponse({ type: 'error', message: 'Message cannot be empty.' });
                return;
            }
            setIsSending(true);
            setResponse(null);
            try {
                await onSend(message);
                setResponse({ type: 'success', message: 'Message sent successfully!' });
            } catch (error: any) {
                setResponse({ type: 'error', message: error.message });
            } finally {
                setIsSending(false);
            }
        };

        const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white focus:ring-blue-500 focus:border-blue-500";

        return (
            <div className="fixed z-20 inset-0 overflow-y-auto">
                <div className="flex items-center justify-center min-h-screen p-4">
                    <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose}></div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-lg">
                        <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">Send WhatsApp Message</h2>
                        <div className="space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                                This message will be sent to <strong>{recipientCount}</strong> selected customer(s).
                            </p>
                            <div>
                                <label htmlFor="message" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Message</label>
                                <textarea id="message" name="message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} className={`mt-1 ${inputClasses}`} placeholder="Type your message here..."></textarea>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {'You can use placeholders: `{{customerName}}` and `{{customerId}}`.'}
                                </p>
                            </div>
                            {response && (
                                <div className={`p-3 rounded-md text-sm ${response.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {response.message}
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end space-x-2 pt-6">
                            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded">Cancel</button>
                            <button type="button" onClick={handleSend} disabled={isSending} className="px-4 py-2 bg-purple-600 text-white rounded flex items-center justify-center disabled:bg-purple-400 disabled:cursor-wait">
                                {isSending ? 'Sending...' : 'Send Message'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };


    // --- Main Component ---
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [packages, setPackages] = useState<Package[]>([]);
    const [pppoeUsers, setPppoeUsers] = useState<PppoeUser[]>([]);
    const [odps, setOdps] = useState<Odp[]>([]);
    const [odcs, setOdcs] = useState<Odc[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
    const [deletingMode, setDeletingMode] = useState<'single' | 'bulk' | null>(null);
    const [bulkActionInProgress, setBulkActionInProgress] = useState<string | null>(null);
    const [isBulkMessageModalOpen, setIsBulkMessageModalOpen] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | CustomerStatus>('all');
    const [editingState, setEditingState] = useState<{ customerId: string | null, value: string }>({ customerId: null, value: '' });
    const [deviceModalCustomer, setDeviceModalCustomer] = useState<Customer | null>(null);
    const [viewingOdpDetail, setViewingOdpDetail] = useState<Odp | null>(null);
    const [balancingCustomer, setBalancingCustomer] = useState<Customer | null>(null);
    const [isSavingBalance, setIsSavingBalance] = useState(false);
    const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
    const [bonusVoucher, setBonusVoucher] = useState<HotspotUser | null>(null);
    const [isVoucherLoading, setIsVoucherLoading] = useState(false);
    const [isCreatingVoucher, setIsCreatingVoucher] = useState(false);
    const [isSyncingVouchers, setIsSyncingVouchers] = useState(false);
    const [isRepairingPppoeLinks, setIsRepairingPppoeLinks] = useState(false);
    
    // State for import/export
    const [isImporting, setIsImporting] = useState(false);
    const [importResult, setImportResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [repairResult, setRepairResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    // --- Icon Components for Table Actions ---
    const MapIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>;
    const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>;
    const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
    const WifiIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.555a5.5 5.5 0 017.778 0M12 20.25a.75.75 0 100-1.5.75.75 0 000 1.5zM4.444 12.889a10 10 0 0115.112 0" /></svg>;
    const CashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M8.433 7.418c.158-.103.346-.196.567-.267v1.698a2.5 2.5 0 00-1.168-.217c-.737 0-1.33.664-1.33 1.475 0 .81.593 1.474 1.33 1.474.737 0 1.33-.664 1.33-1.474v-1.111h1.112v-1.698c.158-.103.346-.196.567-.267v1.698a2.5 2.5 0 00-1.168-.217c-.737 0-1.33.664-1.33 1.475 0 .81.593 1.474 1.33 1.474.737 0 1.33-.664 1.33-1.474V10.1c.158.103-.346.196-.567.267V11.5c0 1.683-1.317 3.03-2.969 3.03s-2.969-1.347-2.969-3.03V10.367c.22.071.409.164.567.267v.866c0 .81.593 1.475 1.33 1.475.737 0 1.33-.665 1.33-1.475V10.1c-.158.103-.346.196-.567.267V11.5a2.5 2.5 0 001.168.217c.737 0 1.33-.664 1.33-1.475 0-.81-.593-1.474-1.33-1.474-.737 0-1.33.664-1.33 1.474V11.5c-.22.071-.409.164-.567.267v-.866c0-1.683 1.317-3.03 2.969-3.03s2.969 1.347 2.969 3.03V10.367c-.22.071-.409.164-.567.267V9.5c0-1.683-1.317-3.03-2.969-3.03s-2.969-1.347-2.969-3.03V9.5z" /><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM3 10a7 7 0 1114 0 7 7 0 01-14 0z" clipRule="evenodd" /></svg>;

    useEffect(() => {
        const handleUrlFilter = () => {
            const hash = window.location.hash;
            if (hash.includes('?')) {
                const params = new URLSearchParams(hash.split('?')[1]);
                const status = params.get('status') as CustomerStatus;

                if (status && Object.values(CustomerStatus).includes(status)) {
                    setStatusFilter(status);
                    window.history.replaceState(null, '', '#admin/customers');
                }
            }
        };
        handleUrlFilter();
    }, []);


    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [customersRes, packagesRes, pppoeUsersRes, odpsRes, odcsRes] = await Promise.all([
                fetchWithAuth(CUSTOMERS_API_URL),
                fetchWithAuth(`${ADMIN_API_URL}/network/packages`),
                fetchWithAuth(`${ADMIN_API_URL}/pppoe/users`),
                fetchWithAuth(`${ADMIN_API_URL}/network/odps`),
                fetchWithAuth(`${ADMIN_API_URL}/network/odcs`),
            ]);
            setCustomers(await customersRes.json());
            setPackages(await packagesRes.json());
            setPppoeUsers(await pppoeUsersRes.json());
            setOdps(await odpsRes.json());
            setOdcs(await odcsRes.json());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [CUSTOMERS_API_URL]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    const handleAddBalance = async (amount: number) => {
        if (!balancingCustomer) return;
        setIsSavingBalance(true);
        setError(null);
        try {
            const response = await fetchWithAuth(`${ADMIN_API_URL}/customers/${balancingCustomer.id}/add-balance`, {
                method: 'POST',
                body: JSON.stringify({ amount }),
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload?.message || 'Failed to add balance.');
            }

            setCustomers(prev =>
                prev.map(customer =>
                    customer.id === balancingCustomer.id
                        ? {
                              ...customer,
                              voucher_balance:
                                  typeof payload?.newBalance === 'number'
                                      ? payload.newBalance
                                      : (Number(customer.voucher_balance) || 0) + amount,
                          }
                        : customer
                )
            );

            setBalancingCustomer(null);
        } catch (err: any) {
            setError(err.message || 'Failed to add balance.');
        } finally {
            setIsSavingBalance(false);
        }
    };

    const packagesMap = useMemo(() => {
        return packages.reduce((acc, pkg) => {
            acc[pkg.id] = pkg;
            return acc;
        }, {} as Record<number, Package>);
    }, [packages]);

    const odpsMap = useMemo(() => {
        return odps.reduce((acc, odp) => {
            acc[odp.id] = odp.name;
            return acc;
        }, {} as Record<string, string>);
    }, [odps]);

    const customerCountsByStatus = useMemo(() => {
        return customers.reduce((acc, customer) => {
            acc[customer.status] = (acc[customer.status] || 0) + 1;
            return acc;
        }, {} as { [key in CustomerStatus]: number });
    }, [customers]);

    const filteredCustomers = useMemo(() => {
        let tempCustomers = customers;

        if (statusFilter !== 'all') {
            tempCustomers = tempCustomers.filter(c => c.status === statusFilter);
        }

        const lowercasedQuery = searchQuery.toLowerCase();
        if (!lowercasedQuery) return tempCustomers;

        return tempCustomers.filter(c =>
            c.name.toLowerCase().includes(lowercasedQuery) ||
            c.id.toLowerCase().includes(lowercasedQuery) ||
            (c.address || '').toLowerCase().includes(lowercasedQuery) ||
            c.phone.toLowerCase().includes(lowercasedQuery) ||
            (c.pppoeUsername || '').toLowerCase().includes(lowercasedQuery) ||
            (c.acsSerialNumber || '').toLowerCase().includes(lowercasedQuery)
        );
    }, [customers, searchQuery, statusFilter]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, statusFilter]);

    const totalPages = Math.ceil(filteredCustomers.length / ITEMS_PER_PAGE);
    const paginatedCustomers = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredCustomers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredCustomers, currentPage]);

    const handleSaveCustomer = async (customerData: any) => {
        setIsSaving(true);
        setError(null);
        const isEditing = !!customerData.id;
        const url = isEditing ? `${CUSTOMERS_API_URL}/${customerData.id}` : CUSTOMERS_API_URL;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            await fetchWithAuth(url, {
                method,
                body: JSON.stringify(customerData),
            });
            await fetchData();
            setIsModalOpen(false);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    };
    
    const confirmDelete = async () => {
        setError(null);
        try {
            if (deletingMode === 'bulk') {
                setBulkActionInProgress('delete');
                await fetchWithAuth(`${CUSTOMERS_API_URL}/bulk-delete`, {
                    method: 'POST',
                    body: JSON.stringify({ ids: selectedCustomers }),
                });
            } else if (deletingCustomer) {
                await fetchWithAuth(`${CUSTOMERS_API_URL}/${deletingCustomer.id}`, { method: 'DELETE' });
            } else {
                return;
            }
            
            await fetchData();
            setSelectedCustomers([]);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setDeletingCustomer(null);
            setDeletingMode(null);
            setBulkActionInProgress(null);
        }
    };

    const handleUpdateCustomerId = async () => {
        if (!editingState.customerId || !editingState.value.trim()) return;
        setError(null);
        try {
            await fetchWithAuth(`${CUSTOMERS_API_URL}/${editingState.customerId}/update-id`, {
                method: 'PUT',
                body: JSON.stringify({ newId: editingState.value }),
            });
            setEditingState({ customerId: null, value: '' });
            await fetchData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleSelectOne = (customerId: string, isSelected: boolean) => {
        setSelectedCustomers(prev => isSelected ? [...prev, customerId] : prev.filter(id => id !== customerId));
    };

    const handleSelectAllOnPage = (e: React.ChangeEvent<HTMLInputElement>) => {
        const pageIds = paginatedCustomers.map(c => c.id);
        if (e.target.checked) {
            setSelectedCustomers(prev => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedCustomers(prev => prev.filter(id => !pageIds.includes(id)));
        }
    };
    
    const areAllOnPageSelected = paginatedCustomers.length > 0 && paginatedCustomers.every(c => selectedCustomers.includes(c.id));

    const handleBulkStatusChange = async (status: CustomerStatus) => {
        setBulkActionInProgress(status);
        setError(null);
        try {
            await fetchWithAuth(`${CUSTOMERS_API_URL}/bulk-status`, {
                method: 'POST',
                body: JSON.stringify({ ids: selectedCustomers, status }),
            });
            await fetchData();
            setSelectedCustomers([]);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setBulkActionInProgress(null);
        }
    };

    const handleDeleteSelected = () => {
        if (selectedCustomers.length > 0) {
            setDeletingMode('bulk');
        }
    };

    const handleSendBulkMessage = async (message: string) => {
        setError(null);
        try {
            await fetchWithAuth(`${CUSTOMERS_API_URL}/bulk-whatsapp`, {
                method: 'POST',
                body: JSON.stringify({ ids: selectedCustomers, message }),
            });
        } catch (error: any) {
            throw error;
        }
    };
    
    const handleExport = () => {
        const csvRows = [EXPORT_HEADERS.join(',')];

        const dataToExport = filteredCustomers.length > 0 ? filteredCustomers : customers;

        for (const customer of dataToExport) {
            const values = EXPORT_HEADERS.map(header => {
                let value;
                if (header === 'lat') value = customer.location?.lat;
                else if (header === 'lng') value = customer.location?.lng;
                else value = (customer as any)[header];

                const stringValue = value === null || value === undefined ? '' : String(value);
                return `"${stringValue.replace(/"/g, '""')}"`;
            });
            csvRows.push(values.join(','));
        }

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `customers-export-${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setImportResult(null);
        setIsImporting(true);
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            try {
                const text = (e.target?.result as string) || '';
                const rows = parseCsv(text);
                if (rows.length < 2) throw new Error("CSV file must have a header and at least one data row.");

                const header = rows[0].map(h => h.trim().replace(/"/g, ''));
                const customersToImport: any[] = [];

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    const customer: any = {};

                    header.forEach((key, index) => {
                        const rawValue = row[index] ?? '';
                        const trimmedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
                        if (!trimmedValue) return;

                        if (key === 'lat' || key === 'lng') {
                            const coord = parseFloat(trimmedValue);
                            if (!Number.isNaN(coord)) customer[key] = coord;
                        } else if (key === 'packageId') {
                            const parsedPackageId = parseInt(trimmedValue, 10);
                            if (!Number.isNaN(parsedPackageId)) customer.packageId = parsedPackageId;
                        } else if (key === 'voucher_balance') {
                            const parsedBalance = parseFloat(trimmedValue);
                            if (!Number.isNaN(parsedBalance)) customer.voucher_balance = parsedBalance;
                        } else if (key === 'billing_type') {
                            customer.billing_type = trimmedValue === 'fixed' ? 'fixed' : 'postpaid';
                        } else {
                            customer[key] = trimmedValue;
                        }
                    });

                    if (Object.keys(customer).length > 0) {
                        customersToImport.push(customer);
                    }
                }

                if (customersToImport.length === 0) throw new Error('No valid rows found in the CSV file.');

                const res = await fetchWithAuth(`${CUSTOMERS_API_URL}/import`, {
                    method: 'POST',
                    body: JSON.stringify(customersToImport),
                });
                const data = await res.json();
                
                setImportResult({ type: 'success', message: data.message });
                await fetchData();
            } catch (err: any) {
                setImportResult({ type: 'error', message: err.message });
            } finally {
                setIsImporting(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        };

        reader.readAsText(file);
    };

    const handleRepairPppoeLinks = async () => {
        const confirmed = window.confirm('Repair PPPoE linking for all customers now?');
        if (!confirmed) return;

        setError(null);
        setImportResult(null);
        setRepairResult(null);
        setIsRepairingPppoeLinks(true);
        try {
            const res = await fetchWithAuth(`${CUSTOMERS_API_URL}/repair-pppoe-links`, {
                method: 'POST',
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload?.message || 'Failed to repair PPPoE links.');
            }

            const message = `${payload.message} Username fixed: ${payload.fixedUsernameCount || 0}, comment fixed: ${payload.fixedCommentCount || 0}, not found on router: ${payload.notFoundOnRouterCount || 0}, conflicts skipped: ${payload.skippedConflictCount || 0}.`;
            setRepairResult({ type: 'success', message });
            await fetchData();
        } catch (err: any) {
            setRepairResult({ type: 'error', message: err.message || 'Failed to repair PPPoE links.' });
        } finally {
            setIsRepairingPppoeLinks(false);
        }
    };

    const FilterButton: React.FC<{ status: 'all' | CustomerStatus, label: string, count?: number }> = ({ status, label, count }) => (
        <button 
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 ${hoverFloatBtn} ${statusFilter === status ? 'bg-blue-600 text-white shadow-sm' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 border dark:border-gray-600'}`}
        >
            {label}
            {typeof count === 'number' && (
                <span className={`px-2 py-0.5 rounded-full text-xs ${statusFilter === status ? 'bg-blue-400 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
                    {count}
                </span>
            )}
        </button>
    );

    const toggleExpandCustomer = async (customerId: string) => {
        const newExpandedId = expandedCustomerId === customerId ? null : customerId;
        setExpandedCustomerId(newExpandedId);

        if (newExpandedId) {
            setIsVoucherLoading(true);
            setBonusVoucher(null); // Clear previous
            try {
                const res = await fetchWithAuth(`${ADMIN_API_URL}/customers/${newExpandedId}/bonus-voucher`);
                const data = await res.json();
                setBonusVoucher(data);
            } catch (err) {
                console.error("Failed to fetch bonus voucher for customer", err);
            } finally {
                setIsVoucherLoading(false);
            }
        } else {
            setBonusVoucher(null); // Clear when collapsing
        }
    };
    
    const handleCreateBonusVoucher = async (customerId: string) => {
        setIsCreatingVoucher(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${ADMIN_API_URL}/customers/${customerId}/create-bonus-voucher`, {
                method: 'POST',
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to create voucher.');
            }
            const newVoucher = await res.json();
            alert(`Successfully created bonus voucher: ${newVoucher.name}`);
            // Refresh the details for this customer to show the new voucher
            await toggleExpandCustomer(customerId); // Close
            await toggleExpandCustomer(customerId); // And re-open to trigger fetch
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsCreatingVoucher(false);
        }
    };
    
    const handleSyncVouchers = async () => {
        if (!window.confirm("This will check all active customers and create a bonus voucher for any who are missing one based on your settings. This may take a moment. Continue?")) {
            return;
        }
        setIsSyncingVouchers(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${ADMIN_API_URL}/customers/sync-bonus-vouchers`, {
                method: 'POST'
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            alert(data.message);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSyncingVouchers(false);
        }
    };

    if (isLoading) return <p>Loading customers...</p>;

    const DetailItem: React.FC<{ label: string, children: React.ReactNode }> = ({ label, children }) => (
        <div>
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{children || '-'}</dd>
        </div>
    );


    return (
        <div className="space-y-6">
            <AddBalanceModal 
                isOpen={!!balancingCustomer}
                onClose={() => setBalancingCustomer(null)}
                onConfirm={handleAddBalance}
                customer={balancingCustomer}
                isSaving={isSavingBalance}
            />
            <OdpDetailModal
                isOpen={!!viewingOdpDetail}
                onClose={() => setViewingOdpDetail(null)}
                odp={viewingOdpDetail}
                allOdps={odps}
                customers={customers}
            />
            <TechnicianDeviceModal isOpen={!!deviceModalCustomer} customer={deviceModalCustomer} onClose={() => setDeviceModalCustomer(null)} />
            <CustomerFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveCustomer}
                customer={editingCustomer}
                packages={packages}
                pppoeUsers={pppoeUsers}
                odps={odps}
                odcs={odcs}
                allCustomers={customers}
                isSaving={isSaving}
            />
            {userRole === 'admin' && (
                <>
                    <BulkMessageModal
                        isOpen={isBulkMessageModalOpen}
                        onClose={() => setIsBulkMessageModalOpen(false)}
                        recipientCount={selectedCustomers.length}
                        onSend={handleSendBulkMessage}
                    />
                    <DeleteConfirmationModal
                        isOpen={deletingMode !== null}
                        onClose={() => { setDeletingCustomer(null); setDeletingMode(null); }}
                        onConfirm={confirmDelete}
                        itemName={deletingMode === 'bulk' ? `${selectedCustomers.length} customer(s)` : deletingCustomer?.name || ''}
                        itemType="customer"
                        isLoading={bulkActionInProgress === 'delete'}
                    />
                </>
            )}

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Customers</h2>
                 <div className="flex items-center space-x-2 flex-wrap">
                    {userRole === 'admin' && (
                        <>
                             <button
                                onClick={handleSyncVouchers}
                                disabled={isSyncingVouchers}
                                className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 font-semibold shadow-sm border dark:border-gray-600 disabled:opacity-50"
                            >
                                {isSyncingVouchers ? <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <SyncIcon />}
                                {isSyncingVouchers ? 'Syncing...' : 'Sync Bonus Vouchers'}
                            </button>
                            <button
                                onClick={handleExport}
                                className="flex items-center gap-2 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 font-semibold shadow-sm border dark:border-gray-600"
                            >
                                <ExportIcon />
                                Export
                            </button>
                            <button
                                onClick={handleRepairPppoeLinks}
                                disabled={isRepairingPppoeLinks}
                                className={`flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-md font-semibold shadow-sm border dark:border-gray-600 disabled:opacity-50 hover:bg-amber-600 ${hoverFloatBtn}`}
                            >
                                {isRepairingPppoeLinks ? <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <SyncIcon />}
                                {isRepairingPppoeLinks ? 'Repairing...' : 'Repair PPPoE Links'}
                            </button>
                            <input type="file" ref={fileInputRef} onChange={handleImportFileChange} className="hidden" accept=".csv" />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isImporting}
                                className={`flex items-center gap-2 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-md font-semibold shadow-sm border dark:border-gray-600 disabled:opacity-50 ${hoverFloatBtn}`}
                            >
                                {isImporting ? <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <ImportIcon />}
                                {isImporting ? 'Importing...' : 'Import'}
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => { setEditingCustomer(null); setIsModalOpen(true); }}
                        className={`bg-blue-600 text-white px-4 py-2 rounded-md font-semibold shadow-sm hover:bg-blue-700 ${hoverFloatBtn}`}
                    >
                        Add Customer
                    </button>
                </div>
            </div>
            {(error || importResult || repairResult) && (
                 <div className={`p-4 rounded-md text-sm ${
                     error ? 'bg-red-100 text-red-700' : 
                     ((repairResult?.type === 'success' || importResult?.type === 'success') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')
                 }`}>
                     {error ? `Error: ${error}` : (repairResult?.message || importResult?.message)}
                 </div>
            )}
            <Card>
                <div className="p-4 border-b dark:border-gray-700 space-y-4">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex flex-wrap gap-2">
                            <FilterButton status="all" label="All" count={customers.length} />
                            <FilterButton status={CustomerStatus.Active} label="Active" count={customerCountsByStatus.Active} />
                            <FilterButton status={CustomerStatus.Unregister} label="Unregister" count={customerCountsByStatus.Unregister} />
                            <FilterButton status={CustomerStatus.Inactive} label="Inactive" count={customerCountsByStatus.Inactive} />
                            <FilterButton status={CustomerStatus.Suspended} label="Suspended" count={customerCountsByStatus.Suspended} />
                        </div>
                        <input
                            type="text"
                            placeholder="Search by name, ID, address, phone, PPPoE username, or ACS SN..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-4 pr-4 py-2 border dark:border-gray-600 rounded-md w-full sm:w-96 bg-white dark:bg-gray-800 dark:text-white"
                        />
                    </div>
                     {selectedCustomers.length > 0 && userRole === 'admin' && (
                        <div className="flex items-center justify-start gap-4 bg-gray-100 dark:bg-gray-700 p-3 rounded-md">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                                {selectedCustomers.length} selected
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button onClick={() => handleBulkStatusChange(CustomerStatus.Active)} disabled={!!bulkActionInProgress} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md transition-colors shadow-sm disabled:bg-green-400 ${hoverFloatBtn} hover:bg-green-700`}>
                                    <ActivateIcon /> <span>Activate</span>
                                </button>
                                <button onClick={() => handleBulkStatusChange(CustomerStatus.Suspended)} disabled={!!bulkActionInProgress} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-yellow-500 rounded-md transition-colors shadow-sm disabled:bg-yellow-300 ${hoverFloatBtn} hover:bg-yellow-600`}>
                                    <SuspendIcon /> <span>Suspend</span>
                                </button>
                                 <button onClick={() => setIsBulkMessageModalOpen(true)} disabled={!!bulkActionInProgress} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-md transition-colors shadow-sm disabled:bg-purple-400 ${hoverFloatBtn} hover:bg-purple-700`}>
                                    <MessageIcon /> <span>Send WA</span>
                                </button>
                                <button onClick={handleDeleteSelected} disabled={!!bulkActionInProgress} className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md transition-colors shadow-sm disabled:bg-red-400 ${hoverFloatBtn} hover:bg-red-700`}>
                                <DeleteIcon /> <span>Delete</span>
                                </button>
                            </div>
                            <button onClick={() => setSelectedCustomers([])} className="ml-auto p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full" aria-label="Clear selection">
                                <CloseIcon />
                            </button>
                        </div>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th className="p-4">
                                     <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                        onChange={handleSelectAllOnPage}
                                        checked={areAllOnPageSelected}
                                        aria-label="Select all customers on this page"
                                    />
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Customer</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">NIK</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Saldo Voucher</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Package</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Billing</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">ODP</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">PPPoE User</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">ACS Device SN</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Join Date</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {paginatedCustomers.map(customer => (
                                <React.Fragment key={customer.id}>
                                    <tr 
                                        onClick={() => toggleExpandCustomer(customer.id)}
                                        className={`transition-colors duration-200 cursor-pointer 
                                            ${selectedCustomers.includes(customer.id) ? 'bg-blue-50 dark:bg-blue-900/30' : 
                                            (expandedCustomerId === customer.id ? 'bg-blue-50/50 dark:bg-blue-900/20' : 
                                            (customer.status === CustomerStatus.Unregister ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'))
                                        }`}
                                    >
                                        <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                                checked={selectedCustomers.includes(customer.id)}
                                                onChange={(e) => handleSelectOne(customer.id, e.target.checked)}
                                                aria-label={`Select customer ${customer.name}`}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{customer.name}</div>
                                            {editingState.customerId === customer.id ? (
                                                <div className="flex items-center gap-1 mt-1">
                                                    <input
                                                        type="text"
                                                        value={editingState.value}
                                                        onChange={(e) => setEditingState(prev => ({ ...prev, value: e.target.value }))}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateCustomerId(); if (e.key === 'Escape') setEditingState({ customerId: null, value: '' }); }}
                                                        className="w-32 p-1 text-sm border rounded bg-white dark:bg-gray-700 dark:border-gray-600"
                                                        autoFocus
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                    <button onClick={e => { e.stopPropagation(); handleUpdateCustomerId(); }} className="p-1 text-green-600 rounded-full hover:bg-green-100 dark:hover:bg-gray-600">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                    </button>
                                                    <button onClick={e => { e.stopPropagation(); setEditingState({ customerId: null, value: '' }); }} className="p-1 text-red-600 rounded-full hover:bg-red-100 dark:hover:bg-gray-600">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1">
                                                    <div className="text-sm text-gray-500 dark:text-gray-400">{customer.id}</div>
                                                    {(userRole === 'admin' || userRole === 'technician') && (
                                                        <button onClick={e => { e.stopPropagation(); setEditingState({ customerId: customer.id, value: customer.id }); }} className="p-1 text-gray-400 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">{customer.nik || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap"><CustomerStatusTag status={customer.status} /></td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600 dark:text-green-400">{formatRupiah(customer.voucher_balance || 0)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{packagesMap[customer.packageId]?.name || 'N/A'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {renderCurrentMonthInvoiceStatus(customer.currentMonthInvoiceStatus)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {customer.odpId && odpsMap[customer.odpId] ? (
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    const odpToShow = odps.find(o => o.id === customer.odpId);
                                                    if (odpToShow) setViewingOdpDetail(odpToShow);
                                                  }}
                                                  className="text-blue-600 dark:text-blue-400 hover:underline"
                                                >
                                                  {odpsMap[customer.odpId]}
                                                </button>
                                              ) : (
                                                '-'
                                              )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">{customer.pppoeUsername || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">{customer.acsSerialNumber || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(customer.activeDate)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex items-center justify-end space-x-1" onClick={e => e.stopPropagation()}>
                                                {userRole === 'admin' && (
                                                    <button
                                                        onClick={() => setBalancingCustomer(customer)}
                                                        className="p-2 text-green-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                                                        title="Add Affiliate Balance"
                                                    >
                                                        <CashIcon />
                                                    </button>
                                                )}
                                                {(userRole === 'admin' || userRole === 'technician') && customer.acsSerialNumber && (
                                                    <button
                                                        onClick={() => setDeviceModalCustomer(customer)}
                                                        className="p-2 text-cyan-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                                                        title="Manage Wi-Fi Settings"
                                                    >
                                                        <WifiIcon />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => { if (customer.location) window.open(`https://www.google.com/maps?q=${customer.location.lat},${customer.location.lng}`, '_blank'); }}
                                                    className="p-2 text-green-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                                                    disabled={!customer.location}
                                                    title={customer.location ? "View on Google Maps" : "No location data"}
                                                >
                                                    <MapIcon />
                                                </button>
                                                <button onClick={() => { setEditingCustomer(customer); setIsModalOpen(true); }} className="p-2 text-blue-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Edit Customer">
                                                    <EditIcon />
                                                </button>
                                                {userRole === 'admin' && (
                                                    <button onClick={() => { setDeletingCustomer(customer); setDeletingMode('single'); }} className="p-2 text-red-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Delete Customer">
                                                        <TrashIcon />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedCustomerId === customer.id && (
                                        <tr className="bg-gray-50 dark:bg-gray-800/50">
                                            <td colSpan={12} className="p-4">
                                                <div className="space-y-4">
                                                    <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                                                        <DetailItem label="Nama Lengkap">{customer.name}</DetailItem>
                                                        <DetailItem label="NIK">{customer.nik}</DetailItem>
                                                        <DetailItem label="Telepon"><a href={`tel:${customer.phone}`} className="text-blue-600 dark:text-blue-400 hover:underline">{customer.phone}</a></DetailItem>
                                                        <DetailItem label="Email">{customer.email}</DetailItem>
                                                        <DetailItem label="Alamat Lengkap">{customer.address}</DetailItem>
                                                        <DetailItem label="Paket">{packagesMap[customer.packageId]?.name || 'N/A'}</DetailItem>
                                                        <DetailItem label="Billing Type">{customer.billing_type === 'fixed' ? 'Fixed (Anniversary)' : 'Postpaid (Monthly)'}</DetailItem>
                                                        <DetailItem label="Status Invoice Bulan Ini">{renderCurrentMonthInvoiceStatus(customer.currentMonthInvoiceStatus)}</DetailItem>
                                                        <DetailItem label="PPPoE Username">{customer.pppoeUsername}</DetailItem>
                                                        <DetailItem label="ACS Device SN">{customer.acsSerialNumber}</DetailItem>
                                                        <DetailItem label="ODP Terhubung">
                                                            {customer.odpId && odpsMap[customer.odpId] ? (
                                                                <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const odpToShow = odps.find(o => o.id === customer.odpId);
                                                                    if (odpToShow) setViewingOdpDetail(odpToShow);
                                                                }}
                                                                className="text-blue-600 dark:text-blue-400 hover:underline"
                                                                >
                                                                {odpsMap[customer.odpId]}
                                                                </button>
                                                            ) : '-'}
                                                        </DetailItem>
                                                        <DetailItem label="Tanggal Bergabung">{formatDateTimeDisplay(customer.activeDate)}</DetailItem>
                                                    </dl>
                                                     <div className="pt-4 border-t dark:border-gray-600">
                                                        <h4 className="text-md font-semibold text-gray-700 dark:text-gray-300 mb-2">Bonus Hotspot Voucher</h4>
                                                        {isVoucherLoading ? (
                                                            <p className="text-sm text-gray-500 dark:text-gray-400">Loading voucher details...</p>
                                                        ) : bonusVoucher ? (
                                                            <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                                                                <DetailItem label="Voucher">{bonusVoucher.name}</DetailItem>
                                                                <DetailItem label="Status">
                                                                    <span className={`font-semibold ${!bonusVoucher.disabled ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                        {!bonusVoucher.disabled ? 'Aktif' : 'Nonaktif'}
                                                                    </span>
                                                                </DetailItem>
                                                            </dl>
                                                        ) : (
                                                            <div className="space-y-2">
                                                                <p className="text-sm text-gray-500 dark:text-gray-400">No bonus voucher found for this customer.</p>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleCreateBonusVoucher(customer.id);
                                                                    }}
                                                                    disabled={isCreatingVoucher}
                                                                    className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-green-400"
                                                                >
                                                                    {isCreatingVoucher ? 'Creating...' : 'Create Bonus Voucher'}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
                 <div className="flex items-center justify-between p-4 border-t dark:border-gray-700">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredCustomers.length)}
                        {' to '}
                        {Math.min(currentPage * ITEMS_PER_PAGE, filteredCustomers.length)}
                        {' of '}
                        {filteredCustomers.length} results
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

export default Customers;
