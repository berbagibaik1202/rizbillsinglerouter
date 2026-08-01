


import React from 'react';
import { ApiSettings } from '../../../types';
import Card from '../../common/Card';

interface GeneralSettingsProps {
    settings: ApiSettings['app'];
    otpSettings: ApiSettings['otp'];
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
    handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleClearLogo: () => void;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, otpSettings, handleInputChange, handleLogoUpload, handleClearLogo }) => {
    
    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400";

    return (
        <Card title="General Application Settings">
            <div className="space-y-6">

                <div>
                    <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-2">Application Logo</h3>
                    <div className="flex items-start gap-6">
                        <img src={settings.appLogoUrl || '/vite.svg'} alt="Logo Preview" className="h-20 w-20 object-contain bg-gray-100 dark:bg-gray-700 rounded-md p-2 border dark:border-gray-600" />
                        <div className="flex-1 space-y-4">
                            <div>
                                <label htmlFor="appLogoUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Logo from URL</label>
                                <input
                                    type="url"
                                    id="appLogoUrl"
                                    name="app.appLogoUrl"
                                    value={settings.appLogoUrl || ''}
                                    onChange={handleInputChange}
                                    className={`mt-1 ${inputClasses}`}
                                    placeholder="https://example.com/logo.png"
                                />
                            </div>
                            <div className="flex items-center gap-4">
                                <label htmlFor="logo-upload" className="cursor-pointer px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-500">
                                    Upload Logo
                                </label>
                                <input id="logo-upload" type="file" className="hidden" accept="image/png, image/jpeg, image/svg+xml, image/webp" onChange={handleLogoUpload} />
                                <button type="button" onClick={handleClearLogo} className="text-sm text-red-600 dark:text-red-400 hover:underline">Clear Logo</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="border-t dark:border-gray-700 pt-6">
                    <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-2">Company Identity & Localization</h3>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="appName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Application/Company Name</label>
                                <input
                                    type="text"
                                    id="appName"
                                    name="app.appName"
                                    value={settings.appName || ''}
                                    onChange={handleInputChange}
                                    className={`mt-1 ${inputClasses}`}
                                    placeholder="e.g., My ISP"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This name will appear in the header and on invoices.</p>
                            </div>
                             <div>
                                <label htmlFor="customerIdPrefix" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Customer ID Prefix</label>
                                <input
                                    type="text"
                                    id="customerIdPrefix"
                                    name="app.customerIdPrefix"
                                    value={settings.customerIdPrefix || ''}
                                    onChange={handleInputChange}
                                    className={`mt-1 ${inputClasses}`}
                                    placeholder="e.g., 310890"
                                    maxLength={6}
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">A 6-digit prefix for all new customer IDs.</p>
                            </div>
                        </div>
                         <div>
                            <label htmlFor="companyPhone" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Company Phone</label>
                            <input
                                type="tel"
                                id="companyPhone"
                                name="app.companyPhone"
                                value={settings.companyPhone || ''}
                                onChange={handleInputChange}
                                className={`mt-1 ${inputClasses}`}
                                placeholder="e.g., 021-1234567"
                            />
                        </div>
                         <div>
                            <label htmlFor="companyAddress" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Company Address</label>
                            <textarea
                                id="companyAddress"
                                name="app.companyAddress"
                                value={settings.companyAddress || ''}
                                onChange={handleInputChange}
                                rows={3}
                                className={`mt-1 ${inputClasses}`}
                                placeholder="e.g., Jl. Jendral Sudirman No. 1, Jakarta"
                            />
                        </div>
                        <div>
                            <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Business Timezone</label>
                            <select
                                id="timezone"
                                name="app.timezone"
                                value={settings.timezone || 'Asia/Jakarta'}
                                onChange={handleInputChange}
                                className={`mt-1 ${inputClasses}`}
                            >
                                <option value="Asia/Jakarta">Asia/Jakarta (WIB - UTC+7)</option>
                                <option value="Asia/Makassar">Asia/Makassar (WITA - UTC+8)</option>
                                <option value="Asia/Jayapura">Asia/Jayapura (WIT - UTC+9)</option>
                                <option value="UTC">UTC (Coordinated Universal Time)</option>
                            </select>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Sets the timezone for all date and time operations (Voucher expiry, Invoice dates, Payment timestamps).
                            </p>
                        </div>
                    </div>
                </div>

                 <div className="border-t dark:border-gray-700 pt-6">
                     <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-2">Application URLs & Appearance</h3>
                     <div className="space-y-4">
                        <div>
                            <label htmlFor="baseUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Base URL</label>
                            <input
                                type="url"
                                id="baseUrl"
                                name="app.baseUrl"
                                value={settings.baseUrl || ''}
                                onChange={handleInputChange}
                                className={`mt-1 ${inputClasses}`}
                                placeholder="e.g., http://localhost:5173"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The public URL of this application. Required for payment gateway callbacks and return URLs.</p>
                        </div>
                        <div>
                            <label htmlFor="odpLineColor" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Default ODP Line Color</label>
                            <input
                                type="color"
                                id="odpLineColor"
                                name="app.odpLineColor"
                                value={settings.odpLineColor || '#6b7280'}
                                onChange={handleInputChange}
                                className="mt-1 p-1 h-10 w-full block border rounded-md cursor-pointer bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The default color for lines connecting ODPs on the map.</p>
                        </div>
                     </div>
                </div>

                <div className="border-t dark:border-gray-700 pt-6">
                     <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-2">Security</h3>
                     <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="otpEnabled"
                            name="otp.enabled"
                            checked={otpSettings?.enabled || false}
                            onChange={handleInputChange}
                            className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="otpEnabled" className="ml-2 block text-sm font-medium text-gray-900 dark:text-gray-200">
                            Enable Customer OTP Login via WhatsApp
                        </label>
                    </div>
                     <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        If enabled, customers will be required to enter a one-time password sent to their WhatsApp to log in.
                    </p>
                </div>
            </div>
        </Card>
    );
};

export default GeneralSettings;
