import React, { useState, useEffect, useCallback } from 'react';
import Card from '../../components/common/Card';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { HotspotProfile, formatRupiah, formatDuration } from '../../types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api/hotspot';

// --- Form Modal ---
interface ProfileFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (profile: Omit<HotspotProfile, 'id' | 'userCount'> & { id?: string }) => Promise<void>;
    profile: HotspotProfile | null;
    isSaving: boolean;
}

const ProfileFormModal: React.FC<ProfileFormModalProps> = ({ isOpen, onClose, onSave, profile, isSaving }) => {
    const [formData, setFormData] = useState({ name: '', rateLimit: '', sharedUsers: 1, price: 0, sellingPrice: 0, duration_minutes: 60 });
    const [durationValue, setDurationValue] = useState(1);
    const [durationUnit, setDurationUnit] = useState('hours');


    useEffect(() => {
        if (isOpen) {
            if (profile && profile.id) {
                const minutes = profile.duration_minutes || 60;
                let unit = 'minutes';
                let value = minutes;
                if (minutes % (60 * 24 * 30) === 0) {
                    unit = 'months'; value = minutes / (60 * 24 * 30);
                } else if (minutes % (60 * 24 * 7) === 0) {
                    unit = 'weeks'; value = minutes / (60 * 24 * 7);
                } else if (minutes % (60 * 24) === 0) {
                    unit = 'days'; value = minutes / (60 * 24);
                } else if (minutes % 60 === 0) {
                    unit = 'hours'; value = minutes / 60;
                }
                setDurationValue(value);
                setDurationUnit(unit);
                setFormData({ name: profile.name, rateLimit: profile.rateLimit, sharedUsers: profile.sharedUsers, price: profile.price || 0, sellingPrice: profile.sellingPrice || 0, duration_minutes: profile.duration_minutes || 60 });
            } else {
                setFormData({ name: '', rateLimit: '', sharedUsers: 1, price: 0, sellingPrice: 0, duration_minutes: 60 });
                setDurationValue(1);
                setDurationUnit('hours');
            }
        }
    }, [profile, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        let totalDurationInMinutes = durationValue;
        switch (durationUnit) {
            case 'hours': totalDurationInMinutes *= 60; break;
            case 'days': totalDurationInMinutes *= 60 * 24; break;
            case 'weeks': totalDurationInMinutes *= 60 * 24 * 7; break;
            case 'months': totalDurationInMinutes *= 60 * 24 * 30; break;
        }
        onSave({ ...formData, id: profile?.id, duration_minutes: totalDurationInMinutes });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'number' ? (value === '' ? 0 : parseInt(value, 10)) : value }));
    };
    
    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400";

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-md">
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{profile && profile.id ? 'Edit Hotspot Profile' : 'Add New Hotspot Profile'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input type="text" name="name" placeholder="Profile Name" value={formData.name} onChange={handleInputChange} className={inputClasses} required disabled={!!(profile && profile.id)} />
                        <input type="text" name="rateLimit" placeholder="Rate Limit (e.g., 1M/5M)" value={formData.rateLimit} onChange={handleInputChange} className={inputClasses} />
                        <div className="grid grid-cols-2 gap-4">
                            <input type="number" name="sharedUsers" placeholder="Shared Users" value={formData.sharedUsers} onChange={handleInputChange} className={inputClasses} required min="1" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm text-gray-500">Harga Modal (Rp)</label>
                                <input type="number" name="price" placeholder="Harga Modal (Rp)" value={formData.price} onChange={handleInputChange} className={inputClasses} min="0" />
                            </div>
                            <div>
                                <label className="text-sm text-gray-500">Harga Jual (Rp)</label>
                                <input type="number" name="sellingPrice" placeholder="Harga Jual (Rp)" value={formData.sellingPrice} onChange={handleInputChange} className={inputClasses} min="0" />
                            </div>
                        </div>
                         <div>
                            <label className="text-sm text-gray-500">Durasi</label>
                            <div className="flex">
                                <input type="number" value={durationValue} onChange={(e) => setDurationValue(parseInt(e.target.value) || 1)} className={`rounded-l-md flex-grow ${inputClasses}`} min="1" required />
                                <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value)} className={`rounded-l-none ${inputClasses}`}>
                                    <option value="minutes">Menit</option>
                                    <option value="hours">Jam</option>
                                    <option value="days">Hari</option>
                                    <option value="weeks">Minggu</option>
                                    <option value="months">Bulan</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex justify-end space-x-2 pt-4">
                            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded">Cancel</button>
                            <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400">
                                {isSaving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};


// --- Main Component ---
const HotspotProfiles: React.FC = () => {
    const [profiles, setProfiles] = useState<HotspotProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [editingProfile, setEditingProfile] = useState<HotspotProfile | null>(null);
    const [deletingProfile, setDeletingProfile] = useState<HotspotProfile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/profiles`);
            if (!res.ok) throw new Error('Failed to fetch profiles.');
            setProfiles(await res.json());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSync = async () => {
        setIsSyncing(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/profiles/sync`, { method: 'POST' });
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Sync failed');
            }
            setProfiles(await res.json());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSyncing(false);
        }
    };


    const handleSaveProfile = async (profileData: Omit<HotspotProfile, 'id' | 'userCount'> & { id?: string }) => {
        setIsSaving(true);
        setError(null);
        const isEditing = !!profileData.id;
        const url = isEditing ? `${API_URL}/profiles/${profileData.id}` : `${API_URL}/profiles`;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify(profileData),
            });
            if (!res.ok) throw new Error((await res.json()).message || 'Failed to save profile.');
            await fetchData(); // Refresh list
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSaving(false);
            setEditingProfile(null); // Close modal
        }
    };

    const handleDeleteProfile = async () => {
        if (!deletingProfile) return;
        setIsDeleting(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/profiles/${deletingProfile.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete profile.');
            await fetchData(); // Refresh list
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsDeleting(false);
            setDeletingProfile(null);
        }
    };
    
    if (isLoading) return <p>Loading profiles...</p>;

    return (
        <div className="space-y-6">
            <ProfileFormModal
                isOpen={editingProfile !== null}
                onClose={() => setEditingProfile(null)}
                onSave={handleSaveProfile}
                profile={editingProfile}
                isSaving={isSaving}
            />
            <DeleteConfirmationModal
                isOpen={!!deletingProfile}
                onClose={() => setDeletingProfile(null)}
                onConfirm={handleDeleteProfile}
                itemName={deletingProfile?.name || ''}
                itemType="Hotspot profile"
                isLoading={isDeleting}
            />
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Hotspot Profiles</h2>
                 <div className="flex space-x-2">
                    <button onClick={() => setEditingProfile({} as HotspotProfile)} className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 font-semibold shadow-sm">Add New Profile</button>
                    <button onClick={handleSync} disabled={isSyncing} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm disabled:bg-gray-400 flex items-center">
                        {isSyncing ? <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="-ml-1 mr-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566z" clipRule="evenodd" /></svg>}
                        {isSyncing ? 'Syncing...' : 'Sync with DB'}
                    </button>
                </div>
            </div>
            {error && (
                 <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-md" role="alert">
                    <p className="font-bold">Error</p>
                    <p>{error}</p>
                 </div>
            )}
            <Card>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Rate Limit</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Shared Users</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Harga Jual</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Durasi</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Users</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {profiles.map(profile => (
                                <tr key={profile.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{profile.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{profile.rateLimit || '-'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{profile.sharedUsers}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">{formatRupiah(profile.sellingPrice || 0)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDuration(profile.duration_minutes || 0)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{profile.userCount}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                        <button onClick={() => setEditingProfile(profile)} className="text-blue-600 dark:text-blue-400 hover:underline">Edit</button>
                                        <button onClick={() => setDeletingProfile(profile)} className="text-red-600 dark:text-red-400 hover:underline">Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

export default HotspotProfiles;
