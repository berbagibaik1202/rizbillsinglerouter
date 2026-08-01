import React, { useState, useEffect, useCallback } from 'react';
import { Customer, Complaint, ComplaintStatus, formatDateTimeDisplay, AdminUser, ComplaintType, formatTimeDisplay } from '~/types';
import Card from '~/components/common/Card';
import Tag from '~/components/common/Tag';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

interface TaskDetailData {
    id: string;
    type: 'Installation' | 'Repair';
    status: 'Unregister' | ComplaintStatus | 'Active';
    customer: Customer;
    complaint?: Complaint;
}

interface TaskDetailProps {
    taskId: string;
    onBack: () => void;
    user: AdminUser;
}

const installationChecklist = [
    "Cek sinyal ODP",
    "Tarik kabel ke lokasi pelanggan",
    "Instalasi dan aktivasi modem (ONT)",
    "Konfigurasi nama dan password WiFi",
    "Tes kecepatan koneksi",
    "Edukasi pelanggan mengenai penggunaan"
];

const repairChecklists: Record<string, string[]> = {
  [ComplaintType.NoConnection]: [
    "Verifikasi keluhan dengan pelanggan",
    "Cek status modem (ONT)",
    "Periksa redaman (RX Power)",
    "Periksa konektor dan kabel dropcore",
    "Periksa ODP dan splitter",
    "Selesaikan masalah dan lakukan tes kecepatan"
  ],
  [ComplaintType.SlowConnection]: [
    "Verifikasi keluhan dengan pelanggan",
    "Cek status modem (ONT)",
    "Lakukan tes kecepatan awal",
    "Periksa redaman (RX Power)",
    "Periksa perangkat pelanggan (virus/aplikasi berat)",
    "Selesaikan masalah dan lakukan tes kecepatan akhir"
  ],
};


const TaskDetail: React.FC<TaskDetailProps> = ({ taskId, onBack, user }) => {
    const [task, setTask] = useState<TaskDetailData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [photo, setPhoto] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [checklist, setChecklist] = useState<Record<string, boolean>>({});
    const [currentChecklistItems, setCurrentChecklistItems] = useState<string[]>([]);

    const fetchTask = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/technician/tasks/${taskId}`);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to fetch task details.');
            }
            const data: TaskDetailData = await res.json();
            setTask(data);
            setNote('');

        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [taskId]);

    useEffect(() => {
        fetchTask();
    }, [fetchTask]);
    
    useEffect(() => {
        if (task) {
            let items: string[] = [];
            if (task.type === 'Installation') {
                items = installationChecklist;
            } else if (task.type === 'Repair' && task.complaint) {
                items = repairChecklists[task.complaint.type] || [];
            }
            setCurrentChecklistItems(items);

            const initialChecklistState = items.reduce((acc, item) => {
                acc[item] = false;
                return acc;
            }, {} as Record<string, boolean>);
            setChecklist(initialChecklistState);
        }
    }, [task]);

    const handleStatusChange = async (newStatus: ComplaintStatus | 'Active') => {
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/technician/tasks/${taskId}/status`, {
                method: 'POST',
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) throw new Error((await res.json()).message);
            await fetchTask(); 
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleSubmitNoteAndPhoto = async () => {
        if (!note.trim() && !photo) return;
        if (!task) return;
    
        setIsSubmitting(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('replyText', note);
            formData.append('repliedBy', user.username);
            if (photo) {
                formData.append('photo', photo);
            }
    
            const res = await fetchWithAuth(`${API_URL}/customers/complaints/${task.id}/reply`, {
                method: 'POST',
                body: formData,
            });
            
            if (!res.ok) throw new Error((await res.json()).message);
            const newReply = await res.json();
    
            setNote('');
            setPhoto(null);
            
            setTask(prevTask => {
                if (!prevTask || !prevTask.complaint) return prevTask;
                return {
                    ...prevTask,
                    complaint: {
                        ...prevTask.complaint,
                        replies: [...(prevTask.complaint.replies || []), newReply]
                    }
                };
            });
    
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleChecklistChange = (item: string) => {
        setChecklist(prev => ({ ...prev, [item]: !prev[item] }));
    };

    const allChecked = currentChecklistItems.length > 0 && currentChecklistItems.every(item => checklist[item]);
    const noChecklistRequired = currentChecklistItems.length === 0;

    if (isLoading) return <div className="text-center p-10">Loading task...</div>;
    if (error) return <div className="p-4 bg-red-100 text-red-700">{error}</div>;
    if (!task) return <div className="text-center p-10">Tidak ada Tugas, Semua tugas telah selesai.</div>;
    
    const isInstallation = task.type === 'Installation';
    const canStart = (isInstallation && task.status === 'Unregister') || (!isInstallation && task.status === ComplaintStatus.Pending);
    const isInProgress = task.status === ComplaintStatus.InProgress;
    const isCompleted = (isInstallation && task.status === 'Active') || (!isInstallation && task.status === ComplaintStatus.Resolved);

    const normalizePhotos = (photos: unknown): string[] => {
        if (!photos) return [];
        if (Array.isArray(photos)) return photos.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
        if (typeof photos === 'string') {
            try {
                const parsed = JSON.parse(photos);
                if (Array.isArray(parsed)) {
                    return parsed.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
                }
            } catch {
                // ignore JSON parse errors and fall back to treating it as a single URL
            }
            return photos.trim() ? [photos] : [];
        }
        return [];
    };
    
    const conversation = task.complaint ? [
        {
            id: task.complaint.id,
            senderType: 'customer' as const,
            senderName: task.complaint.customerName,
            replyText: task.complaint.description,
            photos: normalizePhotos(task.complaint.photos),
            createdAt: task.complaint.dateSubmitted,
        },
        ...(task.complaint.replies || []).map(reply => ({
            ...reply,
            photos: normalizePhotos(reply.photos),
        }))
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) : [];


    return (
        <div className="space-y-4">
            <button onClick={onBack} className="flex items-center text-blue-600 dark:text-blue-400 font-semibold hover:underline">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                Back to Task List
            </button>

            <Card>
                <h2 className="text-xl font-bold">{task.customer.name}</h2>
                <p className="text-gray-500">{task.customer.address}</p>
                <a href={`tel:${task.customer.phone}`} className="text-blue-500 block my-2">{task.customer.phone}</a>
                {task.customer.location && (
                    <a href={`https://www.google.com/maps?q=${task.customer.location.lat},${task.customer.location.lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md font-semibold text-sm">
                        Navigate
                    </a>
                )}
            </Card>

            <Card title="Task Details">
                {isInstallation ? (
                    <p>New customer installation. Please configure device and ensure connectivity.</p>
                ) : task.complaint && (
                    <div className="space-y-2">
                        <p><strong>Type:</strong> {task.complaint.type}</p>
                        <p><strong>Description:</strong> {task.complaint.description}</p>
                        <p className="text-xs text-gray-500">Submitted: {formatDateTimeDisplay(task.complaint.dateSubmitted)}</p>
                    </div>
                )}
            </Card>
            
            {task.type === 'Repair' && conversation.length > 0 && (
                 <Card title="Conversation History">
                     <div className="space-y-4 max-h-96 overflow-y-auto p-1">
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
                </Card>
            )}

            {currentChecklistItems.length > 0 && (
                <Card title="Task Checklist">
                    <div className="space-y-3">
                        {currentChecklistItems.map(item => (
                            <div key={item} className="flex items-center">
                                <input
                                    id={item}
                                    type="checkbox"
                                    checked={checklist[item] || false}
                                    onChange={() => handleChecklistChange(item)}
                                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    disabled={isCompleted}
                                />
                                <label htmlFor={item} className={`ml-3 block text-sm font-medium text-gray-700 dark:text-gray-300 ${checklist[item] ? 'line-through text-gray-500' : ''}`}>
                                    {item}
                                </label>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <Card title="Work Status & Actions">
                <div className="flex items-center justify-between">
                    <p>Current Status:</p>
                    <Tag color={canStart ? 'blue' : (isInProgress ? 'yellow' : 'green')}>{task.status}</Tag>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                    {canStart && (
                        <button onClick={() => handleStatusChange(ComplaintStatus.InProgress)} disabled={isSubmitting} className="w-full bg-yellow-500 text-white px-4 py-2 rounded-md font-semibold disabled:bg-yellow-300">Start Work</button>
                    )}
                     {isInProgress && (
                        <>
                        <button onClick={() => handleStatusChange(isInstallation ? 'Active' : ComplaintStatus.Resolved)} disabled={isSubmitting || (!allChecked && !noChecklistRequired)} className="w-full bg-green-600 text-white px-4 py-2 rounded-md font-semibold disabled:bg-green-300 disabled:cursor-not-allowed">Complete Task</button>
                        {!allChecked && !noChecklistRequired && <p className="text-xs text-center text-gray-500 dark:text-gray-400">Please complete all checklist items before finishing the task.</p>}
                        </>
                    )}
                </div>
                 {isCompleted && <p className="text-center mt-4 text-green-600 font-semibold">Task Completed!</p>}
            </Card>

            <Card title="Notes & Photos">
                <div className="space-y-4">
                    <div>
                        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician Notes</label>
                        <textarea id="notes" value={note} onChange={e => setNote(e.target.value)} rows={4} className="mt-1 w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 dark:border-gray-600"></textarea>
                    </div>
                     <div>
                        <label htmlFor="photo" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Upload Photo</label>
                        <input type="file" id="photo" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files ? e.target.files[0] : null)} className="mt-1 w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                    </div>
                    
                    <div className="mt-4">
                        <button onClick={handleSubmitNoteAndPhoto} disabled={isSubmitting || task.type !== 'Repair'} className="w-full bg-blue-600 text-white px-4 py-2 rounded-md font-semibold disabled:bg-blue-300">
                            {isSubmitting ? 'Saving...' : 'Save Notes & Photo'}
                        </button>
                         {task.type !== 'Repair' && <p className="text-xs text-center mt-2 text-gray-500 dark:text-gray-400">Notes and photos can only be added to Repair tasks.</p>}
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default TaskDetail;
