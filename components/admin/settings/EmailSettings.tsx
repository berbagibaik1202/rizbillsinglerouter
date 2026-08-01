import React from 'react';
import Card from '../../common/Card';
import { ApiSettings } from '../../../types';

type Props = {
    emailSettings: NonNullable<ApiSettings['email']>;
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
    testTargetEmail: string;
    setTestTargetEmail: (value: string) => void;
    onSendTestEmail: () => void;
    testStatus: 'idle' | 'sending' | 'success' | 'error';
    testMessage: string;
};

const EmailSettings: React.FC<Props> = ({
    emailSettings,
    handleInputChange,
    testTargetEmail,
    setTestTargetEmail,
    onSendTestEmail,
    testStatus,
    testMessage,
}) => {
    const inputClasses = 'w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400';
    const textAreaClasses = `${inputClasses} min-h-[96px]`;

    return (
        <div className="space-y-6">
            <Card title="Email Notifications (SMTP)">
                <div className="space-y-4">
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="emailEnabled"
                            name="email.enabled"
                            checked={emailSettings.enabled || false}
                            onChange={handleInputChange}
                            className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="emailEnabled" className="ml-2 block text-sm text-gray-900 dark:text-gray-200">
                            Enable Email Notifications for invoice due reminders and payment success
                        </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="text" name="email.smtpHost" placeholder="SMTP Host (e.g. smtp.gmail.com)" value={emailSettings.smtpHost || ''} onChange={handleInputChange} className={inputClasses} />
                        <input type="number" name="email.smtpPort" placeholder="SMTP Port (587 / 465)" value={emailSettings.smtpPort ?? 587} onChange={handleInputChange} className={inputClasses} min="1" />

                        <input type="text" name="email.smtpUser" placeholder="SMTP Username" value={emailSettings.smtpUser || ''} onChange={handleInputChange} className={inputClasses} />
                        <input type="password" name="email.smtpPass" placeholder="SMTP Password / App Password" value={emailSettings.smtpPass || ''} onChange={handleInputChange} className={inputClasses} />

                        <input type="text" name="email.fromName" placeholder="From Name (e.g. RizkiTech Billing)" value={emailSettings.fromName || ''} onChange={handleInputChange} className={inputClasses} />
                        <input type="email" name="email.fromEmail" placeholder="From Email (e.g. billing@domain.com)" value={emailSettings.fromEmail || ''} onChange={handleInputChange} className={inputClasses} />
                    </div>

                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="smtpSecure"
                            name="email.smtpSecure"
                            checked={emailSettings.smtpSecure || false}
                            onChange={handleInputChange}
                            className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="smtpSecure" className="ml-2 block text-sm text-gray-900 dark:text-gray-200">
                            Use Secure SMTP (TLS/SSL, usually port 465)
                        </label>
                    </div>
                </div>
            </Card>

            <Card title="Email Templates">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Created Subject</label>
                        <input type="text" name="email.createdSubject" value={emailSettings.createdSubject || ''} onChange={handleInputChange} className={inputClasses} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Created Body</label>
                        <textarea name="email.createdBody" value={emailSettings.createdBody || ''} onChange={handleInputChange} className={textAreaClasses} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Reminder Subject</label>
                        <input type="text" name="email.dueSubject" value={emailSettings.dueSubject || ''} onChange={handleInputChange} className={inputClasses} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Reminder Body</label>
                        <textarea name="email.dueBody" value={emailSettings.dueBody || ''} onChange={handleInputChange} className={textAreaClasses} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Success Subject</label>
                        <input type="text" name="email.paidSubject" value={emailSettings.paidSubject || ''} onChange={handleInputChange} className={inputClasses} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Success Body</label>
                        <textarea name="email.paidBody" value={emailSettings.paidBody || ''} onChange={handleInputChange} className={textAreaClasses} />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Placeholder tersedia: {'{{customerName}}'}, {'{{customerId}}'}, {'{{invoiceId}}'}, {'{{amount}}'}, {'{{dueDate}}'}, {'{{issueDate}}'}, {'{{billingPeriod}}'}, {'{{packageName}}'}, {'{{paymentMethod}}'}, {'{{paymentLink}}'}.
                    </p>
                </div>
            </Card>

            <Card title="SMTP Test">
                <div className="space-y-3">
                    <input
                        type="email"
                        placeholder="Target email for test"
                        value={testTargetEmail}
                        onChange={(e) => setTestTargetEmail(e.target.value)}
                        className={inputClasses}
                    />
                    <button
                        type="button"
                        onClick={onSendTestEmail}
                        disabled={testStatus === 'sending'}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400"
                    >
                        {testStatus === 'sending' ? 'Sending...' : 'Send Test Email'}
                    </button>
                    {testMessage && (
                        <p className={`text-sm ${testStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {testMessage}
                        </p>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default EmailSettings;
