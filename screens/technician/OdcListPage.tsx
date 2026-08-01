import React, { useCallback, useEffect, useState } from 'react';
import { Odc, Odp } from '../../types';
import { fetchWithAuth } from '~/components/api';
import MapPicker from '~/components/common/MapPicker';
import { ChevronDownIcon, ChevronRightIcon, MapPinIcon, PencilSquareIcon, PlusIcon } from '@heroicons/react/24/solid';

const API_URL = '/api/network';

interface OdcFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (odc: any) => Promise<void>;
    odc: Odc | null;
    allOdcs: Odc[];
    isSaving: boolean;
}

const OdcFormModal: React.FC<OdcFormModalProps> = ({ isOpen, onClose, onSave, odc, allOdcs, isSaving }) => {
    const getInitialState = useCallback(() => ({
        name: '',
        address: '',
        location: null,
        parentId: '',
        lineColor: '#3b82f6',
        powerInput: 0,
        powerOutput: 0,
        totalPorts: 144,
    }), []);

    const [formData, setFormData] = useState<any>(getInitialState());

    useEffect(() => {
        if (!isOpen) return;
        if (odc && odc.id) {
            setFormData({
                ...odc,
                location: odc.location || null,
            });
            return;
        }
        setFormData(getInitialState());
    }, [isOpen, odc, getInitialState]);

    if (!isOpen) return null;

    const inputClasses = 'w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white';

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ ...formData, id: odc?.id });
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
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{odc?.id ? 'Edit ODC' : 'Add ODC'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input type="text" name="name" placeholder="ODC Name / ID" value={formData.name} onChange={handleInputChange} className={inputClasses} required />
                            <select name="parentId" value={formData.parentId || ''} onChange={handleInputChange} className={inputClasses}>
                                <option value="">Link to Parent ODC (Optional)</option>
                                {allOdcs.filter(o => o.id !== odc?.id).map(parentOdc => <option key={parentOdc.id} value={parentOdc.id}>{parentOdc.name}</option>)}
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
                                {isSaving ? 'Saving...' : 'Save ODC'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

const OdcListPage: React.FC = () => {
    const [odcs, setOdcs] = useState<Odc[]>([]);
    const [allOdps, setAllOdps] = useState<Odp[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedOdcId, setExpandedOdcId] = useState<string | null>(null);
    const [childOdps, setChildOdps] = useState<Odp[]>([]);
    const [childOdpsLoading, setChildOdpsLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingOdc, setEditingOdc] = useState<Odc | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [odcResponse, odpResponse] = await Promise.all([
                fetchWithAuth(`${API_URL}/odcs`),
                fetchWithAuth(`${API_URL}/odps`),
            ]);

            const odcData = await odcResponse.json();
            const odpData = await odpResponse.json();

            setOdcs(odcData);
            setAllOdps(odpData);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch network data.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSaveOdc = async (odcData: any) => {
        setIsSaving(true);
        setError(null);
        const isEditing = !!odcData.id;
        const url = isEditing ? `${API_URL}/odcs/${odcData.id}` : `${API_URL}/odcs`;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify(odcData),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || `Failed to ${isEditing ? 'update' : 'create'} ODC.`);
            }
            setIsModalOpen(false);
            setEditingOdc(null);
            await fetchData();
        } catch (err: any) {
            setError(err.message || 'Failed to save ODC.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRowClick = (odcId: string) => {
        if (expandedOdcId === odcId) {
            setExpandedOdcId(null);
            return;
        }
        setExpandedOdcId(odcId);
        setChildOdpsLoading(true);
        setChildOdps(allOdps.filter(odp => odp.parentId === odcId));
        setChildOdpsLoading(false);
    };

    if (isLoading) return <div className="text-center p-4">Loading ODC data...</div>;
    if (error) return <div className="text-center p-4 text-red-500">{error}</div>;

    return (
        <div className="space-y-6">
            <OdcFormModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditingOdc(null);
                }}
                onSave={handleSaveOdc}
                odc={editingOdc}
                allOdcs={odcs}
                isSaving={isSaving}
            />

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">ODC List</h2>
                <button
                    onClick={() => {
                        setEditingOdc(null);
                        setIsModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm"
                >
                    <PlusIcon className="h-4 w-4" />
                    Add ODC
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
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Coordinates</th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {odcs.map((odc) => (
                            <React.Fragment key={odc.id}>
                                <tr onClick={() => handleRowClick(odc.id)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                                    <td className="px-6 py-4">
                                        {expandedOdcId === odc.id ? <ChevronDownIcon className="h-5 w-5 text-gray-500" /> : <ChevronRightIcon className="h-5 w-5 text-gray-500" />}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{odc.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{odc.address}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{odc.totalPorts || 0} Ports</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300 font-mono">
                                        {odc.location ? `${odc.location.lat.toFixed(5)}, ${odc.location.lng.toFixed(5)}` : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                        <div className="inline-flex items-center gap-2">
                                            {odc.location && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(`https://www.google.com/maps?q=${odc.location.lat},${odc.location.lng}`, '_blank');
                                                    }}
                                                    className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                                                    title="View on Map"
                                                >
                                                    <MapPinIcon className="h-5 w-5" />
                                                </button>
                                            )}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingOdc(odc);
                                                    setIsModalOpen(true);
                                                }}
                                                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                                title="Edit ODC"
                                            >
                                                <PencilSquareIcon className="h-5 w-5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {expandedOdcId === odc.id && (
                                    <tr>
                                        <td colSpan={6} className="p-4 bg-gray-50 dark:bg-gray-800/50">
                                            {childOdpsLoading ? <div className="text-center">Loading ODPs...</div>
                                            : childOdps.length > 0 ? (
                                                <div className="px-4">
                                                    <h4 className="text-md font-semibold mb-2 text-gray-700 dark:text-gray-200">Connected ODPs</h4>
                                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                                                        <thead className="bg-gray-100 dark:bg-gray-700">
                                                            <tr>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Name</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Address</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Power (dBm)</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Location</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                                            {childOdps.map(odp => (
                                                                <tr key={odp.id}>
                                                                    <td className="px-4 py-2 text-sm text-gray-800 dark:text-gray-200">{odp.name}</td>
                                                                    <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">{odp.address}</td>
                                                                    <td className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 font-mono">
                                                                        {odp.powerInput !== undefined ? `In: ${odp.powerInput}` : ''}
                                                                        {odp.powerOutput !== undefined ? ` / Out: ${odp.powerOutput}` : ''}
                                                                    </td>
                                                                    <td className="px-4 py-2 text-sm">
                                                                        {odp.location && (
                                                                            <button
                                                                                onClick={() => window.open(`https://www.google.com/maps?q=${odp.location.lat},${odp.location.lng}`, '_blank')}
                                                                                className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                                                                title="View on Map"
                                                                            >
                                                                                <MapPinIcon className="h-5 w-5" />
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : <div className="text-center text-gray-500">No ODPs connected to this ODC.</div>}
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

export default OdcListPage;
