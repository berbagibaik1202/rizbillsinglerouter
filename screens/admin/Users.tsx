import React, { useState, useEffect, useCallback } from 'react';
import Card from '../../components/common/Card';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { AdminUser, UserRole, formatRupiah } from '../../types';
import Tag from '../../components/common/Tag';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api/admin';

// --- Add Balance Modal ---
interface AddBalanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (amount: number) => Promise<void>;
    user: AdminUser | null;
    isSaving: boolean;
}

const AddBalanceModal: React.FC<AddBalanceModalProps> = ({ isOpen, onClose, onConfirm, user, isSaving }) => {
    const [amount, setAmount] = useState(0);

    useEffect(() => {
        if(isOpen) setAmount(0);
    }, [isOpen]);

    if (!isOpen || !user) return null;

    const handleConfirm = () => {
        if (amount > 0) {
            onConfirm(amount);
        }
    };

    return (
        <div className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-40 w-full max-w-sm">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Add Balance for {user.username}</h3>
                    <div className="mt-4 space-y-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Current balance: <strong>{formatRupiah(user.balance || 0)}</strong>
                        </p>
                        <div>
                            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Amount to Add (IDR)</label>
                            <input
                                type="number"
                                id="amount"
                                value={amount}
                                onChange={(e) => setAmount(Number(e.target.value))}
                                className="mt-1 block w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                                min="1"
                                step="1000"
                            />
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end space-x-2">
                        <button onClick={onClose} type="button" className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md text-sm font-medium">Cancel</button>
                        <button onClick={handleConfirm} disabled={isSaving || amount <= 0} type="button" className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:bg-gray-400">
                            {isSaving ? 'Saving...' : 'Confirm'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- User Form Modal ---
interface UserFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: { id?: string; username: string; password?: string, role: UserRole, phone?: string }) => Promise<void>;
    user: AdminUser | null;
    isSaving: boolean;
    error: string | null;
}

const UserFormModal: React.FC<UserFormModalProps> = ({ isOpen, onClose, onSave, user, isSaving, error }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<UserRole>('reseller');
    const [phone, setPhone] = useState('');

    useEffect(() => {
        if (isOpen) {
            setUsername(user?.username || '');
            setRole(user?.role || 'reseller');
            setPhone(user?.phone || '');
            setPassword(''); // Always reset password field for security
        }
    }, [user, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const data: { id?: string; username: string; password?: string; role: UserRole; phone?: string } = {
            id: user?.id,
            username,
            role,
            phone,
        };
        if (password) {
            data.password = password;
        }
        onSave(data);
    };

    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white focus:ring-blue-500 focus:border-blue-500";

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-md">
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{user ? 'Edit User' : 'Add New User'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username</label>
                            <input
                                type="text"
                                id="username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className={`mt-1 ${inputClasses}`}
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="password" aria-label="Password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                            <input
                                type="password"
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={`mt-1 ${inputClasses}`}
                                placeholder={user ? 'Leave blank to keep unchanged' : 'Required'}
                                required={!user}
                            />
                        </div>
                        <div>
                            <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
                            <select
                                id="role"
                                value={role}
                                onChange={(e) => setRole(e.target.value as UserRole)}
                                className={`mt-1 ${inputClasses}`}
                            >
                                <option value="admin">Admin</option>
                                <option value="reseller">Reseller</option>
                                <option value="technician">Technician</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number (optional)</label>
                            <input
                                type="tel"
                                id="phone"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className={`mt-1 ${inputClasses}`}
                                placeholder="e.g. 628123456789"
                            />
                        </div>
                        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                        <div className="flex justify-end space-x-2 pt-4">
                            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500">Cancel</button>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400 disabled:cursor-wait flex items-center"
                            >
                                {isSaving && <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                {isSaving ? 'Saving...' : 'Save User'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

// --- Main Users Component ---
const Users: React.FC = () => {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
    const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
    const [balancingUser, setBalancingUser] = useState<AdminUser | null>(null);
    const [modalError, setModalError] = useState<string | null>(null);
    const [globalError, setGlobalError] = useState<string | null>(null);

    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        setGlobalError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/users`);
            if (!res.ok) {
                throw new Error('Failed to fetch users. Please ensure the server is running and accessible.');
            }
            setUsers(await res.json());
        } catch (error: any) {
            console.error("Failed to fetch admin users:", error);
            setGlobalError(error.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleAddUser = () => {
        setEditingUser(null);
        setModalError(null);
        setIsModalOpen(true);
    };

    const handleEditUser = (user: AdminUser) => {
        setEditingUser(user);
        setModalError(null);
        setIsModalOpen(true);
    };

    const handleSaveUser = async (data: { id?: string; username: string; password?: string; role: UserRole; phone?: string }) => {
        setIsSaving(true);
        setModalError(null);

        const isEditing = !!data.id;
        const url = isEditing ? `${API_URL}/users/${data.id}` : `${API_URL}/users`;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify({ username: data.username, password: data.password, role: data.role, phone: data.phone }),
            });

            const responseData = await res.json();
            if (!res.ok) {
                throw new Error(responseData.message || `Failed to ${isEditing ? 'update' : 'create'} user.`);
            }

            await fetchUsers();
            setIsModalOpen(false);
        } catch (error: any) {
            console.error("Failed to save user:", error);
            setModalError(error.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddBalance = async (amount: number) => {
        if (!balancingUser) return;
        setIsSaving(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/users/${balancingUser.id}/add-balance`, {
                method: 'POST',
                body: JSON.stringify({ amount }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to add balance.');
            }
            await fetchUsers();
            setBalancingUser(null);
        } catch (error: any) {
            setGlobalError(error.message);
        } finally {
            setIsSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (deletingUser) {
            setIsDeleting(true);
            setGlobalError(null);
            try {
                const res = await fetchWithAuth(`${API_URL}/users/${deletingUser.id}`, { method: 'DELETE' });
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'Failed to delete user.');
                }
                await fetchUsers();
            } catch (error: any) {
                console.error("Failed to delete user:", error);
                setGlobalError(error.message);
            } finally {
                setIsDeleting(false);
                setDeletingUser(null);
            }
        }
    };

    if (isLoading) {
        return <p>Loading users...</p>;
    }

    return (
        <div className="space-y-6">
            <UserFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveUser}
                user={editingUser}
                isSaving={isSaving}
                error={modalError}
            />
            <AddBalanceModal
                isOpen={!!balancingUser}
                onClose={() => setBalancingUser(null)}
                onConfirm={handleAddBalance}
                user={balancingUser}
                isSaving={isSaving}
            />
            <DeleteConfirmationModal
                isOpen={!!deletingUser}
                onClose={() => setDeletingUser(null)}
                onConfirm={confirmDelete}
                itemName={deletingUser?.username || ''}
                itemType="user"
                isLoading={isDeleting}
            />

            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Administrator & Reseller Users</h2>
                <button
                    onClick={handleAddUser}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm transition-colors"
                >
                    Add New User
                </button>
            </div>
            {globalError && (
                <div className="bg-red-100 dark:bg-red-900/40 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-md" role="alert">
                    <p className="font-bold">Error</p>
                    <p>{globalError}</p>
                </div>
            )}
            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                        <tr>
                            <th scope="col" className="px-6 py-3">User ID</th>
                            <th scope="col" className="px-6 py-3">Username</th>
                            <th scope="col" className="px-6 py-3">Role</th>
                            <th scope="col" className="px-6 py-3">Balance</th>
                            <th scope="col" className="px-6 py-3 text-right">Actions</th>
                        </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800">
                        {users.map(user => (
                            <tr key={user.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{user.id}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{user.username}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <Tag color={user.role === 'admin' ? 'red' : (user.role === 'technician' ? 'yellow' : 'blue')}>
                                        {user.role}
                                    </Tag>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-200">
                                    {user.role === 'reseller' ? formatRupiah(user.balance || 0) : 'N/A'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                    {user.role === 'reseller' && (
                                        <button onClick={() => setBalancingUser(user)} className="font-medium text-green-600 dark:text-green-500 hover:underline">Add Balance</button>
                                    )}
                                    <button onClick={() => handleEditUser(user)} className="font-medium text-blue-600 dark:text-blue-500 hover:underline">Edit</button>
                                    <button onClick={() => setDeletingUser(user)} className="font-medium text-red-600 dark:text-red-500 hover:underline">Delete</button>
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

export default Users;