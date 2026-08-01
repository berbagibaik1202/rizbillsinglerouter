import React, { useState, useEffect } from 'react';
import { Package } from '~/types';
import MapPicker from '~/components/common/MapPicker';

interface RegistrationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const RegistrationModal: React.FC<RegistrationModalProps> = ({ isOpen, onClose }) => {
    const initialState = {
        name: '',
        nik: '',
        email: '',
        phone: '',
        packageId: '',
        namawifi: '',
        passwordwifi: '',
        address: '',
        location: null as { lat: number; lng: number } | null,
    };

    const [formData, setFormData] = useState(initialState);
    const [packages, setPackages] = useState<Package[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    useEffect(() => {
        if (isOpen) {
            // Reset form and feedback when modal opens
            setFormData(initialState);
            setFeedback(null);
            
            // Fetch packages
            const fetchPackages = async () => {
                try {
                    const res = await fetch('/api/public/packages');
                    if (res.ok) {
                        const pkgs: Package[] = await res.json();
                        setPackages(pkgs);
                        if (pkgs.length > 0) {
                            setFormData(prev => ({ ...prev, packageId: String(pkgs[0].id) }));
                        }
                    } else {
                        console.error('Failed to load packages for registration form.');
                        setPackages([]); // Clear packages on error
                    }
                } catch (e) {
                    console.error("Failed to fetch packages for registration", e);
                }
            };
            fetchPackages();
        }
    }, [isOpen]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleLocationChange = (location: { lat: number, lng: number }) => {
        setFormData(prev => ({ ...prev, location }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setFeedback(null);

        if (formData.passwordwifi.length < 8) {
            setFeedback({ type: 'error', message: 'Password Wifi minimal harus 8 karakter.' });
            setIsSaving(false);
            return;
        }
        if (!formData.location) {
            setFeedback({ type: 'error', message: 'Silakan tandai lokasi pemasangan Anda di peta.' });
            setIsSaving(false);
            return;
        }

        try {
            const res = await fetch('/api/public/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Pendaftaran gagal.');
            }
            setFeedback({ type: 'success', message: data.message });
            setTimeout(onClose, 4000); // Close modal after 4 seconds on success

        } catch (err: any) {
            setFeedback({ type: 'error', message: err.message });
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;
    
    const inputClasses = "w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white";

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full transform transition-all duration-300">
                <div className="flex justify-between items-center border-b dark:border-gray-700 px-6 py-4">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">Formulir Pendaftaran Baru</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">&times;</button>
                </div>
                <div className="p-6 max-h-[80vh] overflow-y-auto">
                    <form id="registration-form" onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            <input type="text" id="name" placeholder="Nama Lengkap" value={formData.name} onChange={handleInputChange} className={inputClasses} required />
                            <input type="text" id="nik" placeholder="NIK" value={formData.nik} onChange={handleInputChange} className={inputClasses} required />
                            <input type="email" id="email" placeholder="Email" value={formData.email} onChange={handleInputChange} className={inputClasses} />
                            <input type="tel" id="phone" placeholder="Nomor Telepon (WhatsApp)" value={formData.phone} onChange={handleInputChange} className={inputClasses} required />
                            <select id="packageId" value={formData.packageId} onChange={handleInputChange} className={inputClasses} required>
                                <option value="">-- Pilih Paket --</option>
                                {packages.map(pkg => (
                                    <option key={pkg.id} value={pkg.id}>{pkg.name} - {pkg.speed} Mbps</option>
                                ))}
                            </select>
                            <input type="text" id="namawifi" placeholder="Nama Wifi yang Diinginkan" value={formData.namawifi} onChange={handleInputChange} className={inputClasses} required />
                            <input type="password" id="passwordwifi" placeholder="Password Wifi (min. 8 karakter)" value={formData.passwordwifi} onChange={handleInputChange} className={inputClasses} required minLength={8} />
                            <textarea id="address" rows={3} placeholder="Alamat Lengkap Pemasangan" value={formData.address} onChange={handleInputChange} className={inputClasses} required></textarea>
                            
                            <div>
                                <label className="block text-gray-700 dark:text-gray-300 mb-2">Tandai Lokasi Pemasangan</label>
                                <MapPicker value={formData.location} onChange={handleLocationChange} />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Klik pada peta untuk menandai lokasi atau gunakan tombol lokasi saat ini.</p>
                            </div>

                        </div>
                        {feedback && (
                            <div className={`mt-4 text-center p-3 rounded-lg text-sm ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {feedback.message}
                            </div>
                        )}
                        <div className="flex justify-end space-x-3 mt-6">
                            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition duration-300">
                                Batal
                            </button>
                            <button type="submit" disabled={isSaving} className="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg hover:bg-blue-700 transition duration-300 disabled:bg-blue-400">
                                {isSaving ? 'Mengirim...' : 'Daftar'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default RegistrationModal;