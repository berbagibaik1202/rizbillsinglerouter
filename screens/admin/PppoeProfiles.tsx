import React, { useState, useEffect, useCallback } from 'react';
import Card from '../../components/common/Card';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { PppoeProfile, PppoeUser } from '../../types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

// --- Form Modal ---
interface ProfileFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (profile: Omit<PppoeProfile, 'id' | 'userCount'> & { id?: string }) => Promise<void>;
    profile: PppoeProfile | null;
    isSaving: boolean;
}

const ProfileFormModal: React.FC<ProfileFormModalProps> = ({ isOpen, onClose, onSave, profile, isSaving }) => {
    const [formData, setFormData] = useState({ name: '', localAddress: '', remoteAddressPool: '', rateLimit: '' });

    useEffect(() => {
        if (isOpen) {
            if (profile) {
                setFormData({
                    name: profile.name,
                    localAddress: profile.localAddress,
                    remoteAddressPool: profile.remoteAddressPool,
                    rateLimit: profile.rateLimit,
                });
            } else {
                setFormData({ name: '', localAddress: '', remoteAddressPool: '', rateLimit: '' });
            }
        }
    }, [profile, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ ...formData, id: profile?.id });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white focus:ring-blue-500 focus:border-blue-500";

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-lg">
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{profile ? 'Edit PPPoE Profile' : 'Add New PPPoE Profile'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input type="text" name="name" placeholder="Profile Name" value={formData.name} onChange={handleInputChange} className={inputClasses} required disabled={!!profile} />
                        <input type="text" name="localAddress" placeholder="Local Address (e.g., 10.0.0.1)" value={formData.localAddress} onChange={handleInputChange} className={inputClasses} />
                        <input type="text" name="remoteAddressPool" placeholder="Remote Address Pool Name" value={formData.remoteAddressPool} onChange={handleInputChange} className={inputClasses} />
                        <input type="text" name="rateLimit" placeholder="Rate Limit (e.g., 5M/30M)" value={formData.rateLimit} onChange={handleInputChange} className={inputClasses} />
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
const PppoeProfiles: React.FC = () => {
    const [profiles, setProfiles] = useState<PppoeProfile[]>([]);
    const [users, setUsers] = useState<PppoeUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [editingProfile, setEditingProfile] = useState<PppoeProfile | null>(null);
    const [deletingProfile, setDeletingProfile] = useState<PppoeProfile | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchAllData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [profilesRes, usersRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/pppoe/profiles`),
                fetchWithAuth(`${API_URL}/pppoe/users`),
            ]);
            if (!profilesRes.ok || !usersRes.ok) throw new Error('Failed to fetch initial data.');

            setProfiles(await profilesRes.json());
            setUsers(await usersRes.json());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAllData();
    }, [fetchAllData]);

    const handleSaveProfile = async (profileData: Omit<PppoeProfile, 'id' | 'userCount'> & { id?: string }) => {
        setIsSaving(true);
        setError(null);
        const isEditing = !!profileData.id;
        const url = isEditing ? `${API_URL}/pppoe/profiles/${profileData.id}` : `${API_URL}/pppoe/profiles`;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify(profileData),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || `Failed to ${isEditing ? 'update' : 'create'} profile.`);
            }
            await fetchAllData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSaving(false);
            setEditingProfile(null);
        }
    };

    const handleDeleteProfile = async () => {
        if (!deletingProfile) return;
        setIsDeleting(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/pppoe/profiles/${deletingProfile.id}`, { method: 'DELETE' });
            if (!res.ok) {
                 const data = await res.json();
                 throw new Error(data.message || 'Failed to delete profile.');
            }
            await fetchAllData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsDeleting(false);
            setDeletingProfile(null);
        }
    };
    
    // Calculate user counts for each profile
    const profilesWithCounts = profiles.map(profile => ({
        ...profile,
        userCount: users.filter(user => user.profile === profile.name).length
    }));

    if (isLoading) {
        return <p>Loading profiles...</p>;
    }

    return (
        <div className="space-y-6">
            <ProfileFormModal
                isOpen={!!editingProfile}
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
                itemType="PPPoE profile"
                isLoading={isDeleting}
            />
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">PPPoE Profiles</h2>
                <button
                    onClick={() => setEditingProfile({} as PppoeProfile)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm"
                >
                    Add New Profile
                </button>
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
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Remote Address Pool</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Users</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {profilesWithCounts.map(profile => (
                                <tr key={profile.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{profile.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{profile.rateLimit || '-'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{profile.remoteAddressPool || '-'}</td>
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

export default PppoeProfiles;