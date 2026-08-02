import React, { useEffect, useRef, useState } from 'react';
import Card from '../../common/Card';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api/admin/app-update';
const UPDATE_RELOAD_ACK_KEY = 'rizkitechbill_app_update_reload_ack';

type UpdateJobStatus = 'queued' | 'running' | 'completed' | 'failed';

type UpdateLogEntry = {
    at: string;
    stream: 'system' | 'stdout' | 'stderr';
    message: string;
};

type AppBuildInfo = {
    app_version?: string | null;
    built_at?: string | null;
    git_commit?: string | null;
    git_branch?: string | null;
    source_file?: string | null;
};

type UpdateJob = {
    id: string;
    status: UpdateJobStatus;
    progress_percent: number;
    current_step: string;
    message: string | null;
    error_message: string | null;
    logs?: UpdateLogEntry[];
    started_at?: string | null;
    finished_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};

type UpdateStatusResponse = {
    success?: boolean;
    message?: string;
    service_available?: boolean;
    job?: UpdateJob | null;
    build?: AppBuildInfo | null;
};

type UpdateCheckResponse = UpdateStatusResponse & {
    update_available?: boolean;
    current?: AppBuildInfo | null;
    latest?: AppBuildInfo | null;
    current_head?: string | null;
    latest_head?: string | null;
    ahead_by?: number | null;
    behind_by?: number | null;
    changelog?: string[];
};

const formatValue = (value?: string | null, fallback = 'Unknown') => {
    const text = String(value || '').trim();
    return text || fallback;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const isTransientFetchError = (error: any) => {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('fetch failed')
        || message.includes('networkerror')
        || message.includes('failed to fetch')
        || message.includes('the operation was aborted')
        || message.includes('aborted');
};

const AppUpdateSettings: React.FC = () => {
    const [isStarting, setIsStarting] = useState(false);
    const [isLoadingStatus, setIsLoadingStatus] = useState(true);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
    const [updateJob, setUpdateJob] = useState<UpdateJob | null>(null);
    const [buildInfo, setBuildInfo] = useState<AppBuildInfo | null>(null);
    const [checkResult, setCheckResult] = useState<UpdateCheckResponse | null>(null);
    const reloadTimerRef = useRef<number | null>(null);
    const reloadScheduledRef = useRef(false);

    const normalizeUpdateJob = (job: any): UpdateJob => ({
        ...job,
        progress_percent: Number(job?.progress_percent || 0),
        logs: Array.isArray(job?.logs) ? job.logs : [],
    });

    const getAcknowledgedJobId = () => {
        try {
            return window.localStorage.getItem(UPDATE_RELOAD_ACK_KEY);
        } catch {
            return null;
        }
    };

    const setAcknowledgedJobId = (jobId: string) => {
        try {
            window.localStorage.setItem(UPDATE_RELOAD_ACK_KEY, jobId);
        } catch {
            // ignore storage write failures
        }
    };

    const loadUpdateStatus = async (options: { retry?: boolean } = {}) => {
        const attempts = options.retry === false ? 1 : 3;
        let lastError: any = null;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const res = await fetchWithAuth(`${API_URL}/status`);
                const data: UpdateStatusResponse = await res.json().catch(() => ({} as UpdateStatusResponse));
                if (!res.ok) {
                    throw new Error(data.message || 'Failed to fetch application update status.');
                }
                const nextJob = data.job ? normalizeUpdateJob(data.job) : null;
                if (nextJob && nextJob.status === 'completed' && getAcknowledgedJobId() === nextJob.id) {
                    setUpdateJob(null);
                } else {
                    setUpdateJob(nextJob);
                }
                setBuildInfo(data.build || null);
                if (data.service_available === false) {
                    setFeedback({
                        type: 'warning',
                        message: data.message || 'App update service is not available. Showing local build info only.',
                    });
                } else {
                    setFeedback(null);
                }
                return;
            } catch (error: any) {
                lastError = error;
                if (attempt < attempts && isTransientFetchError(error)) {
                    await sleep(1000 * attempt);
                    continue;
                }
                if (isTransientFetchError(error)) {
                    setFeedback({
                        type: 'warning',
                        message: 'App update service is still restarting. Current build info is shown below.',
                    });
                    return;
                }
                setFeedback({
                    type: 'warning',
                    message: error.message || 'Failed to fetch application update status. Showing local build info only.',
                });
                return;
            }
        }

        if (lastError) {
            setFeedback({
                type: 'warning',
                message: lastError.message || 'Failed to fetch application update status. Showing local build info only.',
            });
        }
    };

    const handleCheckUpdate = async () => {
        setIsCheckingUpdate(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/check`);
            const data: UpdateCheckResponse = await res.json().catch(() => ({} as UpdateCheckResponse));

            if (!res.ok && !data.service_available) {
                throw new Error(data.message || 'Failed to check application updates.');
            }

            setCheckResult(data);
            if (data.build) {
                setBuildInfo(data.build);
            }

            setFeedback({
                type: data.update_available ? 'success' : 'warning',
                message: data.message || (data.update_available ? 'Update tersedia. Silakan tekan tombol update.' : 'Aplikasi sudah berada di versi terbaru.'),
            });
        } catch (error: any) {
            setCheckResult(null);
            setFeedback({
                type: 'error',
                message: error.message || 'Failed to check application updates.',
            });
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    useEffect(() => {
        setIsLoadingStatus(true);
        void loadUpdateStatus().finally(() => {
            setIsLoadingStatus(false);
        });
    }, []);

    useEffect(() => {
        if (!updateJob || updateJob.status !== 'completed' || updateJob.progress_percent < 100 || reloadScheduledRef.current) {
            return;
        }

        if (getAcknowledgedJobId() === updateJob.id) {
            return;
        }

        reloadScheduledRef.current = true;
        setAcknowledgedJobId(updateJob.id);
        setFeedback({ type: 'success', message: 'Application update completed. Reloading page...' });
        reloadTimerRef.current = window.setTimeout(() => {
            window.location.reload();
        }, 3000);

        return () => {
            if (reloadTimerRef.current) {
                window.clearTimeout(reloadTimerRef.current);
            }
        };
    }, [updateJob?.status, updateJob?.progress_percent]);

    useEffect(() => {
        if (!updateJob || updateJob.status === 'completed' || updateJob.status === 'failed') {
            return;
        }

        const interval = window.setInterval(() => {
            void loadUpdateStatus({ retry: false });
        }, 4000);

        return () => {
            window.clearInterval(interval);
        };
    }, [updateJob?.id, updateJob?.status]);

    useEffect(() => {
        return () => {
            if (reloadTimerRef.current) {
                window.clearTimeout(reloadTimerRef.current);
            }
        };
    }, []);

    const handleStartUpdate = async () => {
        if (!window.confirm('Update aplikasi sekarang?')) {
            return;
        }

        setIsStarting(true);
        setFeedback(null);
        reloadScheduledRef.current = false;

        try {
            const res = await fetchWithAuth(API_URL, {
                method: 'POST',
            });
            const data = await res.json().catch(() => ({}));

            if (res.status === 409) {
                if (data.job) {
                    setUpdateJob(normalizeUpdateJob(data.job));
                }
                if (data.build) {
                    setBuildInfo(data.build);
                }
                throw new Error(data.message || 'Application update is already running.');
            }

            if (!res.ok && res.status !== 202) {
                throw new Error(data.message || 'Failed to start application update.');
            }

            if (data.job) {
                setUpdateJob(normalizeUpdateJob(data.job));
            }
            if (data.build) {
                setBuildInfo(data.build);
            }

            setFeedback({
                type: 'success',
                message: data.message || 'Application update queued.',
            });
        } catch (error: any) {
            setFeedback({ type: 'error', message: error.message || 'Failed to start application update.' });
        } finally {
            setIsStarting(false);
        }
    };

    const isUpdateActive = Boolean(updateJob && (updateJob.status === 'queued' || updateJob.status === 'running'));
    const updateProgress = updateJob ? Math.max(0, Math.min(100, updateJob.progress_percent || 0)) : 0;
    const updateBarClass = updateJob?.status === 'failed'
        ? 'bg-red-500'
        : updateJob?.status === 'completed'
            ? 'bg-green-500'
            : 'bg-blue-500';
    const updateAvailable = checkResult?.update_available === true;
    const canStartUpdate = updateAvailable && !isStarting && !isUpdateActive && !isLoadingStatus && !isCheckingUpdate;

    return (
        <Card title="Application Update">
            <div className="space-y-6">
                {feedback && (
                    <div className={`p-3 rounded-md text-sm ${feedback.type === 'success' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' : feedback.type === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'}`}>
                        {feedback.message}
                    </div>
                )}

                <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Versi aplikasi</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{formatValue(buildInfo?.app_version)}</p>
                    </div>
                    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Git commit</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100 break-all">{formatValue(buildInfo?.git_commit)}</p>
                    </div>
                    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Build time</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {buildInfo?.built_at ? new Date(buildInfo.built_at).toLocaleString() : 'Unknown'}
                        </p>
                    </div>
                </div>

                <div className="border border-blue-200 dark:border-blue-900/50 p-4 rounded-md bg-blue-50/60 dark:bg-blue-950/10 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                            onClick={handleCheckUpdate}
                            disabled={isCheckingUpdate || isLoadingStatus || isUpdateActive || isStarting}
                            className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-800 font-semibold shadow-sm transition-colors flex items-center disabled:bg-gray-400"
                        >
                            {isCheckingUpdate && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                            {isCheckingUpdate ? 'Checking...' : 'Cek Update'}
                        </button>
                        <button
                            onClick={handleStartUpdate}
                            disabled={!canStartUpdate}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold shadow-sm transition-colors flex items-center disabled:bg-blue-400"
                        >
                            {isStarting && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                            {isStarting ? 'Starting update...' : isUpdateActive ? 'Update Running...' : updateAvailable ? 'Update Application' : 'Check for Update First'}
                        </button>
                    </div>
                    {!updateAvailable && checkResult && (
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                            Tombol update akan aktif setelah cek menemukan pembaruan.
                        </p>
                    )}
                </div>

                {checkResult && (
                    <div className={`border rounded-md p-4 ${checkResult.update_available ? 'border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30'}`}>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                                <p className="font-semibold text-gray-800 dark:text-gray-100">
                                    {checkResult.update_available ? 'Update tersedia' : 'Tidak ada update'}
                                </p>
                                <p className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                                    {checkResult.message || 'Hasil cek update ditampilkan di bawah.'}
                                </p>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 p-3">
                                        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Versi saat ini</p>
                                        <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{formatValue(checkResult.current?.app_version || buildInfo?.app_version)}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{formatValue(checkResult.current?.git_commit || buildInfo?.git_commit)}</p>
                                    </div>
                                    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 p-3">
                                        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Versi terbaru</p>
                                        <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{formatValue(checkResult.latest?.app_version, 'Latest build')}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{formatValue(checkResult.latest?.git_commit, 'Unknown')}</p>
                                    </div>
                                </div>
                                {(checkResult.behind_by !== null && checkResult.behind_by !== undefined) && (
                                    <p className="text-xs mt-3 text-gray-600 dark:text-gray-400">
                                        {checkResult.behind_by > 0
                                            ? `${checkResult.behind_by} commit baru belum diambil.`
                                            : 'Tidak ada commit baru di branch remote.'}
                                    </p>
                                )}
                            </div>
                            <div className="text-right text-xs text-gray-600 dark:text-gray-400">
                                {checkResult.current_head && <p className="font-mono break-all">Current: {checkResult.current_head}</p>}
                                {checkResult.latest_head && <p className="font-mono break-all mt-1">Latest: {checkResult.latest_head}</p>}
                                {(checkResult.ahead_by !== null && checkResult.ahead_by !== undefined) && <p className="mt-1">Ahead: {checkResult.ahead_by}</p>}
                                {(checkResult.behind_by !== null && checkResult.behind_by !== undefined) && <p className="mt-1">Behind: {checkResult.behind_by}</p>}
                            </div>
                        </div>
                        {Array.isArray(checkResult.changelog) && checkResult.changelog.length > 0 && (
                            <div className="mt-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-2">Perubahan terbaru</p>
                                <div className="space-y-1 text-xs font-mono text-gray-700 dark:text-gray-300">
                                    {checkResult.changelog.slice(0, 5).map((line, index) => (
                                        <div key={`${line}-${index}`} className="break-all rounded bg-white/70 dark:bg-gray-900/50 px-2 py-1 border border-gray-200 dark:border-gray-700">
                                            {line}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {updateJob && (
                    <div className={`border rounded-md p-4 ${updateJob.status === 'failed' ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20' : updateJob.status === 'completed' ? 'border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20' : 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20'}`}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="font-semibold text-gray-800 dark:text-gray-100">
                                    Update Job ({updateJob.status})
                                </p>
                                <p className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                                    {updateJob.message || 'Application update is being processed.'}
                                </p>
                                <p className="text-xs mt-2 text-gray-600 dark:text-gray-400">
                                    Current step: {updateJob.current_step || 'Unknown'}
                                </p>
                                <div className="mt-3">
                                    <div className="flex items-center justify-between text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">
                                        <span>Progress</span>
                                        <span>{updateProgress}%</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${updateBarClass}`}
                                            style={{ width: `${updateProgress}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="text-right text-xs text-gray-600 dark:text-gray-400">
                                <p className="font-mono break-all">{updateJob.id}</p>
                                {updateJob.started_at && <p className="mt-1">Started: {new Date(updateJob.started_at).toLocaleString()}</p>}
                                {updateJob.finished_at && <p className="mt-1">Finished: {new Date(updateJob.finished_at).toLocaleString()}</p>}
                            </div>
                        </div>

                        {updateJob.error_message && (
                            <p className="mt-3 text-sm text-red-700 dark:text-red-300">
                                {updateJob.error_message}
                            </p>
                        )}

                        {Array.isArray(updateJob.logs) && updateJob.logs.length > 0 && (
                            <div className="mt-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-2">Update Logs</p>
                                <div className="max-h-64 overflow-auto rounded-md bg-white/80 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                                    {updateJob.logs.slice(-10).map((entry, index) => (
                                        <div key={`${entry.at}-${index}`} className="text-xs font-mono">
                                            <span className="text-gray-500 dark:text-gray-400">{new Date(entry.at).toLocaleTimeString()}</span>
                                            <span className={`mx-2 px-1.5 py-0.5 rounded ${entry.stream === 'stderr' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200' : entry.stream === 'stdout' ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-200' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100'}`}>
                                                {entry.stream}
                                            </span>
                                            <span className="text-gray-800 dark:text-gray-100 break-all">{entry.message}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Card>
    );
};

export default AppUpdateSettings;
