import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Card from '../../components/common/Card';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import MapPicker from '../../components/common/MapPicker';
import { Odp, Customer, CustomerStatus, Odc } from '../../types';
import { fetchWithAuth } from '~/components/api';
import Tag from '~/components/common/Tag';

const API_URL = '/api/network';

const CustomerStatusTag: React.FC<{ status: CustomerStatus }> = ({ status }) => {
    const colorMap: { [key in CustomerStatus]: 'green' | 'red' | 'yellow' | 'blue' } = {
    [CustomerStatus.Active]: 'green',
    [CustomerStatus.Inactive]: 'red',
    [CustomerStatus.Suspended]: 'yellow',
    [CustomerStatus.Unregister]: 'blue',
    };
    return <Tag color={colorMap[status]}>{status}</Tag>;
};


// --- Icon Components for Table Actions ---
const MapIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>;
const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>;
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
const CalculatorIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm1 2h6v2H7V4zm0 4h2v2H7V8zm4 0h2v2h-2V8zm-4 4h2v2H7v-2zm4 0h2v2h-2v-2z" clipRule="evenodd" /></svg>;


// --- ODP Form Modal ---
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
        if (isOpen) {
            if (odp && odp.id) {
                setFormData({
                    ...odp,
                    location: odp.location || null,
                });
            } else {
                setFormData(getInitialState());
            }
        }
    }, [odp, isOpen, getInitialState]);
    
    if (!isOpen) return null;

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

    const handleLocationChange = (location: { lat: number; lng: number }) => {
        setFormData((prev: any) => ({ ...prev, location }));
    };

    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white";

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 z-30 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                    <h2 className="text-lg font-semibold mb-4 dark:text-gray-200">{odp && odp.id ? 'Edit ODP' : 'Add New ODP'}</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input type="text" name="name" placeholder="ODP Name / ID" value={formData.name} onChange={handleInputChange} className={inputClasses} required />
                            <select name="parentId" value={formData.parentId || ''} onChange={handleInputChange} className={inputClasses}>
                                <option value="">Link to Parent (Optional)</option>
                                <optgroup label="ODCs">
                                    {allOdcs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </optgroup>
                                <optgroup label="ODPs">
                                    {allOdps.filter(o => o.id !== odp?.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
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
                             <div className="mt-2 space-y-2">
                                <MapPicker value={formData.location} onChange={handleLocationChange} />
                            </div>
                        </div>

                        <div className="flex justify-end space-x-2 pt-4">
                            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded">Cancel</button>
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


// --- Main Component ---
interface OdpManagementProps {
    onOpenCalculator?: (odpId: string) => void;
}

const OdpManagement: React.FC<OdpManagementProps> = ({ onOpenCalculator }) => {
    const [odps, setOdps] = useState<Odp[]>([]);
    const [odcs, setOdcs] = useState<Odc[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingOdp, setEditingOdp] = useState<Odp | null>(null);
    const [deletingOdp, setDeletingOdp] = useState<Odp | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedOdpId, setExpandedOdpId] = useState<string | null>(null);

    const handleOpenCalculator = (odpId: string) => {
        if (onOpenCalculator) {
            onOpenCalculator(odpId);
        } else {
            window.location.hash = `admin/fiber_calculator?odpId=${odpId}`;
        }
    };

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [odpsRes, customersRes, odcsRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/odps`),
                fetchWithAuth(`/api/customers`),
                fetchWithAuth(`${API_URL}/odcs`),
            ]);
            setOdps(await odpsRes.json());
            setCustomers(await customersRes.json());
            setOdcs(await odcsRes.json());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const customerCountsByOdp = useMemo(() => {
        return customers.reduce((acc, customer) => {
            if (customer.odpId) {
                acc[customer.odpId] = (acc[customer.odpId] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);
    }, [customers]);

    const filteredOdps = useMemo(() => {
        const lowercasedQuery = searchQuery.toLowerCase();
        if (!lowercasedQuery) return odps;

        return odps.filter(o =>
            o.name.toLowerCase().includes(lowercasedQuery) ||
            (o.address || '').toLowerCase().includes(lowercasedQuery)
        );
    }, [odps, searchQuery]);
    
    // Reset page on filter change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    // Pagination logic
    const totalPages = Math.ceil(filteredOdps.length / ITEMS_PER_PAGE);
    const paginatedOdps = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredOdps.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredOdps, currentPage]);


    const handleSaveOdp = async (odpData: any) => {
        setIsSaving(true);
        setError(null);
        const isEditing = !!odpData.id;
        const url = isEditing ? `${API_URL}/odps/${odpData.id}` : `${API_URL}/odps`;
        const method = isEditing ? 'PUT' : 'POST';

        try {
            const res = await fetchWithAuth(url, {
                method,
                body: JSON.stringify(odpData),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || `Failed to ${isEditing ? 'update' : 'create'} ODP.`);
            await fetchData();
            setIsModalOpen(false);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    };
    
    const confirmDelete = async () => {
        if (!deletingOdp) return;
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/odps/${deletingOdp.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to delete ODP.');
            }
            await fetchData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setDeletingOdp(null);
        }
    };
    
    if (isLoading) return <p>Loading ODP data...</p>;

    return (
        <div className="space-y-6">
            <OdpFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveOdp}
                odp={editingOdp}
                allOdps={odps}
                allOdcs={odcs}
                isSaving={isSaving}
            />
            <DeleteConfirmationModal
                isOpen={!!deletingOdp}
                onClose={() => setDeletingOdp(null)}
                onConfirm={confirmDelete}
                itemName={deletingOdp?.name || ''}
                itemType="ODP"
            />

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">ODP Management</h2>
                <button
                    onClick={() => { setEditingOdp(null); setIsModalOpen(true); }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-semibold shadow-sm"
                >
                    Add ODP
                </button>
            </div>
            
            {error && <div className="bg-red-100 text-red-700 p-4 rounded-md">{error}</div>}

            <Card>
                <div className="p-4 border-b dark:border-gray-700">
                    <input
                        type="text"
                        placeholder="Search by name or address..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-4 pr-4 py-2 border dark:border-gray-600 rounded-md w-full sm:w-96 bg-white dark:bg-gray-800 dark:text-white"
                    />
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Capacity</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Power (In/Out)</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Address</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {paginatedOdps.map(odp => {
                                const usedPorts = customerCountsByOdp[odp.id] || 0;
                                const totalPorts = odp.totalPorts || 0;
                                const connectedCustomers = customers.filter(c => c.odpId === odp.id);
                                let capacityColor = 'text-green-600 dark:text-green-400';
                                if (totalPorts > 0) {
                                    const ratio = usedPorts / totalPorts;
                                    if (ratio >= 1) capacityColor = 'text-red-600 dark:text-red-400';
                                    else if (ratio >= 0.75) capacityColor = 'text-yellow-600 dark:text-yellow-400';
                                }
                                return (
                                    <React.Fragment key={odp.id}>
                                        <tr 
                                            onClick={() => setExpandedOdpId(expandedOdpId === odp.id ? null : odp.id)}
                                            className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                                        >
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{odp.name}</td>
                                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold ${capacityColor}`}>{usedPorts} / {totalPorts}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{odp.powerInput || 'N/A'} / {odp.powerOutput || 'N/A'} dBm</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate" title={odp.address}>{odp.address}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <div className="flex items-center justify-end space-x-1">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleOpenCalculator(odp.id); }}
                                                        className="p-2 text-indigo-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                                                        title="Hitung Redaman (FO Calculator)"
                                                    >
                                                        <CalculatorIcon />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); if (odp.location) window.open(`https://www.google.com/maps?q=${odp.location.lat},${odp.location.lng}`, '_blank'); }}
                                                        className="p-2 text-green-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                                                        disabled={!odp.location}
                                                        title={odp.location ? "View on Google Maps" : "No location data"}
                                                    >
                                                        <MapIcon />
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); setEditingOdp(odp); setIsModalOpen(true); }} className="p-2 text-blue-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Edit ODP">
                                                        <EditIcon />
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); setDeletingOdp(odp); }} className="p-2 text-red-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" title="Delete ODP">
                                                        <TrashIcon />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {expandedOdpId === odp.id && (
                                            <tr className="bg-gray-50 dark:bg-gray-800">
                                                <td colSpan={5} className="p-4 sm:p-6">
                                                    <div className="p-5 bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 space-y-5">
                                                        {/* Top Info Bar */}
                                                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
                                                            <div>
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100">{odp.name}</h4>
                                                                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
                                                                        Kapasitas: {totalPorts || 8} Port
                                                                    </span>
                                                                    {odp.powerOutput != null && (
                                                                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                                                                            odp.powerOutput >= -24 && odp.powerOutput <= -15
                                                                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                                                                : odp.powerOutput < -27
                                                                                ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
                                                                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'
                                                                        }`}>
                                                                            Output: {odp.powerOutput} dBm ({
                                                                                odp.powerOutput >= -24 && odp.powerOutput <= -15
                                                                                    ? 'Optimal'
                                                                                    : odp.powerOutput < -27
                                                                                    ? 'Redaman Buruk'
                                                                                    : 'Waspada'
                                                                            })
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                                    Lokasi: {odp.address || 'Alamat belum diatur'} | Terpakai: <span className="font-semibold text-gray-800 dark:text-gray-200">{usedPorts}</span> / {totalPorts || 8} Port ({totalPorts ? Math.round((usedPorts / totalPorts) * 100) : 0}%)
                                                                </p>
                                                            </div>

                                                            <div className="flex items-center gap-3 flex-wrap">
                                                                <div className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-800/80 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">
                                                                    <span className="text-gray-500 dark:text-gray-400">Power In: <strong className="text-gray-800 dark:text-gray-200">{odp.powerInput != null ? `${odp.powerInput} dBm` : '-'}</strong></span>
                                                                    <span className="text-gray-300 dark:text-gray-600">|</span>
                                                                    <span className="text-gray-500 dark:text-gray-400">Power Out: <strong className="text-gray-800 dark:text-gray-200">{odp.powerOutput != null ? `${odp.powerOutput} dBm` : '-'}</strong></span>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenCalculator(odp.id)}
                                                                    className="inline-flex items-center gap-2 text-xs font-semibold bg-indigo-600 text-white px-3.5 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm cursor-pointer"
                                                                    title="Buka ODP ini di FO Power Budget & Loss Calculator"
                                                                >
                                                                    <CalculatorIcon />
                                                                    <span>FO Calculator</span>
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Utilization Bar */}
                                                        <div>
                                                            <div className="flex justify-between items-center text-xs text-gray-600 dark:text-gray-400 mb-1">
                                                                <span>Utilisasi Port ODP</span>
                                                                <span className="font-medium">{usedPorts} terpakai • {Math.max(0, (totalPorts || 8) - usedPorts)} tersedia</span>
                                                            </div>
                                                            <div className="w-full bg-gray-100 dark:bg-gray-800 h-2.5 rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full transition-all duration-300 ${
                                                                        usedPorts >= (totalPorts || 8)
                                                                            ? 'bg-red-500'
                                                                            : usedPorts / (totalPorts || 8) >= 0.75
                                                                            ? 'bg-yellow-500'
                                                                            : 'bg-emerald-500'
                                                                    }`}
                                                                    style={{ width: `${Math.min(100, Math.round((usedPorts / (totalPorts || 8)) * 100))}%` }}
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* Visual Port Matrix */}
                                                        <div>
                                                            <div className="flex items-center justify-between mb-2.5">
                                                                <h5 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                                                                    Visual Port Matrix ({totalPorts || 8} Port)
                                                                </h5>
                                                                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                                                    <span className="inline-flex items-center gap-1.5">
                                                                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                                                                        <span>Terisi ({usedPorts})</span>
                                                                    </span>
                                                                    <span className="inline-flex items-center gap-1.5">
                                                                        <span className="w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600 inline-block border border-dashed border-gray-400"></span>
                                                                        <span>Kosong ({Math.max(0, (totalPorts || 8) - usedPorts)})</span>
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2.5">
                                                                {Array.from({ length: Math.max(Number(totalPorts) || 8, connectedCustomers.length) }, (_, idx) => {
                                                                    const portNumber = idx + 1;
                                                                    const cust = connectedCustomers[idx];
                                                                    return (
                                                                        <div
                                                                            key={portNumber}
                                                                            className={`p-2.5 rounded-lg border text-left transition-all relative ${
                                                                                cust
                                                                                    ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 shadow-sm'
                                                                                    : 'bg-gray-50/60 dark:bg-gray-800/40 border-dashed border-gray-300 dark:border-gray-700'
                                                                            }`}
                                                                        >
                                                                            <div className="flex items-center justify-between mb-1.5">
                                                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                                                                    cust
                                                                                        ? 'bg-emerald-600 text-white'
                                                                                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                                                                }`}>
                                                                                    P{portNumber}
                                                                                </span>
                                                                                <span className={`w-2 h-2 rounded-full ${
                                                                                    cust ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                                                                                }`}></span>
                                                                            </div>
                                                                            {cust ? (
                                                                                <div className="space-y-0.5">
                                                                                    <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate" title={cust.name}>
                                                                                        {cust.name}
                                                                                    </div>
                                                                                    <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate" title={cust.pppoeUsername || cust.id}>
                                                                                        {cust.pppoeUsername || cust.id}
                                                                                    </div>
                                                                                    <div className="pt-0.5">
                                                                                        <span className={`inline-block text-[9px] px-1 py-0.2 rounded font-medium ${
                                                                                            cust.status === CustomerStatus.Active
                                                                                                ? 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/60 dark:text-emerald-300'
                                                                                                : 'text-amber-700 bg-amber-100 dark:bg-amber-900/60 dark:text-amber-300'
                                                                                        }`}>
                                                                                            {cust.status}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="space-y-0.5 py-1">
                                                                                    <div className="text-xs font-medium text-gray-400 dark:text-gray-500">
                                                                                        Kosong
                                                                                    </div>
                                                                                    <div className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                                                                                        Tersedia
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        {/* Connected Customers Table */}
                                                        <div>
                                                            <h5 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
                                                                Daftar Pelanggan Terhubung ({connectedCustomers.length})
                                                            </h5>
                                                            {connectedCustomers.length > 0 ? (
                                                                <div className="overflow-x-auto border rounded-lg dark:border-gray-700">
                                                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                                                        <thead className="bg-gray-100 dark:bg-gray-700/50">
                                                                            <tr>
                                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Customer ID</th>
                                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">PPPoE User</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                                            {connectedCustomers.map(customer => (
                                                                                <tr key={customer.id}>
                                                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{customer.id}</td>
                                                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{customer.name}</td>
                                                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm"><CustomerStatusTag status={customer.status} /></td>
                                                                                    <td className="px-4 py-2.5 whitespace-nowrap text-sm font-mono text-gray-500 dark:text-gray-400">{customer.pppoeUsername || '-'}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            ) : (
                                                                <p className="text-sm text-center text-gray-500 dark:text-gray-400 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                                                                    Belum ada pelanggan yang terhubung ke ODP ini.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                 <div className="flex items-center justify-between p-4 border-t dark:border-gray-700">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredOdps.length)}
                        {' to '}
                        {Math.min(currentPage * ITEMS_PER_PAGE, filteredOdps.length)}
                        {' of '}
                        {filteredOdps.length} results
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            Previous
                        </button>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Page {currentPage} of {totalPages > 0 ? totalPages : 1}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages || totalPages === 0}
                            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default OdpManagement;
