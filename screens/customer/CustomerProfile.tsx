

import React, { useState, useEffect } from 'react';
import { Customer, Package, PackageChange, formatRupiah } from '../../types';
import Card from '../../components/common/Card';
import { fetchWithAuth } from '~/components/api';
import MapPicker from '~/components/common/MapPicker';

interface CustomerProfileProps {
    customer: Customer;
    customerPackage: Package | null;
    allPackages: Package[];
    pendingChange: PackageChange | null;
    onUpdate: () => void;
}

const DetailRow: React.FC<{ label: string; value: string | undefined }> = ({ label, value }) => (
    <div>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-base text-gray-800 dark:text-gray-200">{value || '-'}</p>
    </div>
);

const ConfirmationModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    currentPackageName: string;
    newPackage: Package;
    isSaving: boolean;
}> = ({ isOpen, onClose, onConfirm, currentPackageName, newPackage, isSaving }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-md">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Konfirmasi Perubahan Paket</h3>
                    <div className="mt-4 space-y-4 text-sm text-gray-600 dark:text-gray-300">
                        <p>Anda akan mengganti paket dari <strong>{currentPackageName}</strong> ke <strong>{newPackage.name}</strong>.</p>
                        <p>Perubahan ini akan berlaku pada siklus tagihan Anda berikutnya. Tagihan Anda selanjutnya akan menggunakan harga baru sebesar <strong>{formatRupiah(newPackage.price)}</strong>.</p>
                    </div>
                    <div className="mt-6 flex justify-end space-x-2">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Batal</button>
                        <button onClick={onConfirm} disabled={isSaving} type="button" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-blue-400">
                            {isSaving ? 'Menyimpan...' : 'Konfirmasi'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CustomerProfile: React.FC<CustomerProfileProps> = ({ customer, customerPackage, allPackages, pendingChange, onUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        phone: customer.phone,
        address: customer.address,
        location: customer.location || null,
    });
    const hasRequestedLocation = React.useRef(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);

    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
    const [isSavingPackage, setIsSavingPackage] = useState(false);
    const [packageError, setPackageError] = useState<string | null>(null);

    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    
    // Sync formData if customer prop changes
    useEffect(() => {
        setFormData({
            phone: customer.phone,
            address: customer.address,
            location: customer.location || null,
        });
    }, [customer]);

    // Auto-fetch current location on load so map centers and save includes latest coords without clicking a button
    useEffect(() => {
        if (hasRequestedLocation.current) return;
        hasRequestedLocation.current = true;
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                setFormData(prev => ({ ...prev, location: { lat: latitude, lng: longitude } }));
            },
            (err) => {
                console.warn('Geolocation error:', err.message);
            }
        );
    }, []);

    const handleEditClick = () => {
        setIsEditing(true);
        setProfileError(null);
    };

    const handleCancelClick = () => {
        setIsEditing(false);
        // Reset form data to original customer data
        setFormData({
            phone: customer.phone,
            address: customer.address,
            location: customer.location || null,
        });
    };
    
    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        setProfileError(null);
        try {
            const res = await fetchWithAuth(`/api/customers/${customer.id}/profile`, {
                method: 'PUT',
                body: JSON.stringify(formData),
            });
            const data = await res.json();
            if (!data.success || !data.token) {
                throw new Error(data.message || "Gagal memperbarui profil.");
            }
            
            // 1. Perbarui localStorage dengan sesi baru (token + timestamp)
            const sessionData = { token: data.token, timestamp: Date.now() };
            localStorage.setItem('rizkitechbill_session', JSON.stringify(sessionData));
            
            // 2. Kirim event kustom untuk memberitahu komponen App agar memperbarui state tanpa me-reload halaman
            window.dispatchEvent(new CustomEvent('sessionUpdated'));

            await onUpdate();
            setIsEditing(false);
            alert('Profil berhasil diperbarui!');
        } catch (err: any) {
            setProfileError(err.message);
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleLocationChange = (location: { lat: number, lng: number }) => {
        setFormData(prev => ({ ...prev, location }));
    };


    const handleSwitchClick = (pkg: Package) => {
        setSelectedPackage(pkg);
        setIsConfirmModalOpen(true);
    };

    const handleConfirmChange = async () => {
        if (!selectedPackage) return;
        setIsSavingPackage(true);
        setPackageError(null);
        try {
            await fetchWithAuth(`/api/customers/${customer.id}/package-change`, {
                method: 'POST',
                body: JSON.stringify({ new_package_id: selectedPackage.id }),
            });
            onUpdate(); // Refresh parent state
        } catch (err: any) {
            setPackageError(err.message);
        } finally {
            setIsSavingPackage(false);
            setIsConfirmModalOpen(false);
        }
    };

    const handleCancelChange = async () => {
        if (!window.confirm('Apakah Anda yakin ingin membatalkan permintaan perubahan paket?')) return;
        setIsSavingPackage(true);
        setPackageError(null);
        try {
            await fetchWithAuth(`/api/customers/${customer.id}/package-change`, { method: 'DELETE' });
            onUpdate(); // Refresh parent state
        } catch (err: any) {
            setPackageError(err.message);
        } finally {
            setIsSavingPackage(false);
        }
    };

    const availablePackages = allPackages.filter(p => p.id !== customer.packageId);

    useEffect(() => {
        if (availablePackages.length > 1 && !isPaused) {
            const slideInterval = setInterval(() => {
                setCurrentIndex(prevIndex => (prevIndex + 1) % availablePackages.length);
            }, 4000);
            return () => clearInterval(slideInterval);
        }
    }, [availablePackages.length, isPaused]);
    
    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white";


    return (
        <div className="py-6 space-y-6">
             <ConfirmationModal 
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmChange}
                currentPackageName={customerPackage?.name || ''}
                newPackage={selectedPackage!}
                isSaving={isSavingPackage}
            />
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Profil Saya</h2>

            <Card>
                {profileError && <div className="p-3 mb-4 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-md text-sm">{profileError}</div>}
                
                {isEditing ? (
                    <div className="space-y-4">
                        <DetailRow label="ID Pelanggan" value={customer.id} />
                        <DetailRow label="Nama" value={customer.name} />
                        <DetailRow label="Email" value={customer.email} />
                        <div>
                            <label htmlFor="phone" className="text-sm font-medium text-gray-500 dark:text-gray-400">Telepon</label>
                            <input type="tel" id="phone" name="phone" value={formData.phone} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} />
                        </div>
                        <div>
                            <label htmlFor="address" className="text-sm font-medium text-gray-500 dark:text-gray-400">Alamat</label>
                            <textarea id="address" name="address" value={formData.address} onChange={handleInputChange} className={`mt-1 ${inputClasses}`} rows={3} />
                        </div>
                         <div>
                            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Lokasi Koordinat</label>
                            <div className="mt-2">
                                <MapPicker value={formData.location} onChange={handleLocationChange} />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-4 border-t dark:border-gray-600">
                            <button onClick={handleCancelClick} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-semibold">Batal</button>
                            <button onClick={handleSaveProfile} disabled={isSavingProfile} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold disabled:bg-blue-400">
                                {isSavingProfile ? 'Menyimpan...' : 'Simpan Perubahan'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <DetailRow label="ID Pelanggan" value={customer.id} />
                        <DetailRow label="Nama" value={customer.name} />
                        <DetailRow label="Email" value={customer.email} />
                        <DetailRow label="Telepon" value={customer.phone} />
                        <DetailRow label="Alamat" value={customer.address} />
                         <div className="flex items-center justify-end pt-4 border-t dark:border-gray-600">
                            <button onClick={handleEditClick} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold">
                                Edit Profil
                            </button>
                        </div>
                    </div>
                )}
            </Card>

            <Card title="Paket & Upgrade Layanan">
                {packageError && <div className="p-3 mb-4 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-md text-sm">{packageError}</div>}
                
                {pendingChange ? (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500 rounded-md">
                        <h4 className="font-semibold text-blue-800 dark:text-blue-200">Perubahan Paket Tertunda</h4>
                        <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                            Anda telah meminta untuk mengubah paket ke <strong>{(allPackages.find(p => p.id === pendingChange.new_package_id))?.name || 'Paket tidak dikenal'}</strong>.
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Perubahan ini akan diterapkan pada siklus tagihan Anda berikutnya.</p>
                        <button 
                            onClick={handleCancelChange} 
                            disabled={isSavingPackage}
                            className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                        >
                            Batalkan Permintaan
                        </button>
                    </div>
                ) : (
                    <>
                        {customerPackage && (
                            <div className="mb-6">
                                <h4 className="font-semibold text-gray-700 dark:text-gray-300">Paket Anda Saat Ini</h4>
                                <div className="mt-2 p-4 border rounded-lg bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600">
                                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{customerPackage.name}</p>
                                    <p className="text-md font-semibold text-gray-700 dark:text-gray-300">{customerPackage.speed} Mbps</p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">{formatRupiah(customerPackage.price)} / bulan</p>
                                </div>
                            </div>
                        )}
                        <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300">Pilih Paket Baru</h4>
                             {availablePackages.length > 0 ? (
                                <div 
                                    className="relative w-full max-w-xs mx-auto mt-4"
                                    onMouseEnter={() => setIsPaused(true)}
                                    onMouseLeave={() => setIsPaused(false)}
                                >
                                    <div className="overflow-hidden rounded-lg">
                                        <div className="slider-track" style={{ transform: `translateX(-${currentIndex * 100}%)` }}>
                                            {availablePackages.map((pkg) => (
                                                <div key={pkg.id} className="slider-item p-1">
                                                    <div className="w-full h-full p-4 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 shadow-md flex flex-col justify-between min-h-[180px]">
                                                        <div>
                                                            <p className="font-bold text-gray-800 dark:text-gray-100">{pkg.name}</p>
                                                            <p className="font-semibold text-gray-600 dark:text-gray-300">{pkg.speed} Mbps</p>
                                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{formatRupiah(pkg.price)} / bulan</p>
                                                        </div>
                                                        <button onClick={() => handleSwitchClick(pkg)} className="mt-4 w-full px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-md hover:bg-green-700">
                                                            Ganti
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex space-x-2">
                                        {availablePackages.map((_, index) => (
                                            <button
                                                key={index}
                                                onClick={() => setCurrentIndex(index)}
                                                className={`w-2 h-2 rounded-full transition-colors ${currentIndex === index ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                                                aria-label={`Go to slide ${index + 1}`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500 mt-2">Tidak ada paket lain yang tersedia saat ini.</p>
                            )}
                        </div>
                    </>
                )}
            </Card>

        </div>
    );
};

export default CustomerProfile;
