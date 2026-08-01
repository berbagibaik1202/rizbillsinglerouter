import React, { useState, useEffect } from 'react';
import { ApiSettings, PppoeProfile, HotspotProfile, Package } from '../../../types';
import Card from '../../common/Card';
import { fetchWithAuth } from '~/components/api';

const paymentMethods = [
    // E-Wallets
    { code: 'QRIS', name: 'QRIS (semua e-wallet)' },
    { code: 'SHOPEEPAY', name: 'ShopeePay' },
    { code: 'OVO', name: 'OVO' },
    { code: 'DANA', name: 'DANA' },
    { code: 'LINKAJA', name: 'LinkAja' },
    
    // Virtual Accounts
    { code: 'BCAVA', name: 'BCA Virtual Account' },
    { code: 'BNIVA', name: 'BNI Virtual Account' },
    { code: 'BRIVA', name: 'BRI Virtual Account' },
    { code: 'MANDIRIVA', name: 'Mandiri Virtual Account' },
    { code: 'PERMATAVA', name: 'Permata Virtual Account' },
    { code: 'CIMBVA', name: 'CIMB Virtual Account' },
    { code: 'MUAMALATVA', name: 'Muamalat Virtual Account' },

    // Retail Outlets
    { code: 'ALFAMART', name: 'Alfamart' },
    { code: 'INDOMARET', name: 'Indomaret' },
];

interface BillingPaymentsSettingsProps {
    billingSettings: ApiSettings['billing'];
    tripaySettings: ApiSettings['tripay'];
    pppoeProfiles: PppoeProfile[];
    hotspotProfiles: HotspotProfile[];
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    handlePaymentMethodChange: (methodCode: string) => void;
}

const BillingPaymentsSettings: React.FC<BillingPaymentsSettingsProps> = ({ 
    billingSettings, 
    tripaySettings,
    pppoeProfiles,
    hotspotProfiles,
    handleInputChange, 
    handlePaymentMethodChange 
}) => {
    
    const [packages, setPackages] = useState<Package[]>([]);

    useEffect(() => {
        const fetchPackages = async () => {
            try {
                const res = await fetchWithAuth(`/api/network/packages`);
                if (res.ok) {
                    setPackages(await res.json());
                }
            } catch (error) {
                console.error("Failed to fetch packages for settings", error);
            }
        };
        fetchPackages();
    }, []);
    
    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400";

    return (
        <div className="space-y-6">
            <Card title="Billing Automation">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2 bg-blue-50 dark:bg-blue-900/30 p-3 rounded-md text-sm text-blue-800 dark:text-blue-200 mb-2">
                            <h4 className="font-bold mb-1">Postpaid Settings</h4>
                            <p>Used for standard monthly billing (e.g., Bill everyone on the 1st for the previous month).</p>
                        </div>
                        <div>
                            <label htmlFor="generationDay" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Invoice Generation Day</label>
                            <input type="number" id="generationDay" name="billing.generationDay" value={billingSettings.generationDay || 1} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} min="1" max="28" />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Day of the month to automatically generate invoices (1-28).</p>
                        </div>
                        <div>
                            <label htmlFor="dueDays" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Postpaid Due Date (Day of Month)</label>
                            <input type="number" id="dueDays" name="billing.dueDays" value={billingSettings.dueDays || 10} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} min="1" max="31" />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Fixed calendar day when Postpaid invoices are due (e.g., 10th of the current month).</p>
                        </div>

                        <div className="md:col-span-2 bg-purple-50 dark:bg-purple-900/30 p-3 rounded-md text-sm text-purple-800 dark:text-purple-200 mb-2 mt-2">
                            <h4 className="font-bold mb-1">Fixed Date (Anniversary) Settings</h4>
                            <p>Used for customers billed on the monthly anniversary of their registration date. Due date follows the anniversary date itself.</p>
                        </div>
                        <div>
                            <label htmlFor="fixedInvoiceLeadDays" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Generate Invoice Before Anniversary (Days)</label>
                            <input type="number" id="fixedInvoiceLeadDays" name="billing.fixedInvoiceLeadDays" value={billingSettings.fixedInvoiceLeadDays ?? 10} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} min="0" />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Example: if anniversary is on the 20th and this value is 10, the invoice will be generated on the 10th.</p>
                        </div>
                        
                        <div className="md:col-span-2 border-t dark:border-gray-700 pt-4 mt-2">
                            <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">General Rules</h4>
                        </div>

                         <div>
                            <label htmlFor="reminderDaysBeforeDue" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Reminder Days Before Due</label>
                            <input type="number" id="reminderDaysBeforeDue" name="billing.reminderDaysBeforeDue" value={billingSettings.reminderDaysBeforeDue || 0} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} min="0" />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Days before due date to send a WhatsApp reminder. Set to 0 to disable.</p>
                        </div>
                        <div>
                            <label htmlFor="suspensionDays" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Service Suspension Days</label>
                            <input type="number" id="suspensionDays" name="billing.suspensionDays" value={billingSettings.suspensionDays || 3} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} min="0" />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Number of days after the due date before unpaid service is automatically suspended.</p>
                        </div>
                        <div>
                            <label htmlFor="suspensionProfileName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Suspension PPPoE Profile Name</label>
                            <select id="suspensionProfileName" name="billing.suspensionProfileName" value={billingSettings.suspensionProfileName || ''} onChange={handleInputChange} className={`mt-1 ${inputClasses}`}>
                                <option value="">Select Suspension Profile</option>
                                {pppoeProfiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                            </select>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The exact name of the PPPoE profile on your router for suspended users.</p>
                        </div>
                        <div>
                            <label htmlFor="bonusVoucherProfile" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Bonus Hotspot Profile for Customers</label>
                            <select id="bonusVoucherProfile" name="billing.bonusVoucherProfile" value={billingSettings.bonusVoucherProfile || ''} onChange={handleInputChange} className={`mt-1 ${inputClasses}`}>
                                <option value="">Disable Bonus Vouchers</option>
                                {hotspotProfiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                            </select>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">A Hotspot user will be automatically created and linked to each new customer using this profile.</p>
                        </div>
                         <div>
                            <label htmlFor="bonusVoucherPrefix" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Bonus Voucher Prefix</label>
                            <input type="text" id="bonusVoucherPrefix" name="billing.bonusVoucherPrefix" value={billingSettings.bonusVoucherPrefix || ''} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Prefix for auto-generated customer vouchers. Result: [prefix]-[last_4_digits_customer_id].</p>
                        </div>
                        <div className="md:col-span-2 pt-4 border-t dark:border-gray-700">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Apply Bonus to Packages</label>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-2">Select which packages are eligible to receive a bonus voucher. If none are selected, the bonus will be applied to all customers if a bonus profile is set.</p>
                            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-4 max-h-48 overflow-y-auto p-3 bg-gray-50 dark:bg-gray-900/50 rounded-md">
                                {packages.map(pkg => (
                                    <div key={pkg.id} className="relative flex items-start">
                                        <div className="flex items-center h-5">
                                            <input
                                                id={`pkg-${pkg.id}`}
                                                type="checkbox"
                                                name="billing.bonusVoucherPackageIds"
                                                data-type="number-array-toggle"
                                                value={pkg.id}
                                                checked={(billingSettings.bonusVoucherPackageIds || []).includes(pkg.id)}
                                                onChange={handleInputChange}
                                                className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded"
                                            />
                                        </div>
                                        <div className="ml-3 text-sm"><label htmlFor={`pkg-${pkg.id}`} className="font-medium text-gray-700 dark:text-gray-300">{pkg.name}</label></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label htmlFor="taxRate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tax Rate (%)</label>
                            <input type="number" id="taxRate" name="billing.taxRate" value={billingSettings.taxRate || 0} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} min="0" step="0.1" />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">e.g., 11 for 11% PPN.</p>
                        </div>
                        <div className="md:col-span-2 pt-6 border-t dark:border-gray-700 space-y-3">
                            <div className="flex items-center">
                                <input type="checkbox" id="whatsappNotificationsEnabled" name="billing.whatsappNotificationsEnabled" checked={billingSettings.whatsappNotificationsEnabled || false} onChange={handleInputChange} className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500" />
                                <label htmlFor="whatsappNotificationsEnabled" className="ml-2 block text-sm text-gray-900 dark:text-gray-200">
                                    Enable Automatic WhatsApp Billing Notifications (Reminders, Suspensions, etc.)
                                </label>
                            </div>
                             <div className="flex items-center">
                                <input type="checkbox" id="sendInvoiceOnCreate" name="billing.sendInvoiceOnCreate" checked={billingSettings.sendInvoiceOnCreate || false} onChange={handleInputChange} className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500" />
                                <label htmlFor="sendInvoiceOnCreate" className="ml-2 block text-sm text-gray-900 dark:text-gray-200">
                                    Send WhatsApp notification immediately after automatic generation
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>

            <Card title="Tripay Payment Gateway">
                <div className="space-y-4">
                    <input type="text" name="tripay.merchantCode" placeholder="Merchant Code" value={tripaySettings.merchantCode || ''} onChange={handleInputChange} className={inputClasses} />
                    <input type="text" name="tripay.apiKey" placeholder="API Key" value={tripaySettings.apiKey || ''} onChange={handleInputChange} className={inputClasses} />
                    <input type="password" name="tripay.privateKey" placeholder="Private Key" value={tripaySettings.privateKey || ''} onChange={handleInputChange} className={inputClasses} />
                    <div className="flex items-center">
                        <input type="checkbox" id="sandboxMode" name="tripay.sandboxMode" checked={tripaySettings.sandboxMode || false} onChange={handleInputChange} className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500" />
                        <label htmlFor="sandboxMode" className="ml-2 block text-sm text-gray-900 dark:text-gray-200">
                            Enable Sandbox Mode (for testing)
                        </label>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Enabled Payment Methods</label>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {paymentMethods.map(method => (
                                <div key={method.code} className="relative flex items-start">
                                    <div className="flex items-center h-5">
                                        <input
                                            id={`method-${method.code}`}
                                            type="checkbox"
                                            checked={tripaySettings.enabledMethods?.includes(method.code) || false}
                                            onChange={() => handlePaymentMethodChange(method.code)}
                                            className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded"
                                        />
                                    </div>
                                    <div className="ml-3 text-sm">
                                        <label htmlFor={`method-${method.code}`} className="font-medium text-gray-700 dark:text-gray-300">
                                            {method.name}
                                        </label>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default BillingPaymentsSettings;
