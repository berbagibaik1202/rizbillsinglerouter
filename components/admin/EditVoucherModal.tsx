import React, { useState, useEffect } from 'react';
import { HotspotVoucher, HotspotProfile, VoucherStatus } from '../../types';

interface EditVoucherModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
    voucher: HotspotVoucher | null;
    profiles: HotspotProfile[];
    isSaving: boolean;
}

const validityOptions = [
    { label: '1 Jam', value: 60 },
    { label: '2 Jam', value: 120 },
    { label: '1 Hari', value: 1440 },
    { label: '1 Minggu', value: 10080 },
    { label: '1 Bulan', value: 43200 },
];

const EditVoucherModal: React.FC<EditVoucherModalProps> = ({ isOpen, onClose, onSave, voucher, profiles, isSaving }) => {
    const [formData, setFormData] = useState({
        password: '',
        profile: '',
        duration_minutes: 60,
    });
    
    const isUsed = voucher?.status !== VoucherStatus.New;

    useEffect(() => {
        if (voucher) {
            setFormData({
                password: '', // Always clear password for security
                profile: voucher.profile,
                duration_minutes: voucher.duration_minutes,
            });
        }
    }, [voucher]);

    if (!isOpen || !voucher) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ id: voucher.id, ...formData });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        // For select, it's always a number
        const finalValue = (type === 'number' || e.target.nodeName === 'SELECT') ? parseInt(value, 10) : value;
        setFormData(prev => ({ ...prev, [name]: finalValue }));
    };
    
    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-200 dark:disabled:bg-gray-800/50 disabled:cursor-not-allowed";

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-lg">
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">Edit Voucher: <span className="font-mono text-blue-600 dark:text-blue-400">{voucher.username}</span></h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="password-edit" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                            <input type="password" id="password-edit" name="password" value={formData.password} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} placeholder="Leave blank to keep unchanged" />
                        </div>
                        <div>
                            <label htmlFor="profile-edit" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Profile</label>
                            <select id="profile-edit" name="profile" value={formData.profile} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} required>
                                {profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="duration_minutes-edit" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Validity</label>
                            <select id="duration_minutes-edit" name="duration_minutes" value={formData.duration_minutes} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} disabled={isUsed}>
                                {validityOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            {isUsed && <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">Validity cannot be changed for a used or expired voucher.</p>}
                        </div>
                        <div className="flex justify-end space-x-2 pt-4">
                            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
                            <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400 flex items-center">
                               {isSaving && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default EditVoucherModal;
