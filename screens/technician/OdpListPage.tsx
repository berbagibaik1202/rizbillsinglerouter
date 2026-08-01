import React, { useCallback, useEffect, useState } from 'react';
import { Customer, Odc, Odp, formatDateDisplay } from '../../types';
import { fetchWithAuth } from '~/components/api';
import MapPicker from '~/components/common/MapPicker';
import { ChevronDownIcon, ChevronRightIcon, MapPinIcon, PencilSquareIcon, PlusIcon } from '@heroicons/react/24/solid';

const NETWORK_API_URL = '/api/network';
const CUSTOMERS_API_URL = '/api/customers';

interface OdpFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (odp: any) => Promise<void>;
    odp: Odp | null;
    allOdps: Odp[];
    allOdcs: Odc[];
    isSaving: boolean;
}

const OdpFormModal: React.FC<OdpFormModalProps> = ({ isOpen, onClose, onSave, odp, allOdps, allOdcs, isSaving }) => {
    const getInitialState = useCallback(() => ({
        name: '',
        address: '',
        location: null,
        parentId: '',
        lineColor: '#6b7280',
        powerInput: 0,
        powerOutput: 0,
        totalPorts: 8,
    }), []);

    const [formData, setFormData] = useState<any>(getInitialState());

    useEffect(() => {
        if (!isOpen) return;
        if (odp && odp.id) {
            setFormData({
                ...odp,
                location: odp.location || null,
            });
            return;
        }
        setFormData(getInitialState());
    }, [isOpen, odp, getInitialState]);

    if (!isOpen) return null;

    const inputClasses = 'w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white';

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ ...formData, id: odp?.id });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        setFormData((prev: any) => ({
            ...prev,
            [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : value,
        }));
    };

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{odp?.id ? 'Edit ODP' : 'Add ODP'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input type="text" name="name" placeholder="ODP Name / ID" value={formData.name} onChange={handleInputChange} className={inputClasses} required />
                            <select name="parentId" value={formData.parentId || ''} onChange={handleInputChange} className={inputClasses}>
                                <option value="">Link to Parent (Optional)</option>
                                <optgroup label="ODCs">
                                    {allOdcs.map(odc => <option key={odc.id} value={odc.id}>{odc.name}</option>)}
                                </optgroup>
                                <optgroup label="ODPs">
                                    {allOdps.filter(o => o.id !== odp?.id).map(childOdp => <option key={childOdp.id} value={childOdp.id}>{childOdp.name}</option>)}
                                </optgroup>
                            </select>
                        </div>
                        <textarea name="address" placeholder="Address" value={formData.address} onChange={handleInputChange} className={inputClasses} rows={3}></textarea>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t dark:border-gray-600">
                            <input type="number" step="any" name="powerInput" placeholder="Power In (dBm)" value={formData.powerInput || ''} onChange={handleInputChange} className={inputClasses} />
                            <input type="number" step="any" name="powerOutput" placeholder="Power Out (dBm)" value={formData.powerOutput || ''} onChange={handleInputChange} className={inputClasses} />
                            <input type="number" name="totalPorts" placeholder="Total Ports" value={formData.totalPorts || ''} onChange={handleInputChange} className={inputClasses} />
                            <input type="color" name="lineColor" value={formData.lineColor} onChange={handleInputChange} className={`${inputClasses} h-10 p-1`} title="Line Color to Parent" />
                        </div>
                        <div className="pt-4 border-t dark:border-gray-600">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Location</label>
                            <div className="mt-2">
                                <MapPicker value={formData.location} onChange={(location) => setFormData((prev: any) => ({ ...prev, location }))} />
                            </div>
                        </div>
                        <div className="flex justify-end space-x-2 pt-4">
                            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded">
                                Cancel
                            </button>
                            <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400">
                                {isSaving ? 'Saving...' : 'Save ODP'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

const OdpListPage: React.FC = () => {
    const [odps, setOdps] = useState<Odp[]>([]);
    const [odcs, setOdcs] = useState<Odc[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [expandedOdpId, setExpandedOdpId] = useState<string | null>(null);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customersLoading, setCustomersLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingOdp, setEditingOdp] = useState<Odp | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [odpResponse, odcResponse, customerResponse] = await Promise.all([
                fetchWithAuth(`${NETWORK_API_URL}/odps`),
                fetchWithAuth(`${NETWORK_API_URL}/odcs`),
                fetchWithAuth(CUSTOMERS_API_URL),
            ]);

            const odpData = await odpResponse.json();
            const odcData = await odcResponse.json();
            const customerData = await customerResponse.json();

            setOdps(odpData);
            setOdcs(odcData);
            setAllCustomers(customerData);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch ODP data.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSaveOdp = async (odpData: any) => {
        setIsSaving(true);
        setError(null);
        const isEditing = !!odpData.id;
        const url = isEditing ? `${NETWORK_API_URL}/odps/${odpData.id}` : `${NETWORK_API_URL}/odps`;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify(odpData),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || `Failed to ${isEditing ? 'update' : 'create'} ODP.`);
            }
            setIsModalOpen(false);
            setEditingOdp(null);
            await fetchData();
        } catch (err: any) {
            setError(err.message || 'Failed to save ODP.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRowClick = (odpId: string) => {
        if (expandedOdpId === odpId) {
            setExpandedOdpId(null);
            return;
        }
        setExpandedOdpId(odpId);
        setCustomersLoading(true);
        setCustomers(allCustomers.filter(customer => customer.odpId === odpId));
        setCustomersLoading(false);
    };

    if (isLoading) return <div className="text-center p-4">Loading ODP data...</div>;
    if (error) return <div className="text-center p-4 text-red-500">{error}</div>;

    return (
        <div className="space-y-6">
            <OdpFormModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditingOdp(null);
                }}
                onSave={handleSaveOdp}
                odp={editingOdp}
                allOdps={odps}
                allOdcs={odcs}
                isSaving={isSaving}
            />

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">ODP List</h2>
                <button
                    onClick={() => {
                        setEditingOdp(null);
                        setIsModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm"
                >
                    <PlusIcon className="h-4 w-4" />
                    Add ODP
                </button>
            </div>

            <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th className="w-12 px-6 py-3"></th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Address</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Capacity</th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Location</th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {odps.map((odp) => (
                            <React.Fragment key={odp.id}>
                                <tr onClick={() => handleRowClick(odp.id)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                                    <td className="px-6 py-4">
                                        {expandedOdpId === odp.id ? <ChevronDownIcon className="h-5 w-5 text-gray-500" /> : <ChevronRightIcon className="h-5 w-5 text-gray-500" />}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{odp.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{odp.address}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{odp.totalPorts || 0} Ports</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                        {odp.location ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    window.open(`https://www.google.com/maps?q=${odp.location.lat},${odp.location.lng}`, '_blank');
                                                }}
                                                className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center"
                                                title="View on Map"
                                            >
                                                <MapPinIcon className="h-5 w-5" />
                                            </button>
                                        ) : <span className="text-gray-400 dark:text-gray-500">-</span>}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingOdp(odp);
                                                setIsModalOpen(true);
                                            }}
                                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                            title="Edit ODP"
                                        >
                                            <PencilSquareIcon className="h-5 w-5" />
                                        </button>
                                    </td>
                                </tr>
                                {expandedOdpId === odp.id && (
                                    <tr>
                                        <td colSpan={6} className="p-4 bg-gray-50 dark:bg-gray-800/50">
                                            {customersLoading ? (
                                                <div className="text-center">Loading customers...</div>
                                            ) : customers.length > 0 ? (
                                                <div className="px-4">
                                                    <h4 className="text-md font-semibold mb-2 text-gray-700 dark:text-gray-200">Connected Customers</h4>
                                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                                                        <thead className="bg-gray-100 dark:bg-gray-700">
                                                            <tr>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Name</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">PPPoE User</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Status</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Active Date</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {customers.map(customer => (
                                                                <tr key={customer.id}>
                                                                    <td className="px-4 py-2 text-sm text-gray-800 dark:text-gray-200">{customer.name}</td>
                                                                    <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 font-mono">{customer.pppoeUsername || '-'}</td>
                                                                    <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{customer.status}</td>
                                                                    <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{formatDateDisplay(customer.activeDate)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : <div className="text-center text-gray-500">No customers connected to this ODP.</div>}
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default OdpListPage;
