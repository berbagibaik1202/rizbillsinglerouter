import React, { useState, useRef } from 'react';
import { Complaint, ComplaintStatus, formatDateTimeDisplay, formatTimeDisplay } from '../../types';
import Card from '../../components/common/Card';
import { ComplaintStatusTag } from './shared/ComplaintStatusTag';

interface CustomerHelpProps {
    complaints: Complaint[];
    onOpenComplaintModal: () => void;
    onRefresh: () => Promise<void>;
    isRefreshing: boolean;
    onSendReply: (complaintId: string, replyText: string, photo?: File | null) => Promise<{ success: boolean; message?: string }>;
}

const CustomerHelp: React.FC<CustomerHelpProps> = ({ complaints, onOpenComplaintModal, onRefresh, isRefreshing, onSendReply }) => {
    const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
    const [replyPhotos, setReplyPhotos] = useState<Record<string, { file: File | null, previewUrl: string | null }>>({});
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const [isReplying, setIsReplying] = useState<string | null>(null);
    const [expandedComplaints, setExpandedComplaints] = useState<Set<string>>(new Set());

    const toggleExpansion = (id: string) => {
        setExpandedComplaints(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

     const handleFileChange = (complaintId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        
        if (replyPhotos[complaintId]?.previewUrl) {
            URL.revokeObjectURL(replyPhotos[complaintId].previewUrl!);
        }
        
        setReplyPhotos(prev => ({
            ...prev,
            [complaintId]: {
                file,
                previewUrl: file ? URL.createObjectURL(file) : null
            }
        }));
    };

    const handleReply = async (complaintId: string) => {
        const replyText = replyInputs[complaintId] || '';
        const photoFile = replyPhotos[complaintId]?.file;
        if (!replyText.trim() && !photoFile) return;

        setIsReplying(complaintId);
        const result = await onSendReply(complaintId, replyText, photoFile);
        if (result.success) {
            setReplyInputs(prev => ({ ...prev, [complaintId]: '' }));
            const currentPhoto = replyPhotos[complaintId];
            if (currentPhoto?.previewUrl) URL.revokeObjectURL(currentPhoto.previewUrl);
            setReplyPhotos(prev => ({ ...prev, [complaintId]: { file: null, previewUrl: null } }));
        } else {
            alert(`Error: ${result.message}`);
        }
        setIsReplying(null);
    };

    return (
        <div className="py-6 space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Help & Support</h2>
            
            <Card>
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">My Complaints</h3>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-wait"
                                aria-label="Refresh complaints"
                            >
                                {isRefreshing ? (
                                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566z" clipRule="evenodd" /></svg>
                                )}
                            </button>
                            <button
                                onClick={onOpenComplaintModal}
                                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-semibold shadow-sm"
                            >
                                New Complaint
                            </button>
                        </div>
                    </div>

                    {complaints.length > 0 ? (
                        <div className="space-y-4">
                            {complaints.map(c => {
                                const isResolved = c.status === ComplaintStatus.Resolved;
                                const isExpanded = !isResolved || expandedComplaints.has(c.id);

                                const conversation = [
                                    {
                                        id: c.id,
                                        senderType: 'customer' as const,
                                        senderName: c.customerName,
                                        replyText: c.description,
                                        createdAt: c.dateSubmitted,
                                        photos: c.photos,
                                    },
                                    ...(c.replies || [])
                                ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

                                return (
                                <Card key={c.id} className="!p-0 bg-gray-50 dark:bg-gray-800/50">
                                    <div className="p-4 border-b dark:border-gray-700 flex justify-between items-start">
                                        <div>
                                            <p className="font-semibold text-gray-800 dark:text-gray-200">{c.type}</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">#{c.id.split('-')[1]} &bull; {formatDateTimeDisplay(c.dateSubmitted)}</p>
                                        </div>
                                        <ComplaintStatusTag status={c.status} />
                                    </div>
                                    
                                    {isExpanded && (
                                        <>
                                            <div className="p-4 space-y-3">
                                                {conversation.map((msg: any, index) => {
                                                    const isUser = msg.senderType === 'customer';
                                                    return (
                                                    <div key={index} className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                                        <div className={`p-3 rounded-2xl max-w-[80%] ${isUser ? 'bg-blue-600 rounded-br-none text-white' : 'bg-gray-200 dark:bg-gray-700 rounded-bl-none'}`}>
                                                            {msg.photos && msg.photos.length > 0 && (
                                                                <div className="mb-2 grid grid-cols-2 gap-2">
                                                                    {msg.photos.map((photoUrl: string, pIndex: number) => (
                                                                        <a key={pIndex} href={photoUrl} target="_blank" rel="noopener noreferrer">
                                                                            <img src={photoUrl} alt={`Complaint photo ${pIndex + 1}`} className="rounded-lg object-cover w-full h-24" />
                                                                        </a>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {msg.replyText && <p className={`text-sm ${isUser ? 'text-white' : 'text-gray-800 dark:text-gray-200'}`}>{msg.replyText}</p>}
                                                            <p className={`text-xs mt-1 text-right ${isUser ? 'text-blue-200' : 'text-gray-500'}`}>{msg.senderName} &bull; {formatTimeDisplay(msg.createdAt)}</p>
                                                        </div>
                                                    </div>
                                                    )
                                                })}
                                            </div>
                                            {c.status !== ComplaintStatus.Resolved && (
                                                <div className="p-4 border-t dark:border-gray-700">
                                                    {replyPhotos[c.id]?.previewUrl && (
                                                        <div className="relative w-24 h-24 mb-2">
                                                            <img src={replyPhotos[c.id]?.previewUrl || ''} alt="Preview" className="w-full h-full object-cover rounded-md border dark:border-gray-600"/>
                                                            <button onClick={() => {
                                                                if(replyPhotos[c.id]?.previewUrl) URL.revokeObjectURL(replyPhotos[c.id]!.previewUrl!);
                                                                setReplyPhotos(prev => ({...prev, [c.id]: {file: null, previewUrl: null}}))
                                                            }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5">
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                                                            </button>
                                                        </div>
                                                    )}
                                                    <div className="flex items-start gap-2">
                                                        <textarea
                                                            value={replyInputs[c.id] || ''}
                                                            onChange={(e) => setReplyInputs(prev => ({...prev, [c.id]: e.target.value}))}
                                                            placeholder="Type your reply..."
                                                            rows={2}
                                                            className="flex-1 p-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                                                            disabled={isReplying === c.id}
                                                        />
                                                        <input type="file" ref={(el) => { fileInputRefs.current[c.id] = el; }} onChange={e => handleFileChange(c.id, e)} className="hidden" accept="image/*" />
                                                        <button type="button" onClick={() => fileInputRefs.current[c.id]?.click()} className="p-2 bg-gray-200 dark:bg-gray-600 rounded-md h-full flex items-center justify-center" title="Attach Photo" disabled={isReplying === c.id}>
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" transform="rotate(90 10 10)" /></svg>
                                                        </button>
                                                        <button 
                                                            onClick={() => handleReply(c.id)}
                                                            disabled={isReplying === c.id || (!(replyInputs[c.id] || '').trim() && !replyPhotos[c.id]?.file)}
                                                            className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-blue-400 h-full"
                                                        >
                                                            {isReplying === c.id ? '...' : 'Send'}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {isResolved && (
                                        <div className="p-2 text-center border-t dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
                                            <button onClick={() => toggleExpansion(c.id)} className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                                                {isExpanded ? 'Collapse Conversation' : 'Show Conversation'}
                                            </button>
                                        </div>
                                    )}
                                </Card>
                            )})}
                        </div>
                    ) : (
                        <p className="text-sm text-center text-gray-500 dark:text-gray-400 py-8">
                            You have no complaints on record.
                        </p>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default CustomerHelp;