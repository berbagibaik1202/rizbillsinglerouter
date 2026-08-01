import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import * as dashjsModule from 'dashjs';
import { fetchWithAuth } from '~/components/api';

interface CustomerVideoProps {
    enabled: boolean;
    title?: string;
    playlistUrl?: string;
    playlistText?: string;
    posterUrl?: string;
    description?: string;
    autoplay?: boolean;
    loop?: boolean;
    controls?: boolean;
    onPlayerModeChange?: (isActive: boolean) => void;
}

type PlaylistItem = {
    id: string;
    title: string;
    groupTitle: string;
    logoUrl: string;
    streamUrl: string;
    rawInf: string;
};

type RequestLogEntry = {
    phase: 'bootstrap' | 'playlist' | 'manifest' | 'segment' | 'key' | 'media';
    url: string;
    status?: number;
    contentType?: string;
    ok?: boolean;
    note?: string;
};

type DashManifestState = {
    checkedUrl: string;
    drmProtected: boolean;
    detail?: string;
};

type StreamKind = 'unknown' | 'hls' | 'dash' | 'media';
type StreamProbeResult = {
    kind: StreamKind;
    contentType?: string;
    status: number;
    note: string;
    text?: string;
};

const FAVORITES_KEY = 'rizkitechbill_tv_favorites';
const LAST_CHANNEL_KEY = 'rizkitechbill_tv_last_channel';
const dashjs = (dashjsModule as any).default ?? dashjsModule;
const getDashPlayerFactory = () => {
    const namespace = dashjs as any;
    const factory = namespace?.MediaPlayer || (dashjsModule as any)?.MediaPlayer;
    if (typeof factory !== 'function') {
        return null;
    }
    return factory;
};

const attrPattern = /([a-zA-Z0-9-:]+)="([^"]*)"/g;

const resolveUrl = (value: string, baseUrl?: string) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (!baseUrl) return trimmed;
    try {
        return new URL(trimmed, baseUrl).href;
    } catch {
        return trimmed;
    }
};

const resolvePlaylistBaseUrl = (value?: string) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (typeof window !== 'undefined') {
        try {
            return new URL(trimmed, window.location.href).href;
        } catch {
            return trimmed;
        }
    }
    return trimmed;
};

const readJsonArray = (key: string): string[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
    } catch {
        return [];
    }
};

const writeJsonArray = (key: string, values: string[]) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(values));
};

const parsePlaylist = (text?: string, baseUrl?: string): PlaylistItem[] => {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const items: PlaylistItem[] = [];
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
        const attrs: Record<string, string> = {};
        let match: RegExpExecArray | null;
        attrPattern.lastIndex = 0;
        while ((match = attrPattern.exec(attrsPart)) !== null) {
            attrs[match[1]] = match[2];
        }

        items.push({
            id: `${items.length}-${title || streamUrl}`,
            title: title || 'Unknown Channel',
            groupTitle: attrs['group-title'] || attrs.groupTitle || 'Lainnya',
            logoUrl: resolveUrl(attrs['tvg-logo'] || attrs['group-logo'] || attrs.logo || '', baseUrl),
            streamUrl: resolveUrl(streamUrl.trim(), baseUrl),
            rawInf: line,
        });
    }

    return items;
};

const isHlsStream = (url: string) => /\.m3u8(\?.*)?$/i.test(url);
const isDashStream = (url: string) => /\.mpd(\?.*)?$/i.test(url);
const isAbsoluteHttpUrl = (url: string) => /^https?:\/\//i.test(url);
const hasDrmProtection = (manifestText: string) => /<ContentProtection\b|cenc:pssh|schemeIdUri="urn:uuid:/i.test(manifestText);
const looksLikeHlsBody = (text: string) => /#EXTM3U|#EXTINF|#EXT-X-STREAM-INF|#EXT-X-TARGETDURATION/i.test(text);
const looksLikeDashBody = (text: string) => /<MPD\b|<AdaptationSet\b|<Representation\b|ContentProtection/i.test(text);
const detectStreamKindFromContentType = (contentType?: string): StreamKind => {
    const value = String(contentType || '').toLowerCase();
    if (!value) return 'unknown';
    if (value.includes('mpegurl') || value.includes('m3u8') || value.includes('application/x-mpegurl')) return 'hls';
    if (value.includes('dash') || value.includes('application/dash+xml') || value.includes('mpd') || value.includes('xml')) return 'dash';
    if (value.startsWith('video/') || value.startsWith('audio/')) return 'media';
    return 'unknown';
};

const normalizeQuery = (value: string) => value.trim().toLowerCase();

const CustomerVideo: React.FC<CustomerVideoProps> = ({
    enabled,
    title,
    playlistUrl,
    playlistText,
    posterUrl,
    description,
    autoplay = false,
    loop = false,
    controls = true,
    onPlayerModeChange,
}) => {
    const hasPlaylistSource = Boolean(String(playlistUrl || '').trim() || String(playlistText || '').trim());
    const isFeatureEnabled = Boolean(enabled || hasPlaylistSource);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const dashRef = useRef<any>(null);
    const dashRequestInterceptorRef = useRef<((request: any) => any) | null>(null);
    const autoFallbackUsedRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [sourceText, setSourceText] = useState<string>(playlistText || '');
    const [sourceLoading, setSourceLoading] = useState(false);
    const [mediaToken, setMediaToken] = useState<string | null>(null);
    const [mediaTokenLoading, setMediaTokenLoading] = useState(false);
    const [dashManifestCheck, setDashManifestCheck] = useState<DashManifestState | null>(null);
    const [dashManifestCache, setDashManifestCache] = useState<Record<string, DashManifestState>>({});
    const [detectedStreamKind, setDetectedStreamKind] = useState<StreamKind>('unknown');
    const [streamProbeLoading, setStreamProbeLoading] = useState(false);
    const [requestLog, setRequestLog] = useState<RequestLogEntry[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return window.localStorage.getItem(LAST_CHANNEL_KEY);
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [groupFilter, setGroupFilter] = useState<'all' | 'favorites' | string>('all');
    const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readJsonArray(FAVORITES_KEY));

    useEffect(() => {
        let active = true;
        const resolvedPlaylistUrl = String(playlistUrl || '').trim();
        const fallbackPlaylistText = String(playlistText || '').trim();

        if (!resolvedPlaylistUrl) {
            setSourceText(fallbackPlaylistText);
            setError(null);
            setStatusMessage(null);
            setSourceLoading(false);
            return;
        }

        setSourceLoading(true);
        const sourceUrl = /^https?:\/\//i.test(resolvedPlaylistUrl)
            ? `/api/customers/playlist-source?url=${encodeURIComponent(resolvedPlaylistUrl)}`
            : resolvedPlaylistUrl;

        const request = sourceUrl.startsWith('/api/')
            ? fetchWithAuth(sourceUrl)
            : fetch(sourceUrl);

        request
            .then((res) => {
                if (!res.ok) {
                    const error = new Error(`Gagal memuat playlist (${res.status})`);
                    (error as any).status = res.status;
                    throw error;
                }
                return res.text();
            })
            .then((text) => {
                if (!active) return;
                setSourceText(text);
                setError(null);
                setStatusMessage(null);
            })
            .catch((err: any) => {
                if (!active) return;
                const status = Number(err?.status || err?.response?.status || 0);
                if (status === 404 && fallbackPlaylistText) {
                    setSourceText(fallbackPlaylistText);
                    setError(null);
                    setStatusMessage('Playlist utama tidak ditemukan. Menggunakan teks playlist cadangan.');
                    return;
                }

                setSourceText(fallbackPlaylistText);
                if (status === 404) {
                    setError(null);
                    setStatusMessage('Playlist TV belum tersedia atau file upload belum ditemukan.');
                    return;
                }

                setError(err?.message || 'Gagal memuat playlist.');
            })
            .finally(() => {
                if (!active) return;
                setSourceLoading(false);
            });

        return () => {
            active = false;
        };
    }, [playlistUrl, playlistText]);

    const playlistBaseUrl = useMemo(() => resolvePlaylistBaseUrl(playlistUrl), [playlistUrl]);
    const channels = useMemo(() => parsePlaylist(sourceText, playlistBaseUrl || undefined), [sourceText, playlistBaseUrl]);
    const groupNames = useMemo(() => {
        return Array.from(new Set(channels.map((item) => item.groupTitle))).sort((a, b) => a.localeCompare(b));
    }, [channels]);

    const filteredChannels = useMemo(() => {
        const query = normalizeQuery(searchQuery);
        return channels.filter((item) => {
            const matchesGroup =
                groupFilter === 'all'
                    ? true
                    : groupFilter === 'favorites'
                        ? favoriteIds.includes(item.id)
                        : item.groupTitle === groupFilter;

            const matchesSearch = !query
                || normalizeQuery(item.title).includes(query)
                || normalizeQuery(item.groupTitle).includes(query);

            return matchesGroup && matchesSearch;
        });
    }, [channels, searchQuery, groupFilter, favoriteIds]);

    const selectedChannel = useMemo(() => {
        if (!channels.length) return null;
        return channels.find((item) => item.id === selectedId) || filteredChannels[0] || channels[0] || null;
    }, [channels, filteredChannels, selectedId]);

    const selectedIndex = useMemo(() => {
        if (!selectedChannel) return -1;
        return filteredChannels.findIndex((item) => item.id === selectedChannel.id);
    }, [filteredChannels, selectedChannel]);

    const selectedDashManifestState = useMemo(() => {
        if (!selectedChannel || !isDashStream(selectedChannel.streamUrl)) return null;
        return dashManifestCache[selectedChannel.streamUrl] || null;
    }, [dashManifestCache, selectedChannel]);

    const activeStreamUrl = selectedChannel?.streamUrl?.trim() || '';
    const shouldProxyStream = isAbsoluteHttpUrl(activeStreamUrl);
    const proxiedStreamUrl = useMemo(() => {
        if (!activeStreamUrl) return '';
        if (!shouldProxyStream) return activeStreamUrl;
        if (!mediaToken) return activeStreamUrl;
        return `/api/public/media-proxy?token=${encodeURIComponent(mediaToken)}&url=${encodeURIComponent(activeStreamUrl)}`;
    }, [activeStreamUrl, mediaToken, shouldProxyStream]);
    const visibleProxiedStreamUrl = proxiedStreamUrl;
    const streamKind = useMemo<StreamKind>(() => {
        if (isDashStream(visibleProxiedStreamUrl)) return 'dash';
        if (isHlsStream(visibleProxiedStreamUrl)) return 'hls';
        return detectedStreamKind;
    }, [detectedStreamKind, visibleProxiedStreamUrl]);

    const pushRequestLog = useCallback((entry: RequestLogEntry) => {
        setRequestLog((prev) => [entry, ...prev].slice(0, 8));
    }, []);

    const clearRequestLog = useCallback(() => {
        setRequestLog([]);
    }, []);

    const selectChannel = useCallback((channelId: string, reason: 'manual' | 'fallback' = 'manual') => {
        setSelectedId(channelId);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(LAST_CHANNEL_KEY, channelId);
        }
        if (reason === 'manual') {
            autoFallbackUsedRef.current = false;
            setError(null);
            setStatusMessage(null);
        }
    }, []);

    const toggleFavorite = useCallback((channelId: string) => {
        setFavoriteIds((prev) => {
            const next = prev.includes(channelId)
                ? prev.filter((id) => id !== channelId)
                : [...prev, channelId];
            writeJsonArray(FAVORITES_KEY, next);
            return next;
        });
    }, []);

    const moveChannel = useCallback((delta: number, reason: 'manual' | 'fallback' = 'manual') => {
        if (!filteredChannels.length) return;
        const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
        let nextIndex = (currentIndex + delta + filteredChannels.length) % filteredChannels.length;
        let nextChannel = filteredChannels[nextIndex];
        let visited = 0;

        while (nextChannel && isDashStream(nextChannel.streamUrl) && dashManifestCache[nextChannel.streamUrl]?.drmProtected && visited < filteredChannels.length) {
            nextIndex = (nextIndex + delta + filteredChannels.length) % filteredChannels.length;
            nextChannel = filteredChannels[nextIndex];
            visited += 1;
        }

        if (nextChannel && visited < filteredChannels.length) {
            selectChannel(nextChannel.id, reason);
        }
    }, [filteredChannels, selectedIndex, selectChannel, dashManifestCache]);

    useEffect(() => {
        if (!isFeatureEnabled || !channels.length) {
            onPlayerModeChange?.(false);
            return;
        }
        onPlayerModeChange?.(Boolean(activeStreamUrl));
        return () => onPlayerModeChange?.(false);
    }, [isFeatureEnabled, channels.length, activeStreamUrl, onPlayerModeChange]);

    useEffect(() => {
        if (!channels.length) return;

        const selectedStillExists = selectedId && channels.some((item) => item.id === selectedId);
        const storedSelection = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_CHANNEL_KEY) : null;
        const storedStillExists = storedSelection && channels.some((item) => item.id === storedSelection);
        const nextSelected = selectedStillExists
            ? selectedId
            : storedStillExists
                ? storedSelection
                : channels[0]?.id || null;

        if (nextSelected && nextSelected !== selectedId) {
            selectChannel(nextSelected, 'manual');
        }
    }, [channels, selectedId, selectChannel]);

    useEffect(() => {
        if (!filteredChannels.length) return;
        if (selectedChannel && filteredChannels.some((item) => item.id === selectedChannel.id)) {
            return;
        }
        const next = filteredChannels[0];
        if (next) {
            selectChannel(next.id, 'manual');
        }
    }, [filteredChannels, selectedChannel, selectChannel]);

    useEffect(() => {
        let active = true;
        if (!isFeatureEnabled || !activeStreamUrl) {
            setMediaToken(null);
            setMediaTokenLoading(false);
            return;
        }

        setMediaTokenLoading(true);
        pushRequestLog({
            phase: 'bootstrap',
            url: activeStreamUrl,
            ok: true,
            note: shouldProxyStream ? 'Requesting media token' : 'Direct stream, token not needed',
        });
        fetchWithAuth('/api/customers/media-token')
            .then((res) => res.json())
            .then((data) => {
                if (!active) return;
                if (!data?.token) {
                    throw new Error('Failed to get media token.');
                }
                setMediaToken(data.token);
                pushRequestLog({
                    phase: 'bootstrap',
                    url: activeStreamUrl,
                    ok: true,
                    note: 'Media token ready',
                });
            })
            .catch((err: any) => {
                if (!active) return;
                setMediaToken(null);
                setError(err?.message || 'Gagal mengambil token pemutar.');
                pushRequestLog({
                    phase: 'bootstrap',
                    url: activeStreamUrl,
                    ok: false,
                    note: err?.message || 'Gagal mengambil token pemutar.',
                });
            })
            .finally(() => {
                if (!active) return;
                setMediaTokenLoading(false);
            });

        return () => {
            active = false;
        };
    }, [isFeatureEnabled, activeStreamUrl, pushRequestLog, shouldProxyStream]);

    useEffect(() => {
        let active = true;
        if (!isFeatureEnabled || !visibleProxiedStreamUrl || streamKind !== 'dash') {
            setDashManifestCheck(null);
            return;
        }

        const cached = dashManifestCache[visibleProxiedStreamUrl];
        if (cached) {
            setDashManifestCheck(cached);
            return;
        }

        setDashManifestCheck(null);
        fetch(visibleProxiedStreamUrl, { cache: 'no-store' })
            .then((res) => res.text().then((text) => ({
                ok: res.ok,
                status: res.status,
                contentType: res.headers.get('content-type') || undefined,
                text,
            })))
            .then(({ ok, status, contentType, text }) => {
                if (!active) return;
                const drmProtected = hasDrmProtection(text);
                const nextState: DashManifestState = {
                    checkedUrl: visibleProxiedStreamUrl,
                    drmProtected,
                    detail: drmProtected
                        ? 'Manifest mengandung ContentProtection/DRM.'
                        : 'Manifest DASH tanpa DRM terdeteksi.',
                };
                setDashManifestCheck(nextState);
                setDashManifestCache((prev) => ({
                    ...prev,
                    [visibleProxiedStreamUrl]: nextState,
                }));
                pushRequestLog({
                    phase: 'manifest',
                    url: visibleProxiedStreamUrl,
                    status,
                    contentType,
                    ok,
                    note: drmProtected ? 'DRM detected' : 'Manifest checked',
                });
            })
            .catch((err: any) => {
                if (!active) return;
                const nextState: DashManifestState = {
                    checkedUrl: visibleProxiedStreamUrl,
                    drmProtected: false,
                    detail: err?.message || 'Gagal memeriksa manifest DASH.',
                };
                setDashManifestCheck(nextState);
                setDashManifestCache((prev) => ({
                    ...prev,
                    [visibleProxiedStreamUrl]: nextState,
                }));
            });

        return () => {
            active = false;
        };
    }, [isFeatureEnabled, visibleProxiedStreamUrl, streamKind, pushRequestLog, dashManifestCache]);

    useEffect(() => {
        let active = true;
        if (!isFeatureEnabled || !activeStreamUrl) {
            setDetectedStreamKind('unknown');
            setStreamProbeLoading(false);
            return;
        }

        if (isHlsStream(visibleProxiedStreamUrl)) {
            setDetectedStreamKind('hls');
            setStreamProbeLoading(false);
            return;
        }
        if (isDashStream(visibleProxiedStreamUrl)) {
            setDetectedStreamKind('dash');
            setStreamProbeLoading(false);
            return;
        }

        setStreamProbeLoading(Boolean(shouldProxyStream && mediaTokenLoading));
        if (!shouldProxyStream || !mediaToken) {
            return;
        }

        setStreamProbeLoading(true);
        const probeUrl = `${visibleProxiedStreamUrl}${visibleProxiedStreamUrl.includes('?') ? '&' : '?'}_probe=${Date.now()}`;

        fetch(probeUrl, {
            method: 'HEAD',
            cache: 'no-store',
        })
            .then((res): StreamProbeResult | Promise<StreamProbeResult> => {
                const contentType = res.headers.get('content-type') || undefined;
                const guessed = detectStreamKindFromContentType(contentType);
                if (guessed !== 'unknown') {
                    return { kind: guessed, contentType, status: res.status, note: 'HEAD probe' };
                }

                return fetch(probeUrl, {
                    method: 'GET',
                    headers: {
                        Range: 'bytes=0-4095',
                    },
                    cache: 'no-store',
                }).then(async (bodyRes): Promise<StreamProbeResult> => {
                    const bodyText = await bodyRes.text();
                    const text = bodyText.slice(0, 4096);
                    const bodyKind = looksLikeDashBody(text)
                        ? 'dash'
                        : looksLikeHlsBody(text)
                            ? 'hls'
                            : detectStreamKindFromContentType(bodyRes.headers.get('content-type') || undefined);
                    return {
                        kind: bodyKind,
                        contentType: bodyRes.headers.get('content-type') || undefined,
                        status: bodyRes.status,
                        note: 'Body probe',
                        text,
                    };
                });
            })
            .then((result) => {
                if (!active) return;
                const nextKind = result.kind || 'unknown';
                setDetectedStreamKind(nextKind);
                pushRequestLog({
                    phase: 'bootstrap',
                    url: visibleProxiedStreamUrl,
                    status: result.status,
                    contentType: result.contentType,
                    ok: nextKind !== 'unknown',
                    note: `${result.note || 'Probe'} => ${nextKind}`,
                });
            })
            .catch((err: any) => {
                if (!active) return;
                setDetectedStreamKind('unknown');
                pushRequestLog({
                    phase: 'bootstrap',
                    url: visibleProxiedStreamUrl,
                    ok: false,
                    note: err?.message || 'Gagal mendeteksi tipe stream.',
                });
            })
            .finally(() => {
                if (!active) return;
                setStreamProbeLoading(false);
            });

        return () => {
            active = false;
        };
    }, [isFeatureEnabled, activeStreamUrl, visibleProxiedStreamUrl, shouldProxyStream, mediaToken, mediaTokenLoading, pushRequestLog]);

    useEffect(() => {
        if (selectedDashManifestState?.drmProtected) {
            setStatusMessage('Channel ini memakai DRM dan tidak bisa diputar di web player.');
            setError(null);
        }
    }, [selectedDashManifestState]);

    useEffect(() => {
        const videoEl = videoRef.current;
        if (!videoEl) return;
        videoEl.crossOrigin = 'anonymous';

        const onLoadStart = () => {
            pushRequestLog({
                phase: 'bootstrap',
                url: visibleProxiedStreamUrl || activeStreamUrl || 'n/a',
                ok: true,
                note: 'Video element loadstart',
            });
        };
        const onLoadedMetadata = () => {
            pushRequestLog({
                phase: 'media',
                url: visibleProxiedStreamUrl || activeStreamUrl || 'n/a',
                ok: true,
                note: 'loadedmetadata',
            });
            setIsLoading(false);
        };
        const onCanPlay = () => {
            pushRequestLog({
                phase: 'media',
                url: visibleProxiedStreamUrl || activeStreamUrl || 'n/a',
                ok: true,
                note: 'canplay',
            });
            setIsLoading(false);
        };
        const onPlaying = () => {
            pushRequestLog({
                phase: 'media',
                url: visibleProxiedStreamUrl || activeStreamUrl || 'n/a',
                ok: true,
                note: 'playing',
            });
            setIsLoading(false);
        };
        const onStalled = () => {
            pushRequestLog({
                phase: 'media',
                url: visibleProxiedStreamUrl || activeStreamUrl || 'n/a',
                ok: false,
                note: 'stalled',
            });
        };
        const onWaiting = () => {
            pushRequestLog({
                phase: 'media',
                url: visibleProxiedStreamUrl || activeStreamUrl || 'n/a',
                ok: false,
                note: 'waiting',
            });
        };
        const onNativeError = () => {
            const mediaError = videoEl.error;
            pushRequestLog({
                phase: 'media',
                url: visibleProxiedStreamUrl || activeStreamUrl || 'n/a',
                status: mediaError?.code,
                ok: false,
                note: mediaError?.message || 'video error',
            });
        };

        videoEl.addEventListener('loadstart', onLoadStart);
        videoEl.addEventListener('loadedmetadata', onLoadedMetadata);
        videoEl.addEventListener('canplay', onCanPlay);
        videoEl.addEventListener('playing', onPlaying);
        videoEl.addEventListener('stalled', onStalled);
        videoEl.addEventListener('waiting', onWaiting);
        videoEl.addEventListener('error', onNativeError);

        const cleanup = () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (dashRef.current) {
                if (dashRequestInterceptorRef.current && typeof dashRef.current.removeRequestInterceptor === 'function') {
                    dashRef.current.removeRequestInterceptor(dashRequestInterceptorRef.current);
                }
                dashRequestInterceptorRef.current = null;
                dashRef.current.reset();
                dashRef.current = null;
            }
            videoEl.pause();
            videoEl.removeAttribute('src');
            videoEl.load();
            videoEl.removeEventListener('loadstart', onLoadStart);
            videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
            videoEl.removeEventListener('canplay', onCanPlay);
            videoEl.removeEventListener('playing', onPlaying);
            videoEl.removeEventListener('stalled', onStalled);
            videoEl.removeEventListener('waiting', onWaiting);
            videoEl.removeEventListener('error', onNativeError);
        };

        if (!isFeatureEnabled || (!activeStreamUrl && !selectedChannel)) {
            setError(null);
            setIsLoading(false);
            cleanup();
            return cleanup;
        }

        setError(null);
        setStatusMessage(null);
        setIsLoading(true);
        clearRequestLog();

        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        const handleFailure = (message: string) => {
            if (!filteredChannels.length) {
                setError(message);
                setIsLoading(false);
                return;
            }

            if (!autoFallbackUsedRef.current && filteredChannels.length > 1) {
                autoFallbackUsedRef.current = true;
                setStatusMessage('Channel error, pindah ke channel berikutnya.');
                moveChannel(1, 'fallback');
                return;
            }

            setError(message);
            setIsLoading(false);
        };

        const canPlayNativeHls = videoEl.canPlayType('application/vnd.apple.mpegurl');
        const shouldUseHls = isHlsStream(visibleProxiedStreamUrl) || streamKind === 'hls';
        const shouldUseDash = isDashStream(visibleProxiedStreamUrl) || streamKind === 'dash';
        const onVideoError = () => handleFailure('Stream tidak bisa diputar.');
        pushRequestLog({
            phase: 'bootstrap',
            url: visibleProxiedStreamUrl || activeStreamUrl || 'n/a',
            ok: true,
            note: `mode=${shouldUseDash ? 'dash' : shouldUseHls ? 'hls' : 'direct'}; nativeHls=${Boolean(canPlayNativeHls)}; hlsJs=${Hls.isSupported()}; detected=${streamKind}`,
        });

        if (shouldUseDash) {
            try {
                if (typeof window === 'undefined' || !('MediaSource' in window)) {
                    throw new Error('Browser tidak mendukung DASH/MSE.');
                }

                if (dashManifestCheck?.drmProtected && dashManifestCheck.checkedUrl === visibleProxiedStreamUrl) {
                    throw new Error('Stream DASH ini terenkripsi/DRM dan memerlukan license server.');
                }

                const mediaPlayerFactory = getDashPlayerFactory();
                if (!mediaPlayerFactory) {
                    throw new Error('dash.js MediaPlayer tidak tersedia.');
                }

                const playerFactory = mediaPlayerFactory();
                const player = typeof playerFactory?.create === 'function' ? playerFactory.create() : playerFactory;
                if (!player) {
                    throw new Error('Gagal membuat instance dash.js player.');
                }
                dashRef.current = player;
                dashRequestInterceptorRef.current = (request: any) => {
                    const requestUrl = String(request?.url || '').trim();
                    if (!requestUrl || !isAbsoluteHttpUrl(requestUrl) || requestUrl.includes('/api/public/media-proxy?')) {
                        return request;
                    }
                    request.url = `/api/public/media-proxy?token=${encodeURIComponent(mediaToken || '')}&url=${encodeURIComponent(requestUrl)}`;
                    return request;
                };
                if (typeof player.addRequestInterceptor === 'function') {
                    player.addRequestInterceptor(dashRequestInterceptorRef.current);
                }
                if (typeof player.updateSettings === 'function') {
                    player.updateSettings({
                        streaming: {
                            lowLatencyEnabled: true,
                            fastSwitchEnabled: true,
                        },
                    });
                }
                const dashEvents = (dashjs as any)?.MediaPlayer?.events || (dashjsModule as any)?.MediaPlayer?.events;
                if (dashEvents?.PLAYBACK_ERROR) {
                    player.on(dashEvents.PLAYBACK_ERROR, (e: any) => {
                        pushRequestLog({
                            phase: 'media',
                            url: visibleProxiedStreamUrl,
                            status: e?.event?.responsecode,
                            ok: false,
                            note: e?.event?.message || 'dash.js playback error',
                        });
                    });
                }
                if (dashEvents?.STREAM_INITIALIZED) {
                    player.on(dashEvents.STREAM_INITIALIZED, () => {
                        pushRequestLog({
                            phase: 'manifest',
                            url: visibleProxiedStreamUrl,
                            ok: true,
                            note: 'Stream initialized',
                        });
                        setIsLoading(false);
                    });
                }
                if (dashEvents?.PLAYBACK_PLAYING) {
                    player.on(dashEvents.PLAYBACK_PLAYING, () => {
                        setIsLoading(false);
                    });
                }
                if (typeof player.initialize === 'function') {
                    player.initialize(videoEl, visibleProxiedStreamUrl, autoplay);
                } else if (typeof player.attachView === 'function' && typeof player.attachSource === 'function') {
                    player.attachView(videoEl);
                    player.attachSource(visibleProxiedStreamUrl);
                    if (autoplay) {
                        void videoEl.play().catch(() => undefined);
                    }
                } else {
                    throw new Error('dash.js player API tidak tersedia.');
                }
                if (dashEvents?.ERROR) {
                    player.on(dashEvents.ERROR, (e: any) => {
                        const eventMessage = e?.event?.message || e?.event?.error?.message || e?.event?.error?.name || '';
                        pushRequestLog({
                            phase: 'manifest',
                            url: visibleProxiedStreamUrl,
                            status: e?.event?.responsecode || e?.event?.status || e?.event?.error?.code,
                            ok: false,
                            note: eventMessage || undefined,
                        });
                        handleFailure(eventMessage || 'Gagal memutar stream DASH.');
                    });
                }
                pushRequestLog({
                    phase: 'manifest',
                    url: visibleProxiedStreamUrl,
                    ok: true,
                });
                return cleanup;
            } catch (error) {
                console.error('[DASH Player] Failed to initialize player:', error);
                const message = error instanceof Error ? error.message : 'Gagal menyiapkan player DASH.';
                handleFailure(message);
                return cleanup;
            }
        }

        if (shouldUseHls && Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                xhrSetup: (xhr) => {
                    xhr.withCredentials = false;
                    xhr.addEventListener('loadend', () => {
                        const contentType = xhr.getResponseHeader('content-type') || undefined;
                        const phase = /\.m3u8(\?.*)?$/i.test(xhr.responseURL || '') ? 'manifest' : 'segment';
                        pushRequestLog({
                            phase,
                            url: xhr.responseURL || visibleProxiedStreamUrl,
                            status: xhr.status,
                            contentType,
                            ok: xhr.status >= 200 && xhr.status < 400,
                        });
                    });
                },
            });
            hlsRef.current = hls;
            pushRequestLog({
                phase: 'bootstrap',
                url: visibleProxiedStreamUrl,
                ok: true,
                note: 'Hls.js attach/loadSource',
            });
            hls.loadSource(visibleProxiedStreamUrl);
            hls.attachMedia(videoEl);
            videoEl.onerror = onVideoError;
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                pushRequestLog({
                    phase: 'manifest',
                    url: visibleProxiedStreamUrl,
                    ok: true,
                });
                setIsLoading(false);
                if (autoplay) {
                    void videoEl.play().catch(() => undefined);
                }
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data?.fatal) {
                    const errorData = data as any;
                    pushRequestLog({
                        phase: 'media',
                        url: visibleProxiedStreamUrl,
                        status: errorData?.response?.code,
                        ok: false,
                    });
                    handleFailure('Gagal memutar stream HLS.');
                }
            });
            return cleanup;
        }

        if (shouldUseHls && canPlayNativeHls) {
            pushRequestLog({
                phase: 'bootstrap',
                url: visibleProxiedStreamUrl,
                ok: true,
                note: 'Native HLS path',
            });
            videoEl.src = visibleProxiedStreamUrl;
            videoEl.load();
            setIsLoading(false);
            if (autoplay) {
                void videoEl.play().catch(() => undefined);
            }
            return cleanup;
        }

        pushRequestLog({
            phase: 'bootstrap',
            url: visibleProxiedStreamUrl,
            ok: true,
            note: 'Fallback media element path',
        });
        videoEl.src = visibleProxiedStreamUrl;
        videoEl.onerror = onVideoError;
        videoEl.load();
        setIsLoading(false);
        if (autoplay) {
            void videoEl.play().catch(() => undefined);
        }
        return cleanup;
    }, [isFeatureEnabled, visibleProxiedStreamUrl, activeStreamUrl, autoplay, filteredChannels, moveChannel, clearRequestLog, pushRequestLog, mediaToken, shouldProxyStream, selectedChannel, streamKind]);

    if (!isFeatureEnabled) {
        return (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                Fitur TV belum diaktifkan oleh admin.
            </div>
        );
    }

    if (sourceLoading) {
        return (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                Memuat playlist...
            </div>
        );
    }

    if (!channels.length) {
        if (error) {
            return (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                    {error}
                </div>
            );
        }

        return (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                Playlist belum diisi oleh admin.
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 p-5 text-white shadow-lg">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="text-xs uppercase tracking-[0.35em] text-cyan-300">TV Playlist</div>
                        <h2 className="mt-2 text-2xl font-semibold">{title || 'Channel TV'}</h2>
                        {description ? <p className="mt-2 max-w-3xl text-sm text-slate-300">{description}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200">
                        <span className="rounded-full bg-white/10 px-3 py-1">{channels.length} channel</span>
                        <span className="rounded-full bg-white/10 px-3 py-1">{favoriteIds.length} favorit</span>
                        <span className="rounded-full bg-white/10 px-3 py-1">
                            Token: {mediaToken ? 'ready' : mediaTokenLoading ? 'loading' : 'missing'}
                        </span>
                        <span className="rounded-full bg-white/10 px-3 py-1">
                            Probe: {streamProbeLoading ? 'loading' : detectedStreamKind}
                        </span>
                        <button
                            type="button"
                            onClick={() => moveChannel(-1)}
                            disabled={filteredChannels.length < 2}
                            className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Prev
                        </button>
                        <button
                            type="button"
                            onClick={() => moveChannel(1)}
                            disabled={filteredChannels.length < 2}
                            className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)] lg:items-start">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-black shadow-sm dark:border-gray-700 lg:sticky lg:top-4">
                    <div className="relative aspect-video">
                        <video
                            ref={videoRef}
                            poster={selectedChannel?.logoUrl || posterUrl || undefined}
                            className="h-full w-full bg-black"
                            controls={controls}
                            autoPlay={autoplay}
                            loop={loop}
                            muted={autoplay}
                            playsInline
                        />
                        {(isLoading || mediaTokenLoading || streamProbeLoading) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
                                {streamProbeLoading ? 'Mendeteksi tipe stream...' : mediaTokenLoading ? 'Menyiapkan token pemutar...' : 'Memuat channel...'}
                            </div>
                        )}
                    </div>
                    <div className="border-t border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-200">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="font-medium">{selectedChannel?.title || 'Pilih channel'}</div>
                                <div className="mt-1 text-xs text-slate-400">{selectedChannel?.groupTitle || 'Lainnya'}</div>
                            </div>
                            {selectedChannel ? (
                                <button
                                    type="button"
                                    onClick={() => toggleFavorite(selectedChannel.id)}
                                    className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/10"
                                >
                                    {favoriteIds.includes(selectedChannel.id) ? 'Unfav' : 'Fav'}
                                </button>
                            ) : null}
                        </div>
                        <div className="mt-3 grid gap-2 text-[11px] text-slate-300">
                            <div className="truncate"><span className="text-slate-400">Source:</span> {activeStreamUrl || 'n/a'}</div>
                            <div className="truncate"><span className="text-slate-400">Proxy:</span> {visibleProxiedStreamUrl || activeStreamUrl || 'n/a'}</div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto lg:pr-1">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                        <div className="grid gap-3">
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Search channel
                                </label>
                                <input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Cari nama channel atau grup"
                                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Filter grup
                                </label>
                                <select
                                    value={groupFilter}
                                    onChange={(e) => setGroupFilter(e.target.value)}
                                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                                >
                                    <option value="all">Semua grup</option>
                                    <option value="favorites">Favorit</option>
                                    {groupNames.map((groupName) => (
                                        <option key={groupName} value={groupName}>
                                            {groupName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchQuery('');
                                        setGroupFilter('all');
                                    }}
                                    className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-slate-700"
                                >
                                    Reset filter
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setGroupFilter('favorites')}
                                    className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                    Show favorites
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Daftar Channel</div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Klik channel untuk memutar. Gunakan bintang untuk favorit.
                        </div>
                    </div>

                    <div className="space-y-4">
                        {filteredChannels.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                                Tidak ada channel yang cocok dengan filter.
                            </div>
                        ) : null}
                        {groupFilter === 'all'
                            ? groupNames.map((groupName) => {
                                const groupItems = filteredChannels.filter((item) => item.groupTitle === groupName);
                                if (groupItems.length === 0) return null;

                                return (
                                    <div key={groupName} className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                                        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:text-gray-100">
                                            {groupName}
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                                            {groupItems.map((item) => {
                                                const active = selectedChannel?.id === item.id;
                                                const dashState = isDashStream(item.streamUrl) ? dashManifestCache[item.streamUrl] : null;
                                                const initials = item.title
                                                    .split(' ')
                                                    .filter(Boolean)
                                                    .slice(0, 2)
                                                    .map((word) => word[0])
                                                    .join('')
                                                    .toUpperCase();

                                                return (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        onClick={() => selectChannel(item.id)}
                                                        className={`group overflow-hidden rounded-2xl border text-left transition ${
                                                            active
                                                                ? 'border-cyan-500 bg-cyan-50 ring-2 ring-cyan-300 dark:border-cyan-400 dark:bg-cyan-950/40 dark:ring-cyan-500/40'
                                                                : 'border-gray-200 bg-gray-50 hover:border-cyan-300 hover:bg-cyan-50 dark:border-gray-700 dark:bg-gray-900/60 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-950/20'
                                                        }`}
                                                    >
                                                        <div className="relative flex aspect-square items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-3">
                                                            {item.logoUrl ? (
                                                                <img
                                                                    src={item.logoUrl}
                                                                    alt={item.title}
                                                                    className="h-full w-full rounded-xl bg-white/95 object-contain p-2 shadow-sm"
                                                                    loading="lazy"
                                                                />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center rounded-xl border border-white/20 bg-white/10 text-lg font-bold text-white">
                                                                    {initials || 'TV'}
                                                                </div>
                                                            )}
                                                            {favoriteIds.includes(item.id) ? (
                                                                <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                                                                    Fav
                                                                </span>
                                                            ) : null}
                                                            {dashState?.drmProtected ? (
                                                                <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-black">
                                                                    DRM
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <div className="p-3">
                                                            <div className="line-clamp-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                                {item.title}
                                                            </div>
                                                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                                {item.groupTitle}
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })
                            : (
                                <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                                    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                                        {filteredChannels.map((item) => {
                                            const active = selectedChannel?.id === item.id;
                                            const dashState = isDashStream(item.streamUrl) ? dashManifestCache[item.streamUrl] : null;
                                            const initials = item.title
                                                .split(' ')
                                                .filter(Boolean)
                                                .slice(0, 2)
                                                .map((word) => word[0])
                                                .join('')
                                                .toUpperCase();

                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => selectChannel(item.id)}
                                                    className={`group overflow-hidden rounded-2xl border text-left transition ${
                                                        active
                                                            ? 'border-cyan-500 bg-cyan-50 ring-2 ring-cyan-300 dark:border-cyan-400 dark:bg-cyan-950/40 dark:ring-cyan-500/40'
                                                            : 'border-gray-200 bg-gray-50 hover:border-cyan-300 hover:bg-cyan-50 dark:border-gray-700 dark:bg-gray-900/60 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-950/20'
                                                    }`}
                                                >
                                                    <div className="relative flex aspect-square items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-3">
                                                        {item.logoUrl ? (
                                                            <img
                                                                src={item.logoUrl}
                                                                alt={item.title}
                                                                className="h-full w-full rounded-xl bg-white/95 object-contain p-2 shadow-sm"
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center rounded-xl border border-white/20 bg-white/10 text-lg font-bold text-white">
                                                                {initials || 'TV'}
                                                            </div>
                                                        )}
                                                        {favoriteIds.includes(item.id) ? (
                                                            <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                                                                Fav
                                                            </span>
                                                        ) : null}
                                                        {dashState?.drmProtected ? (
                                                            <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-black">
                                                                DRM
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <div className="p-3">
                                                        <div className="line-clamp-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                            {item.title}
                                                        </div>
                                                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                            {item.groupTitle}
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                    </div>
                </div>
            </div>

            {statusMessage ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
                    {statusMessage}
                </div>
            ) : null}

            {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                    {error}
                </div>
            ) : null}

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">Debug Stream</div>
                <div className="mt-2 space-y-1 text-[11px] text-gray-600 dark:text-gray-300">
                    <div><span className="text-gray-400">Selected:</span> {selectedChannel?.title || 'n/a'}</div>
                    <div className="break-all"><span className="text-gray-400">Source URL:</span> {activeStreamUrl || 'n/a'}</div>
                    <div className="break-all"><span className="text-gray-400">Proxy URL:</span> {visibleProxiedStreamUrl || 'n/a'}</div>
                    <div><span className="text-gray-400">Token:</span> {mediaToken ? 'ready' : mediaTokenLoading ? 'loading' : 'missing'}</div>
                    <div><span className="text-gray-400">Detect:</span> {streamProbeLoading ? 'loading' : detectedStreamKind}</div>
                </div>
                <div className="mt-3 space-y-2">
                    {requestLog.length > 0 ? requestLog.map((entry, idx) => (
                        <div key={`${entry.url}-${idx}`} className="rounded-lg border border-gray-200 px-3 py-2 text-[11px] dark:border-gray-700">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{entry.phase}</span>
                                <span className={entry.ok ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}>
                                    {entry.ok ? 'OK' : 'FAIL'}
                                </span>
                            </div>
                            <div className="mt-1 break-all text-gray-700 dark:text-gray-200">{entry.url}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-gray-500 dark:text-gray-400">
                                {typeof entry.status === 'number' ? <span>Status: {entry.status}</span> : null}
                                {entry.contentType ? <span>Type: {entry.contentType}</span> : null}
                                {entry.note ? <span>Note: {entry.note}</span> : null}
                            </div>
                        </div>
                    )) : (
                        <div className="text-xs text-gray-500 dark:text-gray-400">Belum ada log request.</div>
                    )}
                </div>
                {dashManifestCheck ? (
                    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
                        <div className="font-semibold text-gray-700 dark:text-gray-200">DASH Check</div>
                        <div className="mt-1 break-all">URL: {dashManifestCheck.checkedUrl}</div>
                        <div className="mt-1">DRM: {dashManifestCheck.drmProtected ? 'Ya' : 'Tidak'}</div>
                        <div className="mt-1">{dashManifestCheck.detail}</div>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default CustomerVideo;
