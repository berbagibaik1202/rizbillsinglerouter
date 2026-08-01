import React, { useState } from 'react';
import { Customer, CustomerStatus } from '../../types';
import { fetchWithAuth } from '~/components/api';

interface BroadcastModalProps {
    isOpen: boolean;
    onClose: () => void;
    customers: Customer[]; // Pass customers to show counts
}

const BroadcastModal: React.FC<BroadcastModalProps> = ({ isOpen, onClose, customers }) => {
    const [filter, setFilter] = useState<CustomerStatus | 'all'>('all');
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [response, setResponse] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    if (!isOpen) return null;

    const getFilteredCount = () => {
        if (filter === 'all') return customers.length;
        return customers.filter(c => c.status === filter).length;
    };

    const handleSend = async () => {
        if (!message.trim()) {
            setResponse({ type: 'error', message: 'Message cannot be empty.' });
            return;
        }
        setIsSending(true);
        setResponse(null);
        try {
            const res = await fetchWithAuth('/api/admin/whatsapp/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filter, message }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Failed to send broadcast.');
            }
            setResponse({ type: 'success', message: data.message });
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
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">Send WhatsApp Broadcast</h2>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Send To</label>
                            <select id="filter" name="filter" value={filter} onChange={(e) => setFilter(e.target.value as any)} className={`mt-1 block w-full pl-3 pr-10 py-2 text-base sm:text-sm rounded-md ${inputClasses}`}>
                                <option value="all">All Customers</option>
                                <option value={CustomerStatus.Active}>Active Customers</option>
                                <option value={CustomerStatus.Suspended}>Suspended Customers</option>
                                <option value={CustomerStatus.Inactive}>Inactive Customers</option>
                            </select>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This will send a message to {getFilteredCount()} customer(s).</p>
                        </div>
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
                        <button
                            type="button"
                            onClick={handleSend}
                            disabled={isSending}
                            className="px-4 py-2 bg-purple-600 text-white rounded flex items-center justify-center disabled:bg-purple-400 disabled:cursor-wait"
                        >
                            {isSending && (
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            )}
                            {isSending ? 'Sending...' : 'Send Broadcast'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BroadcastModal;
