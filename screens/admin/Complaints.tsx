import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Card from '../../components/common/Card';
import Tag from '../../components/common/Tag';
import DeleteConfirmationModal from '../../components/common/DeleteConfirmationModal';
import { Complaint, ComplaintStatus, Customer, AdminUser, formatDateTimeDisplay, formatTimeDisplay, ComplaintReply } from '../../types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

// --- Icon Components for Bulk Actions ---
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;

// --- Complaint Status Tag ---
const ComplaintStatusTag: React.FC<{ status: ComplaintStatus }> = ({ status }) => {
    const colorMap: { [key in ComplaintStatus]: 'blue' | 'yellow' | 'green' } = {
      [ComplaintStatus.Pending]: 'blue',
      [ComplaintStatus.InProgress]: 'yellow',
      [ComplaintStatus.Resolved]: 'green',
    };
    return <Tag color={colorMap[status]}>{status}</Tag>;
};

// --- Complaint Detail Modal ---
interface ComplaintDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    complaint: Complaint | null;
    customers: Customer[];
    technicians: AdminUser[];
    onUpdate: (id: string, updates: { status?: ComplaintStatus; assignedTo?: string; replyText?: string, photo?: File | null }) => Promise<void>;
    isSubmitting: boolean;
}

const ComplaintDetailModal: React.FC<ComplaintDetailModalProps> = ({ isOpen, onClose, complaint, customers, technicians, onUpdate, isSubmitting }) => {
    const [replyText, setReplyText] = useState('');
    const [photo, setPhoto] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [newStatus, setNewStatus] = useState<ComplaintStatus | ''>('');
    const [newAssignedTo, setNewAssignedTo] = useState<string | ''>('');
    const replyFileInputRef = React.useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (complaint) {
            setNewStatus(complaint.status);
            setNewAssignedTo(complaint.assignedTo || '');
            setReplyText('');
            setPhoto(null);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
        }
    }, [complaint]);

    if (!isOpen || !complaint) return null;

    const customer = customers.find(c => c.id === complaint.customerId);

    const handleSendReply = async () => {
        if (replyText.trim() || photo) {
            await onUpdate(complaint.id, { replyText, photo });
            setReplyText('');
            setPhoto(null);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
            if(replyFileInputRef.current) replyFileInputRef.current.value = '';
        }
    };
    
    const handleSaveChanges = () => {
        const updates: { status?: ComplaintStatus; assignedTo?: string } = {};
        if (newStatus && newStatus !== complaint.status) updates.status = newStatus;
        if (newAssignedTo !== (complaint.assignedTo || '')) updates.assignedTo = newAssignedTo;
        if (Object.keys(updates).length > 0) onUpdate(complaint.id, updates);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        setPhoto(file);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(file ? URL.createObjectURL(file) : null);
    };
    
    const conversation = [
        {
            id: complaint.id,
            senderType: 'customer' as const,
            senderName: complaint.customerName,
            replyText: complaint.description,
            photos: complaint.photos || [],
            createdAt: complaint.dateSubmitted,
        },
        ...(complaint.replies || [])
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-0 z-30 w-full max-w-3xl max-h-[90vh] flex flex-col">
                    <header className="px-6 py-4 border-b dark:border-gray-700 flex justify-between items-start">
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Complaint Details</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Ticket #{complaint.id.split('-')[1]} &bull; {complaint.type}</p>
                        </div>
                         <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 -mt-1 -mr-2">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </header>
                    
                    <div className="p-6 flex-grow overflow-y-auto">
                        <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-md mb-4">
                             <h3 className="font-semibold text-gray-700 dark:text-gray-300">Customer Info</h3>
                             <div className="text-sm grid grid-cols-2 gap-2 mt-2">
                                <p><strong className="text-gray-500">Name:</strong> {customer?.name}</p>
                                <p><strong className="text-gray-500">ID:</strong> {customer?.id}</p>
                                <p><strong className="text-gray-500">Phone:</strong> {customer?.phone}</p>
                                <p><strong className="text-gray-500">Address:</strong> {customer?.address}</p>
                             </div>
                        </div>

                        {complaint.technicianNotes && (
                            <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-md mb-4">
                                <h3 className="font-semibold text-gray-700 dark:text-gray-300">Technician Report</h3>
                                <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap mt-1">{complaint.technicianNotes}</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            {conversation.map((msg, index) => {
                                const isUser = msg.senderType === 'customer';
                                return (
                                <div key={`${msg.id}-${index}`} className={`flex items-end gap-2 ${isUser ? 'justify-start' : 'justify-end'}`}>
                                    <div className={`p-3 rounded-2xl max-w-[80%] ${!isUser ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-200 dark:bg-gray-700 rounded-bl-none'}`}>
                                        {msg.photos && msg.photos.length > 0 && (
                                            <div className="mb-2 grid grid-cols-2 gap-2">
                                                {msg.photos.map((photoUrl: string, pIndex: number) => (
                                                    <a key={pIndex} href={photoUrl} target="_blank" rel="noopener noreferrer">
                                                        <img src={photoUrl} alt={`Complaint photo ${pIndex + 1}`} className="rounded-lg object-cover w-full h-auto max-h-48 border dark:border-gray-600" />
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                        {msg.replyText && <p className={`text-sm ${!isUser ? 'text-white' : 'text-gray-800 dark:text-gray-200'}`}>{msg.replyText}</p>}
                                        <p className={`text-xs mt-1 text-right ${!isUser ? 'text-blue-200' : 'text-gray-500'}`}>{msg.senderName} &bull; {formatTimeDisplay(msg.createdAt)}</p>
                                    </div>
                                </div>
                                )
                            })}
                        </div>
                    </div>
                    
                    {complaint.status !== 'Resolved' && (
                    <footer className="p-6 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <div className="space-y-4">
                            {previewUrl && (
                                <div className="relative w-24 h-24">
                                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover rounded-md border dark:border-gray-600"/>
                                    <button onClick={() => { setPhoto(null); setPreviewUrl(null); if(replyFileInputRef.current) replyFileInputRef.current.value = ''; }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                                    </button>
                                </div>
                            )}
                            <div className="flex items-start gap-2">
                                <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Type your reply to the customer..." rows={3} className="flex-1 p-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" />
                                <input type="file" accept="image/*" className="hidden" ref={replyFileInputRef} onChange={handleFileChange} />
                                <button type="button" onClick={() => replyFileInputRef.current?.click()} className="p-2 bg-gray-200 dark:bg-gray-600 rounded-md h-full flex items-center justify-center" title="Attach Photo">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg>
                                </button>
                                <button onClick={handleSendReply} disabled={isSubmitting || (!replyText.trim() && !photo)} className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400 h-full">Send</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start pt-4 border-t dark:border-gray-600">
                                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as ComplaintStatus)} className="w-full p-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600">
                                    {Object.values(ComplaintStatus).map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <select value={newAssignedTo} onChange={(e) => setNewAssignedTo(e.target.value)} className="w-full p-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600">
                                    <option value="">Unassigned</option>
                                    {technicians.map(t => <option key={t.id} value={t.id}>{t.username}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="flex justify-end mt-4">
                             <button onClick={handleSaveChanges} disabled={isSubmitting} className="px-4 py-2 bg-green-600 text-white rounded disabled:bg-green-400">
                                {isSubmitting ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </footer>
                    )}
                </div>
            </div>
        </div>
    );
};


// --- Main Component ---
const Complaints: React.FC<{ user: AdminUser }> = ({ user }) => {
    const [complaints, setComplaints] = useState<Complaint[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [technicians, setTechnicians] = useState<AdminUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | ComplaintStatus>('all');
    const [viewingComplaint, setViewingComplaint] = useState<Complaint | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedComplaints, setSelectedComplaints] = useState<string[]>([]);
    const [deletingMode, setDeletingMode] = useState<'bulk' | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [complaintsRes, customersRes, usersRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/customers/complaints`),
                fetchWithAuth(`${API_URL}/customers`),
                fetchWithAuth(`${API_URL}/admin/users`),
            ]);
            setComplaints(await complaintsRes.json());
            setCustomers(await customersRes.json());
            const allUsers: AdminUser[] = await usersRes.json();
            setTechnicians(allUsers.filter(u => u.role === 'technician'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleUpdateComplaint = async (id: string, updates: { status?: ComplaintStatus; assignedTo?: string; replyText?: string, photo?: File | null }) => {
        setIsSubmitting(true);
        setError(null);
        let newReply: ComplaintReply | null = null;
    
        try {
            // --- Handle Reply Submission ---
            if (typeof updates.replyText !== 'undefined' || updates.photo) {
                const formData = new FormData();
                formData.append('replyText', updates.replyText || '');
                formData.append('repliedBy', user.username);
                if (updates.photo) {
                    formData.append('photo', updates.photo);
                }
    
                const res = await fetchWithAuth(`${API_URL}/customers/complaints/${id}/reply`, {
                    method: 'POST',
                    body: formData,
                });
                newReply = await res.json();
            }
    
            // --- Handle Status/Assignment Submission ---
            const updatePayload: { status?: ComplaintStatus; assignedTo?: string } = {};
            if (updates.status) updatePayload.status = updates.status;
            if (typeof updates.assignedTo !== 'undefined') updatePayload.assignedTo = updates.assignedTo;
    
            if (Object.keys(updatePayload).length > 0) {
                await fetchWithAuth(`${API_URL}/customers/complaints/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(updatePayload),
                });
            }
    
            // --- Local State Update for Instant UI Feedback ---
            const updateFunction = (c: Complaint): Complaint => {
                if (c.id === id) {
                    const updatedReplies = newReply ? [...(c.replies || []), newReply] : c.replies;
                    return {
                        ...c,
                        status: updates.status || c.status,
                        assignedTo: typeof updates.assignedTo !== 'undefined' ? updates.assignedTo : c.assignedTo,
                        replies: updatedReplies,
                    };
                }
                return c;
            };
    
            setComplaints(prevComplaints => prevComplaints.map(updateFunction));
    
            setViewingComplaint(prevViewing => {
                if (prevViewing && prevViewing.id === id) {
                    return updateFunction(prevViewing);
                }
                return prevViewing;
            });
    
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const confirmDelete = async () => {
        if (deletingMode !== 'bulk' || selectedComplaints.length === 0) return;

        setIsDeleting(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/customers/complaints/bulk-delete`, {
                method: 'POST',
                body: JSON.stringify({ ids: selectedComplaints }),
            });
            if (!res.ok) throw new Error((await res.json()).message);

            setSelectedComplaints([]);
            await fetchData();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsDeleting(false);
            setDeletingMode(null);
        }
    };


    const filteredComplaints = useMemo(() => {
        if (filter === 'all') return complaints;
        return complaints.filter(c => c.status === filter);
    }, [complaints, filter]);

    const techniciansMap = useMemo(() => {
        return technicians.reduce((acc, tech) => {
            acc[tech.id] = tech.username;
            return acc;
        }, {} as Record<string, string>);
    }, [technicians]);

    const handleSelectOne = (complaintId: string, isSelected: boolean) => {
        setSelectedComplaints(prev => isSelected ? [...prev, complaintId] : prev.filter(id => id !== complaintId));
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedComplaints(e.target.checked ? filteredComplaints.map(c => c.id) : []);
    };


    if (isLoading) return <p>Loading complaints...</p>;

    return (
        <div className="space-y-6">
            <ComplaintDetailModal
                isOpen={!!viewingComplaint}
                onClose={() => setViewingComplaint(null)}
                complaint={viewingComplaint}
                customers={customers}
                technicians={technicians}
                onUpdate={handleUpdateComplaint}
                isSubmitting={isSubmitting}
            />
            <DeleteConfirmationModal
                isOpen={deletingMode === 'bulk'}
                onClose={() => setDeletingMode(null)}
                onConfirm={confirmDelete}
                itemName={`${selectedComplaints.length} complaint(s)`}
                itemType="complaint"
                isLoading={isDeleting}
            />
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Customer Complaints</h2>
            {error && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
            
            <Card>
                 <div className="p-4 border-b dark:border-gray-700 space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 text-sm font-medium rounded-md ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}>All</button>
                        {Object.values(ComplaintStatus).map(status => (
                            <button key={status} onClick={() => setFilter(status)} className={`px-3 py-1.5 text-sm font-medium rounded-md ${filter === status ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}>{status}</button>
                        ))}
                    </div>
                    {selectedComplaints.length > 0 && (
                        <div className="flex items-center justify-start gap-4 bg-gray-100 dark:bg-gray-700 p-3 rounded-md">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                                {selectedComplaints.length} selected
                            </span>
                            <button onClick={() => setDeletingMode('bulk')} disabled={isDeleting} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors shadow-sm disabled:bg-red-400">
                                <TrashIcon /> <span>Delete Selected</span>
                            </button>
                            <button onClick={() => setSelectedComplaints([])} className="ml-auto p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full" aria-label="Clear selection">
                                <CloseIcon />
                            </button>
                        </div>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th className="p-4">
                                     <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                        onChange={handleSelectAll}
                                        checked={filteredComplaints.length > 0 && selectedComplaints.length === filteredComplaints.length}
                                        aria-label="Select all complaints"
                                    />
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Ticket ID</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Customer</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Submitted</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Assigned To</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredComplaints.map(c => (
                                <tr key={c.id} className={selectedComplaints.includes(c.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}>
                                    <td className="p-4">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                            checked={selectedComplaints.includes(c.id)}
                                            onChange={(e) => handleSelectOne(c.id, e.target.checked)}
                                            aria-label={`Select complaint ${c.id}`}
                                        />
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{c.id}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{c.customerName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{c.type}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(c.dateSubmitted)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap"><ComplaintStatusTag status={c.status} /></td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{c.assignedTo ? techniciansMap[c.assignedTo] || 'N/A' : 'Unassigned'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button onClick={() => setViewingComplaint(c)} className="text-blue-600 dark:text-blue-400 hover:underline">
                                            View / Reply
                                        </button>
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

export default Complaints;