import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Card from '../../components/common/Card';
import { fetchWithAuth } from '~/components/api';
import OltCard from '~/components/admin/OltCard';

interface OltDevice {
    id?: string;
    name: string;
    host: string;
    port?: number;
    username: string;
    password?: string;
    model?: string;
    connectionType?: 'ssh' | 'telnet' | 'snmp';
    snmpEnabled?: boolean;
    product?: string | null;
    description?: string;
    frame?: number;
    slot?: number;
    ponFrame?: number;
    ponSlot?: number;
    ponPort?: number;
    uptime?: string | null;
    status?: string;
    ontActiveCount?: number | null;
    ontDownCount?: number | null;
    unregCount?: number | null;
    location?: { lat: number; lng: number };
}

interface OntRegisterPayload {
    oltId: string;
    frame: number;
    slot: number;
    port: number;
    onuId: number;
    serial: string;
    vlan: number;
    userVlan?: number;
    gemport: number;
    servicePortId: number;
    lineProfile?: string;
    srvProfile?: string;
    description?: string;
    customerName?: string;
    services?: {
        vlan: number;
        userVlan?: number;
        gemport: number;
        servicePortId: number;
        tcontId?: number;
        vport?: number;
    }[];
    tcontProfile?: string;
    upProfile?: string;
    upLimit?: number;
    downLimit?: number;
}

interface RegisteredOnt {
    frame: number;
    slot: number;
    port: number;
    onuId: number;
    serial: string;
    status: string;
    powerRx?: number | null;
    customerName?: string;
    snmpIndex?: string;
}

interface UnregisteredOnt {
    frame: number;
    slot: number;
    port: number;
    detectedOnuId: number;
    serial: string;
    powerRx?: number | null;
}

type OntAlarmType = 'rx_critical' | 'flapping';

interface OntAlarmItem {
    ontKey: string;
    frame: number;
    slot: number;
    port: number;
    onuId: number;
    type: OntAlarmType;
    severity: 'warning' | 'critical';
    message: string;
}

const OltManagement: React.FC = () => {
    const OLT_VIEW_CACHE_KEY_PREFIX = 'olt_view_cache::';
    const readPersistedOntCache = (oltId: string) => {
        if (!oltId || typeof window === 'undefined') return null;
        try {
            const raw = window.localStorage.getItem(`${OLT_VIEW_CACHE_KEY_PREFIX}${oltId}`);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return {
                registered: Array.isArray(parsed?.registered) ? parsed.registered : [],
                unregistered: Array.isArray(parsed?.unregistered) ? parsed.unregistered : [],
            } as { registered: RegisteredOnt[]; unregistered: UnregisteredOnt[] };
        } catch (_e) {
            return null;
        }
    };

    const persistOntCache = (oltId: string, payload: { registered: RegisteredOnt[]; unregistered: UnregisteredOnt[] }) => {
        if (!oltId || typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(`${OLT_VIEW_CACHE_KEY_PREFIX}${oltId}`, JSON.stringify(payload));
        } catch (_e) {
            // Ignore storage quota or serialization issues.
        }
    };

    const normalizePonPart = (value: unknown, fallback = 1) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    };

    const statusColor = (status: string) => {
        const s = (status || '').toLowerCase();
        if (s.includes('working') || s.includes('enable') || s.includes('online')) return 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-100';
        if (s.includes('down') || s.includes('offline') || s.includes('disable')) return 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-100';
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100';
    };

    const powerRxColor = (value: number | null | undefined) => {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100';
        }
        const rx = Number(value);
        if (rx < -25) return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100';
        if (rx >= -24 && rx <= -23) return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100';
        return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100';
    };

    const [devices, setDevices] = useState<OltDevice[]>([]);
    const [selected, setSelected] = useState<OltDevice | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isRegistering, setIsRegistering] = useState(false);
    const [showRegisterForm, setShowRegisterForm] = useState(false);
    const [activeUnregKey, setActiveUnregKey] = useState<string | null>(null);

    const [registerPayload, setRegisterPayload] = useState<OntRegisterPayload>({
        oltId: '',
        frame: 0,
        slot: 0,
        port: 0,
        onuId: 1,
        serial: '',
        vlan: 0,
        userVlan: undefined,
        gemport: 1,
        servicePortId: 1000,
        lineProfile: '',
        srvProfile: '',
        description: '',
        customerName: '',
        services: [
            { vlan: 0, userVlan: undefined, gemport: 1, servicePortId: 1000, tcontId: 4, vport: 1 },
        ],
        tcontProfile: '',
        upProfile: '',
        upLimit: undefined,
        downLimit: undefined,
    });
    const [registeredOnts, setRegisteredOnts] = useState<RegisteredOnt[]>([]);
    const [unregisteredOnts, setUnregisteredOnts] = useState<UnregisteredOnt[]>([]);
    const [isLoadingReg, setIsLoadingReg] = useState(false);
    const [isLoadingUnreg, setIsLoadingUnreg] = useState(false);
    const [activeRegKey, setActiveRegKey] = useState<string | null>(null);
    const [showAllPorts, setShowAllPorts] = useState(true);
    const [selectedPon, setSelectedPon] = useState<{ frame: number; slot: number; port: number }>({ frame: 1, slot: 1, port: 1 });
    const [detailLoading, setDetailLoading] = useState<string | null>(null);
    const ontViewCacheRef = useRef<Record<string, { registered: RegisteredOnt[]; unregistered: UnregisteredOnt[] }>>({});
    const ontStatusHistoryRef = useRef<Record<string, { lastStatus: string; changes: number[] }>>({});
    const FLAP_WINDOW_MS = 10 * 60 * 1000;
    const FLAP_CHANGE_THRESHOLD = 3;
    const [activeAlarms, setActiveAlarms] = useState<OntAlarmItem[]>([]);
    const selectedPonValue = `${selectedPon.frame}/${selectedPon.slot}/${selectedPon.port}`;

    const buildOntKey = useCallback((ont: { frame: number; slot: number; port: number; onuId: number }) => (
        `${ont.frame}/${ont.slot}/${ont.port}/${ont.onuId}`
    ), []);

    const evaluateOntAlarms = useCallback((oltId: string, rows: RegisteredOnt[], recordTransition: boolean) => {
        const now = Date.now();
        const alarms: OntAlarmItem[] = [];
        const seen = new Set<string>();
        for (const ont of rows || []) {
            const ontKey = buildOntKey(ont);
            const histKey = `${oltId}::${ontKey}`;
            const currentStatus = String(ont.status || 'unknown').trim().toLowerCase();
            let hist = ontStatusHistoryRef.current[histKey];
            if (!hist) {
                hist = { lastStatus: currentStatus, changes: [] };
                ontStatusHistoryRef.current[histKey] = hist;
            } else if (recordTransition && hist.lastStatus !== currentStatus) {
                hist.changes.push(now);
                hist.lastStatus = currentStatus;
            }
            hist.changes = hist.changes.filter((ts) => now - ts <= FLAP_WINDOW_MS);

            const rx = Number(ont.powerRx);
            if (Number.isFinite(rx) && rx < -25) {
                const alarmId = `${ontKey}::rx_critical`;
                if (!seen.has(alarmId)) {
                    alarms.push({
                        ontKey,
                        frame: ont.frame,
                        slot: ont.slot,
                        port: ont.port,
                        onuId: ont.onuId,
                        type: 'rx_critical',
                        severity: 'critical',
                        message: `RX kritis ${rx} dBm`,
                    });
                    seen.add(alarmId);
                }
            }
            if (hist.changes.length >= FLAP_CHANGE_THRESHOLD) {
                const alarmId = `${ontKey}::flapping`;
                if (!seen.has(alarmId)) {
                    alarms.push({
                        ontKey,
                        frame: ont.frame,
                        slot: ont.slot,
                        port: ont.port,
                        onuId: ont.onuId,
                        type: 'flapping',
                        severity: 'warning',
                        message: `Status flapping (${hist.changes.length}x/${Math.floor(FLAP_WINDOW_MS / 60000)}m)`,
                    });
                    seen.add(alarmId);
                }
            }
        }
        setActiveAlarms(alarms);
    }, [buildOntKey]);

    const isOntActiveStatus = useCallback((status: string) => {
        const s = String(status || '').toLowerCase();
        return s.includes('working') || s.includes('online') || s.includes('enable') || s === 'up';
    }, []);

    const countOntStats = useCallback((rows: RegisteredOnt[] = []) => {
        const total = Array.isArray(rows) ? rows.length : 0;
        const active = (rows || []).filter((o) => isOntActiveStatus(o.status)).length;
        return { active, down: Math.max(0, total - active) };
    }, [isOntActiveStatus]);

    const setDeviceOntCache = useCallback((oltId: string, payload: Partial<{ registered: RegisteredOnt[]; unregistered: UnregisteredOnt[] }>) => {
        if (!oltId) return;
        const prev = ontViewCacheRef.current[oltId] || { registered: [], unregistered: [] };
        const next = {
            registered: payload.registered ?? prev.registered,
            unregistered: payload.unregistered ?? prev.unregistered,
        };
        ontViewCacheRef.current[oltId] = next;
        persistOntCache(oltId, next);
    }, []);
    const displayedRegisteredOnts = useMemo(
        () => showAllPorts
            ? registeredOnts
            : registeredOnts.filter((o) => o.frame === selectedPon.frame && o.slot === selectedPon.slot && o.port === selectedPon.port),
        [registeredOnts, showAllPorts, selectedPon.frame, selectedPon.slot, selectedPon.port]
    );

    const ponOptions = useMemo(() => {
        const map = new Map<string, { frame: number; slot: number; port: number }>();
        const addPon = (frame: number, slot: number, port: number) => {
            const f = normalizePonPart(frame, 1);
            const s = normalizePonPart(slot, 1);
            const p = normalizePonPart(port, 1);
            const key = `${f}/${s}/${p}`;
            if (!map.has(key)) {
                map.set(key, { frame: f, slot: s, port: p });
            }
        };

        // Dropdown hanya menampilkan PON yang benar-benar terdeteksi dari data ONT.
        registeredOnts.forEach((o) => addPon(o.frame, o.slot, o.port));
        unregisteredOnts.forEach((o) => addPon(o.frame, o.slot, o.port));

        return Array.from(map.values()).sort((a, b) => (
            a.frame - b.frame || a.slot - b.slot || a.port - b.port
        ));
    }, [registeredOnts, unregisteredOnts]);

    useEffect(() => {
        if (!ponOptions.length) return;
        const exists = ponOptions.some(
            (pon) => pon.frame === selectedPon.frame && pon.slot === selectedPon.slot && pon.port === selectedPon.port
        );
        if (!exists) {
            const first = ponOptions[0];
            setSelectedPon({ frame: first.frame, slot: first.slot, port: first.port });
        }
    }, [ponOptions, selectedPon.frame, selectedPon.slot, selectedPon.port]);

    const ensureServices = useCallback((payload: OntRegisterPayload) => {
        if (payload.services && payload.services.length > 0) return payload.services;
        return [{ vlan: payload.vlan || 0, userVlan: payload.userVlan, gemport: payload.gemport || 1, servicePortId: payload.servicePortId || 1000 }];
    }, []);

    const nextOnuId = useCallback(
        (frame = selectedPon.frame, slot = selectedPon.slot, port = selectedPon.port) => {
            const maxRegistered = registeredOnts
                .filter((o) => o.frame === frame && o.slot === slot && o.port === port)
                .reduce((m, o) => Math.max(m, o.onuId || 0), 0);
            const maxDetected = unregisteredOnts
                .filter((o) => o.frame === frame && o.slot === slot && o.port === port)
                .reduce((m, o) => Math.max(m, o.detectedOnuId || 0), 0);
            const maxId = Math.max(maxRegistered, maxDetected, 0);
            return maxId + 1 || 1;
        },
        [registeredOnts, unregisteredOnts, selectedPon.frame, selectedPon.slot, selectedPon.port]
    );

    const oltSummary = useMemo(() => {
        const totalRegistered = registeredOnts.length;
        const active = registeredOnts.filter((o) => isOntActiveStatus(o.status)).length;
        const down = Math.max(0, totalRegistered - active);
        const unregistered = unregisteredOnts.length;

        const rxCritical = registeredOnts.filter((o) => Number.isFinite(Number(o.powerRx)) && Number(o.powerRx) < -25).length;
        const rxWarning = registeredOnts.filter((o) => Number.isFinite(Number(o.powerRx)) && Number(o.powerRx) >= -24 && Number(o.powerRx) <= -23).length;
        const rxNominal = registeredOnts.filter((o) => Number.isFinite(Number(o.powerRx)) && Number(o.powerRx) > -23).length;
        const rxUnknown = registeredOnts.filter((o) => !Number.isFinite(Number(o.powerRx))).length;

        const ponMap = new Map<string, { total: number; active: number; down: number; criticalRx: number }>();
        registeredOnts.forEach((o) => {
            const key = `${o.frame}/${o.slot}/${o.port}`;
            const prev = ponMap.get(key) || { total: 0, active: 0, down: 0, criticalRx: 0 };
            const isActive = isOntActiveStatus(o.status);
            const criticalRx = Number.isFinite(Number(o.powerRx)) && Number(o.powerRx) < -25;
            ponMap.set(key, {
                total: prev.total + 1,
                active: prev.active + (isActive ? 1 : 0),
                down: prev.down + (isActive ? 0 : 1),
                criticalRx: prev.criticalRx + (criticalRx ? 1 : 0),
            });
        });

        const topProblemPons = Array.from(ponMap.entries())
            .map(([pon, stat]) => ({ pon, ...stat }))
            .sort((a, b) => (b.down - a.down) || (b.criticalRx - a.criticalRx) || (b.total - a.total))
            .slice(0, 5);

        return {
            totalRegistered,
            active,
            down,
            unregistered,
            rxCritical,
            rxWarning,
            rxNominal,
            rxUnknown,
            topProblemPons,
        };
    }, [registeredOnts, unregisteredOnts, isOntActiveStatus]);

    const loadDevices = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth('/api/olt/devices');
            if (!res.ok) throw new Error('Gagal memuat daftar OLT.');
            const data = await res.json();
            // Ambil info singkat (product/uptime) per OLT secara best-effort
            const withInfo = await Promise.all(
                (data || []).map(async (d: OltDevice) => {
                    const id = d.id || d.host || d.name;
                    const cachedView = readPersistedOntCache(id || '');
                    const cachedStats = countOntStats(cachedView?.registered || []);
                    const base = {
                        ...d,
                        status: d.status || 'online',
                        ontActiveCount: cachedStats.active || d.ontActiveCount || null,
                        ontDownCount: cachedStats.down || d.ontDownCount || null,
                        unregCount: typeof cachedView?.unregistered?.length === 'number'
                            ? cachedView.unregistered.length
                            : d.unregCount,
                    };
                    if (!id) return base;
                    try {
                        const info = await Promise.race([
                            fetchWithAuth(`/api/olt/${id}/info`).then(async (r) => (r.ok ? await r.json() : null)),
                            new Promise((resolve) => setTimeout(() => resolve(null), 9000)), // timeout info 9s
                        ]);
                        if (info) {
                            const derivedStatus = info.status || 'online';
                            return { ...base, product: info.product, uptime: info.uptime, status: derivedStatus, unregCount: info.unregCount ?? d.unregCount };
                        }
                        // jika info null (timeout client), anggap tetap online agar tidak flicker ke offline
                        return { ...base, status: base.status || 'online' };
                    } catch (e) {
                        // abaikan error info, gunakan base (online default)
                    }
                    return base;
                })
            );
            setDevices(withInfo);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadRegisteredOnts = useCallback(async (
        oltId: string,
        refresh = false,
        scope: 'all' | 'selected' = 'all'
    ) => {
        setIsLoadingReg(true);
        try {
            const query = scope === 'all'
                ? `allPorts=1&detail=0${refresh ? '&refresh=1' : ''}`
                : `frame=${selectedPon.frame}&slot=${selectedPon.slot}&port=${selectedPon.port}&detail=0${refresh ? '&refresh=1' : ''}`;
            const regRes = await fetchWithAuth(`/api/olt/${oltId}/onts?${query}`);
            const data = regRes.ok ? await regRes.json() : [];
            if (scope === 'selected') {
                setRegisteredOnts((prev) => {
                    const preserved = prev.filter(
                        (o) => !(o.frame === selectedPon.frame && o.slot === selectedPon.slot && o.port === selectedPon.port)
                    );
                    const merged = [...preserved, ...(Array.isArray(data) ? data : [])]
                        .sort((a, b) => (a.frame - b.frame) || (a.slot - b.slot) || (a.port - b.port) || (a.onuId - b.onuId));
                    evaluateOntAlarms(oltId, merged, true);
                    const stats = countOntStats(merged);
                    setSelected((prevSelected) => prevSelected
                        ? { ...prevSelected, ontActiveCount: stats.active, ontDownCount: stats.down }
                        : prevSelected);
                    setDevices((prevDevices) =>
                        prevDevices.map((d) => (d.id === oltId || d.host === oltId
                            ? { ...d, ontActiveCount: stats.active, ontDownCount: stats.down }
                            : d))
                    );
                    setDeviceOntCache(oltId, { registered: merged });
                    return merged;
                });
            } else {
                const normalized = Array.isArray(data) ? data : [];
                evaluateOntAlarms(oltId, normalized, true);
                const stats = countOntStats(normalized);
                setRegisteredOnts(normalized);
                setSelected((prevSelected) => prevSelected
                    ? { ...prevSelected, ontActiveCount: stats.active, ontDownCount: stats.down }
                    : prevSelected);
                setDevices((prevDevices) =>
                    prevDevices.map((d) => (d.id === oltId || d.host === oltId
                        ? { ...d, ontActiveCount: stats.active, ontDownCount: stats.down }
                        : d))
                );
                setDeviceOntCache(oltId, { registered: normalized });
            }
        } catch (err) {
            console.error('Failed to load registered ONTs', err);
            if (scope === 'all') {
                setRegisteredOnts([]);
            }
        } finally {
            setIsLoadingReg(false);
        }
    }, [countOntStats, evaluateOntAlarms, selectedPon.frame, selectedPon.slot, selectedPon.port, setDeviceOntCache]);

    const loadUnregisteredOnts = useCallback(async (oltId: string) => {
        setIsLoadingUnreg(true);
        try {
            const unregRes = await fetchWithAuth(`/api/olt/${oltId}/unregistered`);
            const data = unregRes.ok ? await unregRes.json() : [];
            setUnregisteredOnts(data);
            setDeviceOntCache(oltId, { unregistered: Array.isArray(data) ? data : [] });
            setSelected((prev) => prev ? { ...prev, unregCount: Array.isArray(data) ? data.length : 0 } : prev);
            setDevices((prev) =>
                prev.map((d) => (d.id === oltId || d.host === oltId ? { ...d, unregCount: Array.isArray(data) ? data.length : 0 } : d))
            );
        } catch (err) {
            console.error('Failed to load unregistered ONTs', err);
            setUnregisteredOnts([]);
        } finally {
            setIsLoadingUnreg(false);
        }
    }, [setDeviceOntCache]);

    const loadOnts = useCallback(async (oltId: string) => {
        // Jalankan bergantian agar tidak membuka dua sesi telnet/ssh bersamaan
        await loadRegisteredOnts(oltId);
        await loadUnregisteredOnts(oltId);
    }, [loadRegisteredOnts, loadUnregisteredOnts]);

    useEffect(() => {
        loadDevices();
    }, [loadDevices]);

    useEffect(() => {
        if (!selected?.id) return;
        loadRegisteredOnts(selected.id, false, 'all');
    }, [selected?.id, loadRegisteredOnts]);

    const handleSelect = useCallback((device: OltDevice) => {
        const deviceKey = device.id || device.host || '';
        const cached = ontViewCacheRef.current[deviceKey] || readPersistedOntCache(deviceKey);
        if (cached) {
            ontViewCacheRef.current[deviceKey] = cached;
        }
        const cachedStats = countOntStats(cached?.registered || []);
        setSelected({
            ...device,
            ontActiveCount: cachedStats.active,
            ontDownCount: cachedStats.down,
            unregCount: cached?.unregistered?.length ?? device.unregCount,
        });
        setRegisterPayload((prev) => ({ ...prev, oltId: device.id || '' }));
        setShowRegisterForm(false);
        setActiveUnregKey(null);
        setRegisteredOnts(cached?.registered || []);
        setUnregisteredOnts(cached?.unregistered || []);
        if (deviceKey) {
            evaluateOntAlarms(deviceKey, cached?.registered || [], false);
        } else {
            setActiveAlarms([]);
        }
        setShowAllPorts(true);
        setSelectedPon({
            frame: Number(device.ponFrame ?? device.frame ?? 1),
            slot: Number(device.ponSlot ?? device.slot ?? 1),
            port: Number(device.ponPort ?? 1),
        });
        setDevices((prevDevices) =>
            prevDevices.map((d) => (d.id === deviceKey || d.host === deviceKey
                ? {
                    ...d,
                    ontActiveCount: cachedStats.active,
                    ontDownCount: cachedStats.down,
                    unregCount: cached?.unregistered?.length ?? d.unregCount,
                }
                : d))
        );
        if (device.id) {
            loadUnregisteredOnts(device.id);
        }
    }, [countOntStats, evaluateOntAlarms, loadUnregisteredOnts]);

    const handleRegister = async () => {
        if (!selected?.id) return;
        setIsRegistering(true);
        setError(null);
        try {
            const payload = { ...registerPayload, services: ensureServices(registerPayload) };
            const res = await fetchWithAuth(`/api/olt/${selected.id}/register-ont`, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Registrasi ONT gagal.');
            alert(data.message || 'Registrasi ONT berhasil.');
            if (selected.id) {
                await loadOnts(selected.id);
            }
            setShowRegisterForm(false);
            setActiveUnregKey(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsRegistering(false);
        }
    };

    const handleGetRx = async (ont: RegisteredOnt) => {
        if (!selected?.id) return;
        try {
            const snmpQuery = ont.snmpIndex ? `&snmpIndex=${encodeURIComponent(ont.snmpIndex)}` : '';
            const res = await fetchWithAuth(`/api/olt/${selected.id}/onts/${ont.onuId}/power?frame=${ont.frame}&slot=${ont.slot}&port=${ont.port}${snmpQuery}`);
            const data = await res.json();
            if (res.ok) {
                setRegisteredOnts((prev) =>
                    prev.map((o) =>
                        o.onuId === ont.onuId && o.frame === ont.frame && o.slot === ont.slot && o.port === ont.port
                            ? { ...o, powerRx: data.rxPower }
                            : o
                    )
                );
            } else {
                alert(data.message || 'Gagal mengambil Rx power');
            }
        } catch (err: any) {
            alert(err.message || 'Gagal mengambil Rx power');
        }
    };

    const handleReboot = async (ont: RegisteredOnt) => {
        if (!selected?.id) return;
        if (!window.confirm(`Reboot ONT ${ont.onuId}?`)) return;
        try {
            const res = await fetchWithAuth(`/api/olt/${selected.id}/onts/${ont.onuId}/reboot?frame=${ont.frame}&slot=${ont.slot}&port=${ont.port}`, {
                method: 'POST',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Reboot gagal');
            alert(data.message || 'Perintah reboot dikirim.');
        } catch (err: any) {
            alert(err.message || 'Reboot gagal');
        }
    };

    const handleFetchDetail = async (ont: RegisteredOnt) => {
        if (!selected?.id) return;
        const key = `${ont.frame}-${ont.slot}-${ont.port}-${ont.onuId}`;
        setDetailLoading(key);
        try {
            const snmpQuery = ont.snmpIndex ? `&snmpIndex=${encodeURIComponent(ont.snmpIndex)}` : '';
            const res = await fetchWithAuth(`/api/olt/${selected.id}/onts/${ont.onuId}/detail?frame=${ont.frame}&slot=${ont.slot}&port=${ont.port}${snmpQuery}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Gagal mengambil detail ONT.');
            setRegisteredOnts((prev) =>
                prev.map((o) =>
                    o.onuId === ont.onuId && o.frame === ont.frame && o.slot === ont.slot && o.port === ont.port
                        ? { ...o, serial: data.serial || o.serial, customerName: data.customerName || o.customerName }
                        : o
                )
            );
        } catch (err: any) {
            alert(err.message || 'Gagal mengambil detail ONT');
        } finally {
            setDetailLoading(null);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setRegisterPayload((prev) => ({
            ...prev,
            [name]: ['frame', 'slot', 'port', 'onuId', 'vlan', 'userVlan', 'gemport', 'servicePortId'].includes(name)
                ? Number(value)
                : value,
        }) as any);
    };

    const handleServiceChange = (idx: number, field: 'vlan' | 'userVlan' | 'gemport' | 'servicePortId', value: number) => {
        setRegisterPayload((prev) => {
            const services = ensureServices(prev).map((s, i) => i === idx ? { ...s, [field]: value } : s);
            return { ...prev, services };
        });
    };

    const addServiceRow = () => {
        setRegisterPayload((prev) => {
            const services = ensureServices(prev);
            const last = services[services.length - 1] || { vlan: 0, userVlan: undefined, gemport: 1, servicePortId: 1000, tcontId: 4, vport: 1 };
            const newRow = {
                vlan: last.vlan,
                userVlan: last.userVlan,
                gemport: (last.gemport || 0) + 1,
                servicePortId: (last.servicePortId || 1000) + 1,
                tcontId: last.tcontId || 4,
                vport: (last.vport || last.gemport || 0) + 1,
            };
            return { ...prev, services: [...services, newRow] };
        });
    };

    const removeServiceRow = (idx: number) => {
        setRegisterPayload((prev) => {
            const services = ensureServices(prev).filter((_, i) => i !== idx);
            return { ...prev, services: services.length ? services : [{ vlan: 0, userVlan: undefined, gemport: 1, servicePortId: 1000 }] };
        });
    };

    useEffect(() => {
        if (!showRegisterForm) {
            setRegisterPayload((prev) => ({ ...prev, onuId: nextOnuId(selectedPon.frame, selectedPon.slot, selectedPon.port) }));
        }
    }, [registeredOnts, unregisteredOnts, showRegisterForm, nextOnuId, selectedPon.frame, selectedPon.slot, selectedPon.port]);

    return (
        <div className="space-y-6">
            <Card>
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Manajemen OLT</h1>
                        <p className="text-sm text-gray-600 dark:text-gray-300">Kelola OLT yang tersimpan di Settings & lakukan registrasi ONT.</p>
                    </div>
                    <button onClick={loadDevices} className="px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600">
                        Refresh
                    </button>
                </div>
                {error && <div className="text-red-600 text-sm mb-3">{error}</div>}
                {isLoading ? (
                    <p>Memuat OLT...</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {devices.map((d) => (
                            <OltCard
                                key={d.id || d.host}
                                name={d.name}
                                model={d.model}
                                product={d.product}
                                host={d.host}
                                port={d.port}
                                connectionType={d.connectionType}
                                status={d.status}
                                uptime={d.uptime}
                                description={d.description}
                                location={d.location}
                                onSelect={() => handleSelect(d)}
                            />
                        ))}
                    </div>
                )}
            </Card>


            {selected && (
                <>
                    <Card>
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Ringkasan Monitoring ONT</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">KPI diambil dari data ONT terakhir yang sudah tersinkron.</p>
                            </div>
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                                activeAlarms.length > 0
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                                    : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                            }`}>
                                Alarm Aktif: {activeAlarms.length}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                            <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-900 dark:bg-indigo-900/30">
                                <p className="text-xs text-indigo-700 dark:text-indigo-200">Total ONT</p>
                                <p className="text-xl font-bold text-indigo-900 dark:text-indigo-100">{oltSummary.totalRegistered}</p>
                            </div>
                            <div className="rounded border border-green-200 bg-green-50 px-3 py-2 dark:border-green-900 dark:bg-green-900/30">
                                <p className="text-xs text-green-700 dark:text-green-200">ONT Aktif</p>
                                <p className="text-xl font-bold text-green-900 dark:text-green-100">{oltSummary.active}</p>
                            </div>
                            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-900/30">
                                <p className="text-xs text-red-700 dark:text-red-200">ONT Down</p>
                                <p className="text-xl font-bold text-red-900 dark:text-red-100">{oltSummary.down}</p>
                            </div>
                            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-900/30">
                                <p className="text-xs text-amber-700 dark:text-amber-200">ONT Unregistered</p>
                                <p className="text-xl font-bold text-amber-900 dark:text-amber-100">{oltSummary.unregistered}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">Distribusi RX</h4>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-100 px-2 py-1">
                                        &lt; -25 dBm: <span className="font-semibold">{oltSummary.rxCritical}</span>
                                    </div>
                                    <div className="rounded bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100 px-2 py-1">
                                        -24 s/d -23 dBm: <span className="font-semibold">{oltSummary.rxWarning}</span>
                                    </div>
                                    <div className="rounded bg-cyan-50 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-100 px-2 py-1">
                                        &gt; -23 dBm: <span className="font-semibold">{oltSummary.rxNominal}</span>
                                    </div>
                                    <div className="rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 px-2 py-1">
                                        Unknown: <span className="font-semibold">{oltSummary.rxUnknown}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">Top PON Bermasalah</h4>
                                {oltSummary.topProblemPons.length === 0 ? (
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Belum ada data PON.</p>
                                ) : (
                                    <div className="space-y-1">
                                        {oltSummary.topProblemPons.map((pon) => (
                                            <div key={pon.pon} className="flex items-center justify-between rounded bg-gray-50 dark:bg-gray-800/50 px-2 py-1 text-xs">
                                                <span className="font-mono text-gray-800 dark:text-gray-100">{pon.pon}</span>
                                                <span className="text-gray-600 dark:text-gray-300">
                                                    Down: <span className="font-semibold text-red-700 dark:text-red-300">{pon.down}</span>
                                                    {' | '}
                                                    RX&lt;-25: <span className="font-semibold text-amber-700 dark:text-amber-300">{pon.criticalRx}</span>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="mt-4 rounded border border-gray-200 dark:border-gray-700 p-3">
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">Daftar Alarm Aktif</h4>
                            {activeAlarms.length === 0 ? (
                                <p className="text-xs text-gray-500 dark:text-gray-400">Tidak ada alarm aktif.</p>
                            ) : (
                                <div className="space-y-1 max-h-48 overflow-auto">
                                    {activeAlarms.slice(0, 30).map((alarm, idx) => (
                                        <div key={`${alarm.ontKey}-${alarm.type}-${idx}`} className="flex items-center justify-between rounded bg-gray-50 dark:bg-gray-800/50 px-2 py-1 text-xs">
                                            <span className="font-mono text-gray-800 dark:text-gray-100">
                                                {alarm.frame}/{alarm.slot}/{alarm.port}:{alarm.onuId}
                                            </span>
                                            <span className={`px-2 py-0.5 rounded ${
                                                alarm.severity === 'critical'
                                                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100'
                                            }`}>
                                                {alarm.message}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Card>

                    <Card>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">ONT Belum Teregistrasi</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Klik baris untuk membuka / menutup form registrasi.</p>
                            </div>
                                <button
                                    onClick={() => selected.id && loadUnregisteredOnts(selected.id)}
                                    className="px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                                >
                                    Syncron Data
                                </button>
                        </div>
        {isLoadingUnreg ? (
            <p>Memuat ONT...</p>
        ) : (
            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="bg-gradient-to-r from-indigo-100 via-blue-50 to-cyan-100 dark:from-slate-700 dark:via-slate-800 dark:to-slate-700">
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">F/S/P</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">Detected ONU</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">Serial</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">Power Rx</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {unregisteredOnts.length === 0 ? (
                                            <tr><td colSpan={4} className="px-3 py-2 text-center text-gray-500">Tidak ada ONT unregistered.</td></tr>
                                        ) : unregisteredOnts.map((o, idx) => {
                                            const key = `${o.frame}-${o.slot}-${o.port}-${o.detectedOnuId}-${idx}`;
                                            const isActive = activeUnregKey === key && showRegisterForm;
                                            return (
                                                <React.Fragment key={key}>
                                                    <tr
                                                        className="border-b dark:border-gray-700 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                                                        onClick={() => {
                                                            if (isActive) {
                                                                setShowRegisterForm(false);
                                                                setActiveUnregKey(null);
                                                                return;
                                                            }
                                                            setActiveUnregKey(key);
                                                            setRegisterPayload((prev) => ({
                                                                ...prev,
                                                                frame: o.frame,
                                                                slot: o.slot,
                                                                port: o.port,
                                                                onuId: nextOnuId(o.frame, o.slot, o.port),
                                                                serial: o.serial,
                                                                oltId: selected.id || prev.oltId,
                                                                services: ensureServices(prev).map((s, i) => i === 0 ? { ...s, vlan: s.vlan || prev.vlan || 0, userVlan: s.userVlan ?? prev.userVlan, gemport: s.gemport || prev.gemport || 1, servicePortId: s.servicePortId || prev.servicePortId || 1000 } : s),
                                                            }));
                                                            setSelectedPon({ frame: o.frame, slot: o.slot, port: o.port });
                                                            setShowRegisterForm(true);
                                                        }}
                                                    >
                                                        <td className="px-3 py-2">
                                                            <span className="inline-flex px-2 py-1 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100 font-mono text-xs">
                                                                {o.frame}/{o.slot}/{o.port}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className="inline-flex px-2 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100 font-semibold text-xs">
                                                                {o.detectedOnuId}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 font-mono text-sm text-gray-800 dark:text-gray-100">{o.serial}</td>
                                                        <td className="px-3 py-2">
                                                            <span className={`inline-flex px-2 py-1 rounded text-xs ${powerRxColor(o.powerRx)}`}>
                                                                {o.powerRx !== null && o.powerRx !== undefined ? `${o.powerRx} dBm` : '-'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                    {isActive && (
                                                        <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
                                                            <td colSpan={4} className="px-3 py-3">
                                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Frame</label>
                                                                        <input name="frame" type="number" value={registerPayload.frame} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Slot</label>
                                                                        <input name="slot" type="number" value={registerPayload.slot} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Port PON</label>
                                                                        <input name="port" type="number" value={registerPayload.port} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">ONU ID</label>
                                                                        <input name="onuId" type="number" value={registerPayload.onuId} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Serial ONT</label>
                                                                        <input name="serial" type="text" value={registerPayload.serial} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="ZTEGC8ABCDEF" />
                                                                    </div>
                                                                    <div className="md:col-span-2 lg:col-span-3">
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Layanan (VLAN / Gemport / Service-Port)</label>
                                                                            <button
                                                                                type="button"
                                                                                onClick={addServiceRow}
                                                                                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                                                            >
                                                                                + Tambah
                                                                            </button>
                                                                        </div>
                                                                        <div className="space-y-3">
                                                                            {ensureServices(registerPayload).map((svc, sIdx) => (
                                                                                <div key={sIdx} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border rounded p-2 bg-white dark:bg-gray-900/40">
                                                                                    <div>
                                                                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">VLAN</label>
                                                                                        <input type="number" value={svc.vlan} onChange={(e) => handleServiceChange(sIdx, 'vlan', Number(e.target.value))} className="w-full mt-1 px-2 py-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                                                    </div>
                                                                                    <div>
                                                                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">User VLAN</label>
                                                                                        <input type="number" value={svc.userVlan ?? ''} onChange={(e) => handleServiceChange(sIdx, 'userVlan', Number(e.target.value))} className="w-full mt-1 px-2 py-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="opsional" />
                                                                                    </div>
                                                                                    <div>
                                                                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Gemport</label>
                                                                                        <input type="number" value={svc.gemport} onChange={(e) => handleServiceChange(sIdx, 'gemport', Number(e.target.value))} className="w-full mt-1 px-2 py-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                                                    </div>
                                                                                    <div>
                                                                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Service-Port ID</label>
                                                                                        <div className="flex items-center gap-2">
                                                                                            <input type="number" value={svc.servicePortId} onChange={(e) => handleServiceChange(sIdx, 'servicePortId', Number(e.target.value))} className="w-full mt-1 px-2 py-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                                                            {ensureServices(registerPayload).length > 1 && (
                                                                                                <button type="button" onClick={() => removeServiceRow(sIdx)} className="mt-1 px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">-</button>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Service Profile (opsional)</label>
                                                                        <input name="srvProfile" type="text" value={registerPayload.srvProfile || ''} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="srv-profile name" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">TCONT Profile (opsional)</label>
                                                                        <input name="tcontProfile" type="text" value={registerPayload.tcontProfile || ''} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="profil TCONT" />
                                                                    </div>
                                                                    <div className="md:col-span-2 lg:col-span-3">
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nama Pelanggan</label>
                                                                        <input name="customerName" type="text" value={registerPayload.customerName || ''} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="Nama pelanggan (opsional)" />
                                                                    </div>
                                                                    <div className="md:col-span-2 lg:col-span-3">
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Deskripsi</label>
                                                                        <input name="description" type="text" value={registerPayload.description || ''} onChange={handleInputChange} className="w-full mt-1 px-3 py-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                                                                    </div>
                                                                    <div className="mt-4 flex justify-end items-center md:col-span-2 lg:col-span-3">
                                                                        <button
                                                                            onClick={handleRegister}
                                                                            disabled={isRegistering}
                                                                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-green-400"
                                                                        >
                                                                            {isRegistering ? 'Mendaftarkan...' : 'Register ONT'}
                                                                        </button>
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
                        )}
                    </Card>

                    <Card>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">ONT Terdaftar</h3>
                            <div className="flex items-center gap-2 text-sm">
                                <label className="inline-flex items-center gap-2 text-gray-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={showAllPorts}
                                        onChange={(e) => setShowAllPorts(e.target.checked)}
                                    />
                                    Semua Port
                                </label>
                                <label className="text-gray-700 dark:text-gray-300">PON</label>
                                <select
                                    value={selectedPonValue}
                                    onChange={(e) => {
                                        const [frame, slot, port] = e.target.value
                                            .split('/')
                                            .map((v) => normalizePonPart(v, 1));
                                        setSelectedPon({ frame, slot, port });
                                    }}
                                    disabled={showAllPorts || ponOptions.length === 0}
                                    className="min-w-[140px] px-2 py-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                >
                                    {ponOptions.length === 0 ? (
                                        <option value={selectedPonValue}>Tidak ada data PON</option>
                                    ) : (
                                        ponOptions.map((pon) => (
                                            <option key={`${pon.frame}/${pon.slot}/${pon.port}`} value={`${pon.frame}/${pon.slot}/${pon.port}`}>
                                                {pon.frame}/{pon.slot}/{pon.port}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <button
                                    onClick={() => selected.id && loadRegisteredOnts(selected.id, false, showAllPorts ? 'all' : 'selected')}
                                    className="px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                                >
                                    Tampilkan
                                </button>
                                <button
                                    onClick={() => selected.id && loadRegisteredOnts(selected.id, true, showAllPorts ? 'all' : 'selected')}
                                    className="px-3 py-2 text-sm bg-blue-200 dark:bg-blue-700 rounded hover:bg-blue-300 dark:hover:bg-blue-600"
                                >
                                    Syncron Data
                                </button>
                            </div>
                        </div>
            <div className="overflow-x-auto">
                                {isLoadingReg && (
                                    <div className="mb-2 text-xs text-blue-600 dark:text-blue-300">Memuat data ONT...</div>
                                )}
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="bg-gradient-to-r from-indigo-100 via-blue-50 to-cyan-100 dark:from-slate-700 dark:via-slate-800 dark:to-slate-700">
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">F/S/P</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">ONU ID</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">Serial</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">Nama</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">Status</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">Power Rx</th>
                                            <th className="px-3 py-2 text-left text-indigo-900 dark:text-indigo-100">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayedRegisteredOnts.length === 0 ? (
                                            <tr><td colSpan={7} className="px-3 py-2 text-center text-gray-500">Belum ada data.</td></tr>
                                        ) : displayedRegisteredOnts.map((o, idx) => {
                                            const regKey = `${o.frame}-${o.slot}-${o.port}-${o.onuId}-${idx}`;
                                            const isOpen = activeRegKey === regKey;
                                            return (
                                                <React.Fragment key={regKey}>
                                                    <tr
                                                        className="border-b dark:border-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 cursor-pointer"
                                                        onClick={() => {
                                                            const nextKey = activeRegKey === regKey ? null : regKey;
                                                            setActiveRegKey(nextKey);
                                                            if (nextKey) {
                                                                const hasDetail = Boolean((o.serial && o.serial !== '-') || (o.customerName && o.customerName !== '-'));
                                                                if (!hasDetail) {
                                                                    handleFetchDetail(o);
                                                                    handleGetRx(o);
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        <td className="px-3 py-2">
                                                            <span className="inline-flex px-2 py-1 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100 font-mono text-xs">
                                                                {o.frame}/{o.slot}/{o.port}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className="inline-flex px-2 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100 font-semibold text-xs">
                                                                {o.onuId}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="font-mono text-sm text-gray-800 dark:text-gray-100">{o.serial}</div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className="inline-flex px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 text-xs">
                                                                {o.customerName || '-'}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className={`inline-flex px-2 py-1 rounded text-xs ${statusColor(o.status)}`}>
                                                                {o.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className={`inline-flex px-2 py-1 rounded text-xs ${powerRxColor(o.powerRx)}`}>
                                                                {o.powerRx !== null && o.powerRx !== undefined ? `${o.powerRx} dBm` : '-'}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 space-x-2">
                                                            <button
                                                                className="px-2 py-1 text-xs bg-slate-600 text-white rounded hover:bg-slate-700 disabled:opacity-60"
                                                                onClick={(e) => { e.stopPropagation(); handleFetchDetail(o); }}
                                                                disabled={detailLoading === `${o.frame}-${o.slot}-${o.port}-${o.onuId}`}
                                                            >
                                                                {detailLoading === `${o.frame}-${o.slot}-${o.port}-${o.onuId}` ? '...' : 'Detail'}
                                                            </button>
                                                            <button
                                                                className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                                                onClick={(e) => { e.stopPropagation(); handleGetRx(o); }}
                                                            >
                                                                Ambil RX
                                                            </button>
                                                            <button
                                                                className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                                                onClick={(e) => { e.stopPropagation(); handleReboot(o); }}
                                                            >
                                                                Reboot
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {isOpen && (
                                                        <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
                                                            <td colSpan={7} className="px-3 py-3">
                                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                                                                    <div>
                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">Serial</div>
                                                                        <div className="font-mono">{o.serial || '-'}</div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">Nama / Equipment</div>
                                                                        <div>{o.customerName || '-'}</div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">Status</div>
                                                                        <div>{o.status}</div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">Power Rx</div>
                                                                        <div>
                                                                            <span className={`inline-flex px-2 py-1 rounded text-xs ${powerRxColor(o.powerRx)}`}>
                                                                                {o.powerRx !== null && o.powerRx !== undefined ? `${o.powerRx} dBm` : '-'}
                                                                            </span>
                                                                        </div>
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
                    </Card>

                </>
            )}
        </div>
    );
};

export default OltManagement;
