import React, { useMemo, useRef, useState } from 'react';
import { ApiSettings } from '../../../types';
import Card from '../../common/Card';
import { fetchWithAuth } from '~/components/api';

interface VideoSettingsProps {
    settings: NonNullable<ApiSettings['video']>;
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
    onUploadPlaylist: (file: File) => Promise<void>;
    onDeletePlaylist: () => Promise<void>;
}

const inputClasses = "mt-1 w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400";

type PreviewItem = {
    title: string;
    groupTitle: string;
    logoUrl: string;
    streamUrl: string;
};

const parsePlaylistPreview = (text: string) => {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const items: PreviewItem[] = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.startsWith('#EXTINF')) continue;

        let streamUrl = '';
        for (let j = i + 1; j < lines.length; j += 1) {
            const candidate = lines[j];
            if (!candidate) continue;
            if (candidate.startsWith('#') && !/^https?:\/\//i.test(candidate)) continue;
            streamUrl = candidate;
            break;
        }
        if (!streamUrl || streamUrl.startsWith('#')) continue;

        const commaIndex = line.lastIndexOf(',');
        const title = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : line.replace(/^#EXTINF:-?\d+\s*/, '').trim();
        const attrsPart = commaIndex >= 0 ? line.slice(0, commaIndex) : line;
        const logoMatch = attrsPart.match(/(?:tvg-logo|group-logo|logo)="([^"]*)"/i);
        const groupMatch = attrsPart.match(/group-title="([^"]*)"/i);

        items.push({
            title: title || 'Unknown Channel',
            groupTitle: groupMatch?.[1] || 'Lainnya',
            logoUrl: logoMatch?.[1] || '',
            streamUrl: streamUrl.trim(),
        });
    }

    return {
        items,
        total: items.length,
        groups: Array.from(new Set(items.map((item) => item.groupTitle))).filter(Boolean),
    };
};

const VideoApiSettings: React.FC<VideoSettingsProps> = ({ settings, handleInputChange, onUploadPlaylist, onDeletePlaylist }) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewText, setPreviewText] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [debugResult, setDebugResult] = useState<{
        ok: boolean;
        message: string;
        status?: number;
        finalUrl?: string;
        contentType?: string;
        preview?: string;
        channelCount?: number;
    } | null>(null);

    const preview = useMemo(() => parsePlaylistPreview(previewText), [previewText]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        setUploadError(null);
        setActionError(null);
        setPreviewError(null);
        setPreviewText('');
        setSelectedFile(null);
        if (!file) return;

        if (!/\.(m3u8?|txt)$/i.test(file.name)) {
            setPreviewError('Format file harus .m3u, .m3u8, atau .txt.');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        try {
            const text = await file.text();
            const parsed = parsePlaylistPreview(text);
            if (parsed.total === 0) {
                setPreviewError('File tidak mengandung data playlist yang valid (#EXTINF).');
                if (fileInputRef.current) fileInputRef.current.value = '';
                return;
            }
            setSelectedFile(file);
            setPreviewText(text);
        } catch (error: any) {
            setPreviewError(error?.message || 'Gagal membaca file playlist.');
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleUploadClick = async () => {
        if (!selectedFile) return;
        setIsUploading(true);
        setUploadError(null);
        setActionError(null);
        try {
            await onUploadPlaylist(selectedFile);
            setSelectedFile(null);
            setPreviewText('');
            setPreviewError(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        } catch (error: any) {
            setUploadError(error?.message || 'Gagal mengupload playlist.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDeleteClick = async () => {
        if (!window.confirm('Hapus file playlist yang sedang aktif?')) return;
        setIsDeleting(true);
        setActionError(null);
        try {
            await onDeletePlaylist();
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        } catch (error: any) {
            setActionError(error?.message || 'Gagal menghapus playlist.');
        } finally {
            setIsDeleting(false);
        }
    };

    const runDebug = async (targetUrl: string) => {
        if (!targetUrl) {
            setActionError('Isi URL playlist terlebih dahulu.');
            return;
        }

        setIsTesting(true);
        setActionError(null);
        setUploadError(null);
        setPreviewError(null);
        setDebugResult(null);

        try {
            const res = await fetchWithAuth(`/api/admin/settings/video-playlist/debug?url=${encodeURIComponent(targetUrl)}`);
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Gagal menjalankan debug playlist.');
            }
            setDebugResult({
                ok: Boolean(data.ok),
                message: data.message || 'Debug selesai.',
                status: data.status,
                finalUrl: data.finalUrl,
                contentType: data.contentType,
                preview: data.preview,
                channelCount: data.channelCount,
            });
        } catch (error: any) {
            setDebugResult({
                ok: false,
                message: error?.message || 'Debug gagal.',
            });
        } finally {
            setIsTesting(false);
        }
    };

    const handleTestUrl = async () => {
        await runDebug(String(settings.playlistUrl || '').trim());
    };

    const handleExportUrl = async () => {
        const targetUrl = String(settings.playlistUrl || '').trim();
        if (!targetUrl) {
            setActionError('Isi URL playlist terlebih dahulu.');
            return;
        }

        setIsExporting(true);
        setActionError(null);
        setUploadError(null);
        setPreviewError(null);

        try {
            const res = await fetchWithAuth(`/api/admin/settings/video-playlist/export?url=${encodeURIComponent(targetUrl)}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || 'Gagal export playlist.');
            }

            const blob = await res.blob();
            const objectUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `playlist-${Date.now()}.m3u8`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(objectUrl);
        } catch (error: any) {
            setActionError(error?.message || 'Gagal export playlist.');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Card title="TV Playlist Settings">
            <div className="space-y-6">
                <div className="flex items-center">
                    <input
                        type="checkbox"
                        id="videoEnabled"
                        name="video.enabled"
                        checked={Boolean(settings.enabled)}
                        onChange={handleInputChange}
                        className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="videoEnabled" className="ml-2 block text-sm font-medium text-gray-900 dark:text-gray-200">
                        Aktifkan menu TV / video di customer portal
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="videoTitle" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Judul</label>
                        <input
                            id="videoTitle"
                            name="video.title"
                            value={settings.title || ''}
                            onChange={handleInputChange}
                            className={inputClasses}
                            placeholder="Channel TV / Playlist"
                        />
                    </div>
                    <div>
                        <label htmlFor="videoPosterUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Poster / Banner URL</label>
                        <input
                            id="videoPosterUrl"
                            name="video.posterUrl"
                            value={settings.posterUrl || ''}
                            onChange={handleInputChange}
                            className={inputClasses}
                            placeholder="https://example.com/banner.jpg"
                        />
                    </div>
                    <div>
                        <label htmlFor="videoDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Deskripsi</label>
                        <input
                            id="videoDescription"
                            name="video.description"
                            value={settings.description || ''}
                            onChange={handleInputChange}
                            className={inputClasses}
                            placeholder="Deskripsi singkat playlist"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label htmlFor="videoPlaylistUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">URL Playlist</label>
                        <input
                            id="videoPlaylistUrl"
                            name="video.playlistUrl"
                            value={settings.playlistUrl || ''}
                            onChange={handleInputChange}
                            className={inputClasses}
                            placeholder="https://domain.com/playlist.m3u atau /uploads/playlist-123.m3u"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Isi URL playlist langsung di sini, atau kosongkan jika ingin pakai file upload.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                            type="checkbox"
                            name="video.autoplay"
                            checked={Boolean(settings.autoplay)}
                            onChange={handleInputChange}
                            className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded"
                        />
                        Autoplay
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                            type="checkbox"
                            name="video.loop"
                            checked={Boolean(settings.loop)}
                            onChange={handleInputChange}
                            className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded"
                        />
                        Loop
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                            type="checkbox"
                            name="video.controls"
                            checked={settings.controls !== false}
                            onChange={handleInputChange}
                            className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded"
                        />
                        Controls
                    </label>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Upload File Playlist</label>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".m3u,.m3u8,.txt,.m3u8.txt,text/plain,application/vnd.apple.mpegurl"
                            onChange={handleFileChange}
                            className="block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
                        />
                        <button
                            type="button"
                            onClick={handleUploadClick}
                            disabled={!selectedFile || isUploading}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                        >
                            {isUploading ? 'Mengupload...' : 'Upload Playlist'}
                        </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        File dipreview dulu, lalu upload ke server dan diakses lewat URL. Jika URL playlist di atas diisi, customer akan pakai URL itu.
                    </p>
                    {selectedFile ? (
                        <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                            File terpilih: <span className="font-mono">{selectedFile.name}</span>
                        </div>
                    ) : null}
                    {previewText ? (
                        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Preview Playlist</div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {preview.total} channel, {preview.groups.length} grup
                            </div>
                            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                                {preview.items.slice(0, 8).map((item, idx) => (
                                    <div key={`${item.title}-${idx}`} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700">
                                            {item.logoUrl ? (
                                                <img src={item.logoUrl} alt={item.title} className="h-full w-full object-contain p-1" />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-500 dark:text-gray-300">
                                                    TV
                                                </div>
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{item.title}</div>
                                            <div className="truncate text-xs text-gray-500 dark:text-gray-400">{item.groupTitle}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => runDebug(item.streamUrl)}
                                            className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                                        >
                                            Test
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {preview.items.length > 8 ? (
                                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                    Menampilkan 8 channel pertama dari total {preview.items.length}.
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {settings.playlistUrl ? (
                        <div className="mt-3 space-y-3 rounded-lg bg-white px-3 py-2 text-xs text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700">
                            <div className="break-all">
                                URL playlist aktif: <span className="font-mono">{settings.playlistUrl}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleTestUrl}
                                    disabled={isTesting}
                                    className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-500"
                                >
                                    {isTesting ? 'Mengetes...' : 'Test Playlist URL'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleExportUrl}
                                    disabled={isExporting}
                                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
                                >
                                    {isExporting ? 'Exporting...' : 'Export M3U8'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeleteClick}
                                    disabled={isDeleting}
                                    className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-400"
                                >
                                    {isDeleting ? 'Menghapus...' : 'Hapus file playlist'}
                                </button>
                            </div>
                        </div>
                    ) : null}
                    {debugResult ? (
                        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${debugResult.ok ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200'}`}>
                            <div className="font-semibold">{debugResult.message}</div>
                            {debugResult.status ? <div>Status: {debugResult.status}</div> : null}
                            {debugResult.finalUrl ? <div className="break-all">Final URL: {debugResult.finalUrl}</div> : null}
                            {debugResult.contentType ? <div>Content-Type: {debugResult.contentType}</div> : null}
                            {typeof debugResult.channelCount === 'number' ? <div>Channel: {debugResult.channelCount}</div> : null}
                            {debugResult.preview ? (
                                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-2 text-[11px] dark:bg-black/20">{debugResult.preview}</pre>
                            ) : null}
                        </div>
                    ) : null}
                    {previewError || uploadError || actionError ? (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                            {previewError || uploadError || actionError}
                        </div>
                    ) : null}
                </div>

                <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-400">
                    Customer portal akan mengambil isi file playlist dari URL yang disimpan, lalu menampilkan channel dalam bentuk grid dengan logo.
                </div>
            </div>
        </Card>
    );
};

export default VideoApiSettings;
