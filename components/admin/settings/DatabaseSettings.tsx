import React, { useEffect, useRef, useState } from 'react';
import Card from '../../common/Card';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api/admin';
const DEFAULT_BACKUP_EXTENSION = '.riz';

type RestoreJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

type RestoreJob = {
    id: string;
    status: RestoreJobStatus;
    processed_count: number;
    progress_percent: number;
    message: string | null;
    error_message: string | null;
    backup_path?: string | null;
    original_filename?: string | null;
    total_statements?: number;
    started_at?: string | null;
    finished_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};

const DatabaseSettings: React.FC = () => {
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [isCanceling, setIsCanceling] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [restoreJob, setRestoreJob] = useState<RestoreJob | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const reloadTimerRef = useRef<number | null>(null);
    const reloadScheduledRef = useRef(false);

    const normalizeRestoreJob = (job: any): RestoreJob => ({
        ...job,
        processed_count: Number(job?.processed_count || 0),
        progress_percent: Number(job?.progress_percent || 0),
        total_statements: Number(job?.total_statements || 0),
    });

    const fetchRestoreJob = async (jobId?: string) => {
        const url = jobId
            ? `${API_URL}/database/restore/jobs/${encodeURIComponent(jobId)}`
            : `${API_URL}/database/restore/jobs/active`;

        const res = await fetchWithAuth(url);
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.message || 'Failed to fetch database restore job.');
        }

        return data.job ? normalizeRestoreJob(data.job) : null;
    };

    const loadActiveRestoreJob = async () => {
        try {
            const job = await fetchRestoreJob();
            setRestoreJob(job);
            if (!job) {
                reloadScheduledRef.current = false;
            }
        } catch (error: any) {
            setFeedback({ type: 'error', message: error.message });
        }
    };

    const loadRestoreJobById = async (jobId: string) => {
        const job = await fetchRestoreJob(jobId);
        setRestoreJob(job);
        return job;
    };

    const handleCancelRestore = async () => {
        if (!restoreJob || !['queued', 'running'].includes(restoreJob.status)) {
            return;
        }

        if (!window.confirm('Cancel the current database restore job? The job will be stopped and marked as canceled.')) {
            return;
        }

        setIsCanceling(true);
        setFeedback(null);

        try {
            const res = await fetchWithAuth(`${API_URL}/database/restore/jobs/${encodeURIComponent(restoreJob.id)}/cancel`, {
                method: 'POST',
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                throw new Error(data.message || 'Failed to cancel database restore job.');
            }

            if (data.job) {
                setRestoreJob(normalizeRestoreJob(data.job));
            }

            setFeedback({
                type: 'success',
                message: data.message || 'Database restore job canceled.',
            });
        } catch (error: any) {
            setFeedback({ type: 'error', message: error.message });
        } finally {
            setIsCanceling(false);
        }
    };

    useEffect(() => {
        void loadActiveRestoreJob();
    }, []);

    useEffect(() => {
        if (!restoreJob || restoreJob.status !== 'completed' || restoreJob.progress_percent < 100 || reloadScheduledRef.current) {
            return;
        }

        reloadScheduledRef.current = true;
        setFeedback({ type: 'success', message: 'Database restored successfully. Reloading page...' });
        reloadTimerRef.current = window.setTimeout(() => {
            window.location.reload();
        }, 1500);

        return () => {
            if (reloadTimerRef.current) {
                window.clearTimeout(reloadTimerRef.current);
            }
        };
    }, [restoreJob?.status, restoreJob?.progress_percent]);

    useEffect(() => {
        if (!restoreJob || restoreJob.status === 'completed' || restoreJob.status === 'failed' || restoreJob.status === 'canceled') {
            return;
        }

        const interval = window.setInterval(() => {
            void loadRestoreJobById(restoreJob.id).catch((error: any) => {
                setFeedback({ type: 'error', message: error.message });
            });
        }, 3000);

        return () => {
            window.clearInterval(interval);
        };
    }, [restoreJob?.id, restoreJob?.status]);

    useEffect(() => {
        return () => {
            if (reloadTimerRef.current) {
                window.clearTimeout(reloadTimerRef.current);
            }
        };
    }, []);

    const handleBackup = async () => {
        setIsBackingUp(true);
        setFeedback(null);
        try {
            const normalizedExt = DEFAULT_BACKUP_EXTENSION;
            const res = await fetchWithAuth(`${API_URL}/database/backup?ext=${encodeURIComponent(normalizedExt)}`);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to create backup.');
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toLocaleDateString('en-CA');
            a.download = `backup-${date}${normalizedExt}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            setFeedback({ type: 'success', message: 'Backup downloaded successfully!' });
        } catch (error: any) {
            setFeedback({ type: 'error', message: error.message });
        } finally {
            setIsBackingUp(false);
        }
    };

    const handleRestoreClick = () => {
        if (restoreJob && (restoreJob.status === 'queued' || restoreJob.status === 'running')) {
            setFeedback({ type: 'error', message: 'Restore job is already running.' });
            return;
        }

        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!window.confirm('Are you sure you want to restore the database from this file? This action is irreversible and will OVERWRITE ALL existing data.')) {
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }

        setIsRestoring(true);
        setFeedback(null);
        reloadScheduledRef.current = false;

        const formData = new FormData();
        formData.append('backup', file);

        try {
            const res = await fetchWithAuth(`${API_URL}/database/restore`, {
                method: 'POST',
                body: formData,
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok && res.status !== 202 && res.status !== 409) {
                throw new Error(data.message || 'Failed to restore database.');
            }

            if (data.job) {
                setRestoreJob(normalizeRestoreJob(data.job));
            }

            setFeedback({
                type: res.status === 409 ? 'error' : 'success',
                message: data.message || 'Database restore job queued.',
            });
        } catch (error: any) {
            setFeedback({ type: 'error', message: error.message });
        } finally {
            setIsRestoring(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const isRestoreJobActive = Boolean(restoreJob && (restoreJob.status === 'queued' || restoreJob.status === 'running'));
    const restoreProgress = restoreJob ? Math.max(0, Math.min(100, restoreJob.progress_percent || 0)) : 0;
    const restoreStatusClass = restoreJob?.status === 'failed'
        ? 'bg-red-500'
        : restoreJob?.status === 'completed'
            ? 'bg-green-500'
            : restoreJob?.status === 'canceled'
                ? 'bg-yellow-500'
                : 'bg-blue-500';
    const canCancelRestore = Boolean(restoreJob && (restoreJob.status === 'queued' || restoreJob.status === 'running'));

    return (
        <Card title="Database Management">
            <div className="space-y-6">
                {feedback && (
                    <div className={`p-3 rounded-md text-sm ${feedback.type === 'success' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'}`}>
                        {feedback.message}
                    </div>
                )}

                <div className="border p-4 rounded-md dark:border-gray-700 space-y-3">
                    <h3 className="font-semibold text-lg text-gray-800 dark:text-gray-200">Backup</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Download a full backup of the MySQL database. The export is always standard SQL and will be
                        saved with the default <code>.riz</code> extension for consistency.
                    </p>
                    <button
                        onClick={handleBackup}
                        disabled={isBackingUp}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold shadow-sm transition-colors flex items-center disabled:bg-blue-400"
                    >
                        {isBackingUp && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                        {isBackingUp ? 'Backing up...' : 'Download Database Backup'}
                    </button>
                </div>

                <div className="border border-red-400 dark:border-red-600 p-4 rounded-md space-y-3">
                    <h3 className="font-semibold text-lg text-red-700 dark:text-red-400">Restore</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        <strong className="font-bold">Warning:</strong> Restoring from an SQL file will completely overwrite and replace all current data in the database. This action is irreversible and cannot be undone. Proceed with extreme caution.
                    </p>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={handleRestoreClick}
                            disabled={isRestoring || isRestoreJobActive}
                            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-semibold shadow-sm transition-colors flex items-center disabled:bg-red-400"
                        >
                            {isRestoring && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                            {isRestoring ? 'Uploading...' : isRestoreJobActive ? 'Restore Running...' : 'Restore from Backup'}
                        </button>
                        {canCancelRestore && (
                            <button
                                onClick={handleCancelRestore}
                                disabled={isCanceling}
                                className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 font-semibold shadow-sm transition-colors flex items-center disabled:bg-yellow-400"
                            >
                                {isCanceling && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                {isCanceling ? 'Canceling...' : 'Cancel Restore'}
                            </button>
                        )}
                    </div>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="hidden"
                    />

                    {restoreJob && (
                        <div className={`border rounded-md p-4 ${restoreJob.status === 'failed' ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20' : restoreJob.status === 'canceled' ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-900/50 dark:bg-yellow-950/20' : 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20'}`}>
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="font-semibold text-gray-800 dark:text-gray-100">
                                        Database Restore Job ({restoreJob.status})
                                    </p>
                                    <p className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                                        {restoreJob.message || 'Restore job is being processed.'}
                                    </p>
                                    <div className="mt-3">
                                        <div className="flex items-center justify-between text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">
                                            <span>Progress</span>
                                            <span>{restoreProgress}%</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-500 ${restoreStatusClass}`}
                                                style={{ width: `${restoreProgress}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right text-xs text-gray-600 dark:text-gray-400">
                                    <p className="font-mono break-all">{restoreJob.id}</p>
                                    <p className="mt-1">Processed: {restoreJob.processed_count}</p>
                                    {restoreJob.total_statements ? (
                                        <p className="mt-1">Statements: {restoreJob.total_statements}</p>
                                    ) : null}
                                </div>
                            </div>
                            {restoreJob.error_message && (
                                <p className="mt-3 text-sm text-red-700 dark:text-red-300">
                                    {restoreJob.error_message}
                                </p>
                            )}
                            {restoreJob.status === 'canceled' && !restoreJob.error_message && (
                                <p className="mt-3 text-sm text-yellow-700 dark:text-yellow-300">
                                    Restore job was canceled.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
};

export default DatabaseSettings;
