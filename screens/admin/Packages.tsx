import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Card from '../../components/common/Card';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { Package, PppoeProfile, Customer, formatRupiah } from '../../types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

// --- Form Modal ---
interface PackageFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (pkg: Omit<Package, 'id'> & { id?: number }) => Promise<void>;
    pkg: Package | null;
    profiles: PppoeProfile[];
    isSaving: boolean;
}

const PackageFormModal: React.FC<PackageFormModalProps> = ({ isOpen, onClose, onSave, pkg, profiles, isSaving }) => {
    const getInitialState = useCallback(() => ({
        name: '',
        speed: 30,
        price: 0,
        pppoeProfile: profiles[0]?.name || '',
        useTax: true,
    }), [profiles]);
    
    const [formData, setFormData] = useState(getInitialState());

    useEffect(() => {
        if (isOpen) {
            if (pkg && pkg.id) { // Check if it's a real package, not an empty object for creation
                setFormData({ name: pkg.name, speed: pkg.speed, price: pkg.price, pppoeProfile: pkg.pppoeProfile || '', useTax: pkg.useTax ?? true });
            } else {
                setFormData(getInitialState());
            }
        }
    }, [pkg, isOpen, getInitialState]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ ...formData, id: pkg?.id });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const target = e.target as HTMLInputElement;
        
        setFormData(prev => ({ 
            ...prev, 
            [name]: type === 'checkbox' ? target.checked : (type === 'number' ? parseInt(value, 10) : value) 
        }));
    };

    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400";

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-lg">
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{pkg && pkg.id ? 'Edit Package' : 'Add New Package'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input type="text" name="name" placeholder="Package Name" value={formData.name} onChange={handleInputChange} className={inputClasses} required />
                        <div className="grid grid-cols-2 gap-4">
                            <input type="number" name="speed" placeholder="Speed (Mbps)" value={formData.speed} onChange={handleInputChange} className={inputClasses} required />
                            <input type="number" name="price" placeholder="Price (IDR)" value={formData.price} onChange={handleInputChange} className={inputClasses} required />
                        </div>
                        <select name="pppoeProfile" value={formData.pppoeProfile || ''} onChange={handleInputChange} className={inputClasses}>
                            <option value="">Link to PPPoE Profile (Optional)</option>
                            {profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </select>
                        <div className="flex items-center pt-2">
                            <input 
                                id="useTax" 
                                name="useTax" 
                                type="checkbox" 
                                checked={formData.useTax} 
                                onChange={handleInputChange}
                                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" 
                            />
                            <label htmlFor="useTax" className="ml-2 block text-sm text-gray-900 dark:text-gray-200">
                                Apply Tax to this Package
                            </label>
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
const Packages: React.FC = () => {
    const [packages, setPackages] = useState<Package[]>([]);
    const [profiles, setProfiles] = useState<PppoeProfile[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [editingPackage, setEditingPackage] = useState<Package | null>(null);
    const [deletingPackage, setDeletingPackage] = useState<Package | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchPackages = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${API_URL}/network/packages`);
            setPackages(await res.json());
        } catch (err) { console.error("Failed to fetch packages:", err); }
    }, []);

    useEffect(() => {
        const fetchInitialData = async () => {
            setIsLoading(true);
            try {
                const [profilesRes, customersRes] = await Promise.all([
                    fetchWithAuth(`${API_URL}/pppoe/profiles`),
                    fetchWithAuth(`${API_URL}/customers`),
                ]);
                setProfiles(await profilesRes.json());
                setCustomers(await customersRes.json());
                await fetchPackages();
            } catch (err) { console.error("Failed to fetch initial data:", err); } 
            finally { setIsLoading(false); }
        };
        fetchInitialData();
    }, [fetchPackages]);
    
    const customerCounts = useMemo(() => {
        return packages.reduce((acc, pkg) => {
            acc[pkg.id] = customers.filter(c => c.packageId === pkg.id).length;
            return acc;
        }, {} as Record<number, number>);
    }, [packages, customers]);

    const handleSavePackage = async (pkgData: Omit<Package, 'id'> & { id?: number }) => {
        setIsSaving(true);
        setError(null);
        const isEditing = !!pkgData.id;
        const url = isEditing ? `${API_URL}/network/packages/${pkgData.id}` : `${API_URL}/network/packages`;
        const method = isEditing ? 'PUT' : 'POST';
        try {
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify(pkgData),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || `Failed to ${isEditing ? 'update' : 'create'} package.`);
            await fetchPackages(); // Refresh list
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSaving(false);
            setEditingPackage(null); // Close modal
        }
    };

    const handleDeletePackage = async () => {
        if (!deletingPackage) return;
        setIsDeleting(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/network/packages/${deletingPackage.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Failed to delete package.');
            }
            await fetchPackages(); // Refresh list
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsDeleting(false);
            setDeletingPackage(null);
        }
    };

    return (
        <div className="space-y-6">
            <PackageFormModal
                isOpen={editingPackage !== null}
                onClose={() => setEditingPackage(null)}
                onSave={handleSavePackage}
                pkg={editingPackage}
                profiles={profiles}
                isSaving={isSaving}
            />
            <DeleteConfirmationModal
                isOpen={!!deletingPackage}
                onClose={() => setDeletingPackage(null)}
                onConfirm={handleDeletePackage}
                itemName={deletingPackage?.name || ''}
                itemType="package"
                isLoading={isDeleting}
            />
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Internet Packages</h2>
                <button
                    onClick={() => setEditingPackage({} as Package)} // Open modal for new package
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm"
                >
                    Add New Package
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
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Package Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Speed</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Price</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Taxable</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">PPPoE Profile</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Customers</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                        Loading packages...
                                    </td>
                                </tr>
                            ) : packages.length > 0 ? (
                                packages.map(pkg => (
                                    <tr key={pkg.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{pkg.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{pkg.speed} Mbps</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatRupiah(pkg.price)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {pkg.useTax ? (
                                                <span className="px-2 py-1 text-xs font-semibold text-green-800 bg-green-100 rounded-full dark:bg-green-900/50 dark:text-green-300">Yes</span>
                                            ) : (
                                                <span className="px-2 py-1 text-xs font-semibold text-red-800 bg-red-100 rounded-full dark:bg-red-900/50 dark:text-red-300">No</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{pkg.pppoeProfile || <span className="text-gray-400">-</span>}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{customerCounts[pkg.id] || 0}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                            <button onClick={() => setEditingPackage(pkg)} className="text-blue-600 dark:text-blue-400 hover:underline">Edit</button>
                                            <button onClick={() => setDeletingPackage(pkg)} className="text-red-600 dark:text-red-400 hover:underline">Delete</button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={7} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                        No internet packages have been created yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

export default Packages;