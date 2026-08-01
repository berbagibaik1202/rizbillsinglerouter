import React, { useState, useEffect } from 'react';
import { ComplaintType } from '~/types';

interface ComplaintModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: { type: ComplaintType; description: string; }) => Promise<{ success: boolean; message?: string }>;
}

const ComplaintModal: React.FC<ComplaintModalProps> = ({ isOpen, onClose, onSave }) => {
    const [type, setType] = useState<ComplaintType>(ComplaintType.SlowConnection);
    const [description, setDescription] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setType(ComplaintType.SlowConnection);
            setDescription('');
            setIsSaving(false);
            setError(null);
        }
    }, [isOpen]);


    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!description.trim()) {
            setError('Please provide a description of your issue.');
            return;
        }

        setIsSaving(true);
        const result = await onSave({ type, description });
        setIsSaving(false);

        if (!result.success) {
            setError(result.message || 'An unknown error occurred.');
        } else {
            // Parent will close the modal on success
        }
    };
    
    const inputClasses = "mt-1 block w-full shadow-sm sm:text-sm rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white";

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-lg transform transition-all">
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100" id="modal-title">Submit a Complaint</h2>
                    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                        <div>
                            <label htmlFor="complaintType" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Type of Issue</label>
                            <select
                                id="complaintType"
                                value={type}
                                onChange={(e) => setType(e.target.value as ComplaintType)}
                                className={inputClasses}
                            >
                                {Object.values(ComplaintType).map((value: string) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
                            <textarea
                                id="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={5}
                                className={inputClasses}
                                placeholder="Please describe your issue in detail..."
                            />
                        </div>
                        {error && (
                            <div className="text-sm text-red-600 p-3 bg-red-50 dark:bg-red-900/40 rounded-md">
                                {error}
                            </div>
                        )}
                        <div className="mt-6 flex justify-end space-x-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-500"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="inline-flex items-center px-4 py-2 bg-blue-600 border border-transparent rounded-md text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-wait"
                            >
                                {isSaving && <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                {isSaving ? 'Submitting...' : 'Submit Complaint'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ComplaintModal;