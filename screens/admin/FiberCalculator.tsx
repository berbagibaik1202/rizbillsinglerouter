import React, { useState, useMemo, useEffect } from 'react';
import Card from '../../components/common/Card';
import { Odp, Odc } from '../../types';
import { fetchWithAuth } from '~/components/api';

export type StageType = 'cable' | 'plc_splitter' | 'fbt_coupler' | 'splice' | 'connector' | 'custom_attenuator';

export interface FiberStage {
    id: string;
    type: StageType;
    name: string;
    // Cable
    lengthMeters?: number;
    attenuationPerKm?: number;
    // PLC Splitter
    plcRatio?: '1:2' | '1:4' | '1:8' | '1:16' | '1:32' | '1:64';
    // FBT Coupler
    fbtRatio?: '90:10' | '80:20' | '70:30' | '60:40' | '50:50';
    fbtPort?: 'tap' | 'through';
    // Splicing
    spliceCount?: number;
    lossPerSplice?: number;
    // Connector
    connectorCount?: number;
    lossPerConnector?: number;
    // Custom
    customLossDb?: number;
}

const PLC_LOSS_MAP: Record<string, number> = {
    '1:2': 3.7,
    '1:4': 7.2,
    '1:8': 10.5,
    '1:16': 13.8,
    '1:32': 17.1,
    '1:64': 20.5,
};

const FBT_LOSS_MAP: Record<string, { through: number; tap: number }> = {
    '90:10': { through: 0.6, tap: 10.5 },
    '80:20': { through: 1.2, tap: 7.5 },
    '70:30': { through: 1.9, tap: 5.8 },
    '60:40': { through: 2.7, tap: 4.4 },
    '50:50': { through: 3.6, tap: 3.6 },
};

const SFP_PRESETS: Record<string, { label: string; powerDbm: number }> = {
    'class_b': { label: 'Class B+ (+2.5 dBm)', powerDbm: 2.5 },
    'class_c': { label: 'Class C+ (+5.0 dBm)', powerDbm: 5.0 },
    'class_c_plus': { label: 'Class C++ (+7.5 dBm)', powerDbm: 7.5 },
    'custom': { label: 'Custom TX Power', powerDbm: 5.0 },
};

const calculateStageLoss = (stage: FiberStage): number => {
    switch (stage.type) {
        case 'cable': {
            const meters = stage.lengthMeters || 0;
            const rate = stage.attenuationPerKm ?? 0.35;
            return (meters / 1000) * rate;
        }
        case 'plc_splitter': {
            return PLC_LOSS_MAP[stage.plcRatio || '1:8'] || 10.5;
        }
        case 'fbt_coupler': {
            const ratioData = FBT_LOSS_MAP[stage.fbtRatio || '90:10'] || { through: 0.6, tap: 10.5 };
            return stage.fbtPort === 'through' ? ratioData.through : ratioData.tap;
        }
        case 'splice': {
            const count = stage.spliceCount || 0;
            const loss = stage.lossPerSplice ?? 0.1;
            return count * loss;
        }
        case 'connector': {
            const count = stage.connectorCount || 0;
            const loss = stage.lossPerConnector ?? 0.25;
            return count * loss;
        }
        case 'custom_attenuator': {
            return stage.customLossDb || 0;
        }
        default:
            return 0;
    }
};

const createPresetStages = (presetKey: string): FiberStage[] => {
    if (presetKey === 'star_2_level') {
        return [
            { id: '1', type: 'cable', name: 'Kabel Feeder OLT ke ODC', lengthMeters: 1500, attenuationPerKm: 0.35 },
            { id: '2', type: 'connector', name: 'Konektor Adaptor ODC', connectorCount: 2, lossPerConnector: 0.25 },
            { id: '3', type: 'plc_splitter', name: 'Splitter ODC (PLC 1:4)', plcRatio: '1:4' },
            { id: '4', type: 'cable', name: 'Kabel Distribusi ODC ke ODP', lengthMeters: 800, attenuationPerKm: 0.35 },
            { id: '5', type: 'splice', name: 'Fusion Splicing di ODP', spliceCount: 1, lossPerSplice: 0.1 },
            { id: '6', type: 'plc_splitter', name: 'Splitter ODP (PLC 1:8)', plcRatio: '1:8' },
            { id: '7', type: 'cable', name: 'Dropcore ke Rumah Pelanggan', lengthMeters: 150, attenuationPerKm: 0.35 },
            { id: '8', type: 'connector', name: 'Fast Connector SC/UPC (ODP & Roset)', connectorCount: 2, lossPerConnector: 0.25 },
        ];
    }
    if (presetKey === 'star_1_level') {
        return [
            { id: '1', type: 'cable', name: 'Kabel Feeder OLT ke ODP', lengthMeters: 2000, attenuationPerKm: 0.35 },
            { id: '2', type: 'splice', name: 'Fusion Splice di ODP', spliceCount: 1, lossPerSplice: 0.1 },
            { id: '3', type: 'plc_splitter', name: 'Splitter ODP (PLC 1:16)', plcRatio: '1:16' },
            { id: '4', type: 'cable', name: 'Dropcore Pelanggan', lengthMeters: 150, attenuationPerKm: 0.35 },
            { id: '5', type: 'connector', name: 'Fast Connector (ODP & Roset)', connectorCount: 2, lossPerConnector: 0.25 },
        ];
    }
    if (presetKey === 'daisy_chain') {
        return [
            { id: '1', type: 'cable', name: 'Kabel Backbone OLT ke Tiang 1', lengthMeters: 1000, attenuationPerKm: 0.35 },
            { id: '2', type: 'fbt_coupler', name: 'Coupler Tiang 1 (90:10 - Output Tap ODP)', fbtRatio: '90:10', fbtPort: 'tap' },
            { id: '3', type: 'plc_splitter', name: 'Splitter ODP 1 (PLC 1:8)', plcRatio: '1:8' },
            { id: '4', type: 'cable', name: 'Dropcore ke Pelanggan', lengthMeters: 100, attenuationPerKm: 0.35 },
            { id: '5', type: 'connector', name: 'Fast Connector SC/UPC', connectorCount: 2, lossPerConnector: 0.25 },
        ];
    }
    return [
        { id: '1', type: 'cable', name: 'Kabel Optik', lengthMeters: 1000, attenuationPerKm: 0.35 },
        { id: '2', type: 'plc_splitter', name: 'Splitter ODP', plcRatio: '1:8' },
        { id: '3', type: 'connector', name: 'Konektor Adaptor', connectorCount: 2, lossPerConnector: 0.25 },
    ];
};

interface FiberCalculatorProps {
    initialOdpId?: string | null;
    onBack?: () => void;
}

const FiberCalculator: React.FC<FiberCalculatorProps> = ({ initialOdpId, onBack }) => {
    const [sfpClass, setSfpClass] = useState<string>('class_c');
    const [customTxPower, setCustomTxPower] = useState<number>(5.0);
    const [activePreset, setActivePreset] = useState<string>('star_2_level');
    const [stages, setStages] = useState<FiberStage[]>(() => createPresetStages('star_2_level'));

    // ODP & ODC Integration
    const [odps, setOdps] = useState<Odp[]>([]);
    const [odcs, setOdcs] = useState<Odc[]>([]);
    const [selectedOdpId, setSelectedOdpId] = useState<string>(initialOdpId || '');
    const [copyNotice, setCopyNotice] = useState<string | null>(null);

    useEffect(() => {
        const loadNetworkData = async () => {
            try {
                const [odpRes, odcRes] = await Promise.allSettled([
                    fetchWithAuth('/api/network/odps'),
                    fetchWithAuth('/api/network/odcs'),
                ]);
                if (odpRes.status === 'fulfilled' && odpRes.value.ok) {
                    setOdps(await odpRes.value.json());
                }
                if (odcRes.status === 'fulfilled' && odcRes.value.ok) {
                    setOdcs(await odcRes.value.json());
                }
            } catch (err) {
                console.warn('Failed to load network infrastructure for FO Calculator:', err);
            }
        };
        loadNetworkData();
    }, []);

    // If an initial ODP is passed, auto-select it
    useEffect(() => {
        if (initialOdpId) {
            setSelectedOdpId(initialOdpId);
        }
    }, [initialOdpId]);

    const txPowerDbm = useMemo(() => {
        if (sfpClass === 'custom') return customTxPower;
        return SFP_PRESETS[sfpClass]?.powerDbm ?? 5.0;
    }, [sfpClass, customTxPower]);

    // Calculate progression stage by stage
    const calculatedProgression = useMemo(() => {
        let currentPower = txPowerDbm;
        let totalLoss = 0;

        const progression = stages.map((stage) => {
            const loss = calculateStageLoss(stage);
            totalLoss += loss;
            currentPower -= loss;

            return {
                ...stage,
                lossDb: Number(loss.toFixed(2)),
                remainingPowerDbm: Number(currentPower.toFixed(2)),
            };
        });

        return {
            progression,
            totalLossDb: Number(totalLoss.toFixed(2)),
            rxPowerDbm: Number(currentPower.toFixed(2)),
        };
    }, [stages, txPowerDbm]);

    // Status evaluation based on GPON ITU-T G.984
    const statusAssessment = useMemo(() => {
        const rx = calculatedProgression.rxPowerDbm;
        if (rx > -8) {
            return {
                level: 'overpower',
                color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/40 border-purple-400',
                badge: '⚠️ OVERPOWER (> -8 dBm)',
                label: 'Daya optik terlalu tinggi! Risiko merusak receiver optik ONU/ONT. Pasang attenuator optik.',
            };
        }
        if (rx >= -22) {
            return {
                level: 'optimal',
                color: 'text-green-700 bg-green-50 dark:bg-green-900/40 border-green-500',
                badge: '🟢 OPTIMAL (-15 s/d -22 dBm)',
                label: 'Redaman sangat ideal dan stabil. Sesuai standar performa tinggi ISP/Telco.',
            };
        }
        if (rx >= -25) {
            return {
                level: 'good',
                color: 'text-blue-700 bg-blue-50 dark:bg-blue-900/40 border-blue-400',
                badge: '🟡 AMAN & STABIL (-22 s/d -25 dBm)',
                label: 'Sinyal normal beroperasi dengan baik. Disarankan tidak banyak penambahan lekukan kabel.',
            };
        }
        if (rx >= -27) {
            return {
                level: 'warning',
                color: 'text-yellow-800 bg-yellow-50 dark:bg-yellow-900/40 border-yellow-500',
                badge: '🟠 MARGIN KRITIS (-25 s/d -27 dBm)',
                label: 'Mendekati batas sensitivitas ONT (-27 s/d -28 dBm). Rawan gangguan packet loss saat hujan/panas.',
            };
        }
        return {
            level: 'critical',
            color: 'text-red-700 bg-red-50 dark:bg-red-900/40 border-red-500',
            badge: '🔴 DI LUAR SPESIFIKASI / LOS (< -27 dBm)',
            label: 'Redaman terlalu tinggi! Internet berisiko sering putus atau LOS (Loss of Signal). Periksa sambungan atau kurangi rasio splitter.',
        };
    }, [calculatedProgression.rxPowerDbm]);

    const handleApplyPreset = (key: string) => {
        setActivePreset(key);
        setStages(createPresetStages(key));
    };

    const handleAddStage = (type: StageType) => {
        const newId = String(Date.now());
        let newStage: FiberStage;

        switch (type) {
            case 'cable':
                newStage = { id: newId, type: 'cable', name: 'Segmen Kabel Baru', lengthMeters: 500, attenuationPerKm: 0.35 };
                break;
            case 'plc_splitter':
                newStage = { id: newId, type: 'plc_splitter', name: 'Passive Splitter PLC', plcRatio: '1:8' };
                break;
            case 'fbt_coupler':
                newStage = { id: newId, type: 'fbt_coupler', name: 'Coupler FBT Asimetris', fbtRatio: '80:20', fbtPort: 'tap' };
                break;
            case 'splice':
                newStage = { id: newId, type: 'splice', name: 'Sambungan Fusion Splice', spliceCount: 1, lossPerSplice: 0.1 };
                break;
            case 'connector':
                newStage = { id: newId, type: 'connector', name: 'Fast Connector / Adapter', connectorCount: 2, lossPerConnector: 0.25 };
                break;
            case 'custom_attenuator':
                newStage = { id: newId, type: 'custom_attenuator', name: 'Attenuator Optik / Redaman Lain', customLossDb: 2.0 };
                break;
        }

        setStages(prev => [...prev, newStage]);
        setActivePreset('custom');
    };

    const handleUpdateStage = (id: string, updates: Partial<FiberStage>) => {
        setStages(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
        setActivePreset('custom');
    };

    const handleRemoveStage = (id: string) => {
        setStages(prev => prev.filter(s => s.id !== id));
        setActivePreset('custom');
    };

    const handleMoveStage = (index: number, direction: 'up' | 'down') => {
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= stages.length) return;

        setStages(prev => {
            const next = [...prev];
            const temp = next[index];
            next[index] = next[targetIndex];
            next[targetIndex] = temp;
            return next;
        });
        setActivePreset('custom');
    };

    // Copy formatted report for WhatsApp
    const handleCopyWhatsAppReport = () => {
        const lines = [
            `📊 *ESTIMASI FIBER OPTIC POWER BUDGET (FTTH)*`,
            `----------------------------------------------`,
            `📡 Sumber TX OLT : +${txPowerDbm.toFixed(2)} dBm (${SFP_PRESETS[sfpClass]?.label || 'Custom'})`,
            `📉 Total Loss : -${calculatedProgression.totalLossDb.toFixed(2)} dB`,
            `🎯 Estimasi RX ONT : *${calculatedProgression.rxPowerDbm.toFixed(2)} dBm*`,
            `🚦 Status Link : ${statusAssessment.badge}`,
            ``,
            `*Rincian Jalur Optik:*`,
            ...calculatedProgression.progression.map((p, idx) => {
                return `${idx + 1}. ${p.name} : -${p.lossDb.toFixed(2)} dB (Sisa: ${p.remainingPowerDbm.toFixed(2)} dBm)`;
            }),
            `----------------------------------------------`,
            `💡 Catatan: ${statusAssessment.label}`,
        ];

        const text = lines.join('\n');
        navigator.clipboard.writeText(text);
        setCopyNotice('Laporan berhasil disalin! Siap dipaste ke grup WhatsApp.');
        setTimeout(() => setCopyNotice(null), 3000);
    };

    // Selected ODP info
    const selectedOdp = useMemo(() => {
        return odps.find(o => o.id === selectedOdpId) || null;
    }, [odps, selectedOdpId]);

    const selectedParentOdc = useMemo(() => {
        if (!selectedOdp || !selectedOdp.parentId) return null;
        return odcs.find(o => o.id === selectedOdp.parentId) || null;
    }, [selectedOdp, odcs]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md font-semibold text-gray-700 dark:text-gray-200"
                            >
                                ← Kembali
                            </button>
                        )}
                        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Fiber Optic (FO) Power Budget Calculator
                        </h2>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Simulasi link optical loss & estimasi redaman RX ONT pelanggan dari OLT secara akurat.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCopyWhatsAppReport}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md font-semibold shadow-sm flex items-center gap-2 text-sm transition-colors"
                        title="Salin hasil estimasi ke format chat WhatsApp"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 4.315 1.731 6.086l.107.192-.533 1.955 1.976-.518.188.112z" />
                        </svg>
                        Salin Laporan WA
                    </button>
                </div>
            </div>

            {copyNotice && (
                <div className="p-3 bg-emerald-100 dark:bg-emerald-950 border border-emerald-400 text-emerald-800 dark:text-emerald-200 rounded-md text-sm font-medium animate-fadeIn">
                    {copyNotice}
                </div>
            )}

            {/* Presets & ODP Reference Bar */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card className="lg:col-span-2">
                    <div className="p-4 space-y-3">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Pilih Template / Topologi Cepat:
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <button
                                onClick={() => handleApplyPreset('star_2_level')}
                                className={`px-3 py-2 text-xs font-semibold rounded-md border text-center transition-all ${
                                    activePreset === 'star_2_level'
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                        : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                                }`}
                            >
                                🌟 Star 2-Stage<br />
                                <span className="text-[10px] opacity-80">(ODC 1:4 ➔ ODP 1:8)</span>
                            </button>
                            <button
                                onClick={() => handleApplyPreset('star_1_level')}
                                className={`px-3 py-2 text-xs font-semibold rounded-md border text-center transition-all ${
                                    activePreset === 'star_1_level'
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                        : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                                }`}
                            >
                                ⚡ Star 1-Stage<br />
                                <span className="text-[10px] opacity-80">(Langsung ODP 1:16)</span>
                            </button>
                            <button
                                onClick={() => handleApplyPreset('daisy_chain')}
                                className={`px-3 py-2 text-xs font-semibold rounded-md border text-center transition-all ${
                                    activePreset === 'daisy_chain'
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                        : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                                }`}
                            >
                                ⛓️ Daisy Chain / Bus<br />
                                <span className="text-[10px] opacity-80">(Coupler 90:10 ➔ ODP)</span>
                            </button>
                            <button
                                onClick={() => setActivePreset('custom')}
                                className={`px-3 py-2 text-xs font-semibold rounded-md border text-center transition-all ${
                                    activePreset === 'custom'
                                        ? 'bg-purple-600 border-purple-600 text-white shadow-sm'
                                        : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                                }`}
                            >
                                🛠️ Kustom Mandiri<br />
                                <span className="text-[10px] opacity-80">({stages.length} Tahapan Aktif)</span>
                            </button>
                        </div>
                    </div>
                </Card>

                {/* SFP Transmitter Configuration */}
                <Card>
                    <div className="p-4 space-y-2">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Daya Pancar SFP OLT (TX Power):
                        </label>
                        <select
                            value={sfpClass}
                            onChange={(e) => setSfpClass(e.target.value)}
                            className="w-full p-2 text-sm border rounded-md bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        >
                            {Object.entries(SFP_PRESETS).map(([key, item]) => (
                                <option key={key} value={key}>{item.label}</option>
                            ))}
                        </select>
                        {sfpClass === 'custom' && (
                            <div className="flex items-center gap-2 pt-1">
                                <input
                                    type="number"
                                    step="0.1"
                                    value={customTxPower}
                                    onChange={(e) => setCustomTxPower(parseFloat(e.target.value) || 0)}
                                    className="w-full p-1.5 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                    placeholder="Input dBm..."
                                />
                                <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">dBm</span>
                            </div>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Standar OLT ZTE/Huawei umum: <strong>+5.0 s/d +7.0 dBm (Class C+)</strong>.
                        </p>
                    </div>
                </Card>
            </div>

            {/* Main Power Meter & Result Gauge */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {/* Result Card */}
                <div className="lg:col-span-3">
                    <div className={`p-6 rounded-xl border shadow-md flex flex-col justify-between ${statusAssessment.color}`}>
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div>
                                <span className="text-xs font-bold uppercase tracking-wider opacity-80">
                                    Hasil Estimasi Daya Terima di ONT Pelanggan (RX Optical Power):
                                </span>
                                <div className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-1 flex items-baseline gap-2">
                                    <span>{calculatedProgression.rxPowerDbm.toFixed(2)}</span>
                                    <span className="text-xl font-bold opacity-80">dBm</span>
                                </div>
                            </div>
                            <div className="text-right sm:border-l sm:pl-6 border-current/20">
                                <span className="text-xs font-bold uppercase tracking-wider opacity-80">Total Optical Loss:</span>
                                <div className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                                    -{calculatedProgression.totalLossDb.toFixed(2)} <span className="text-base font-semibold">dB</span>
                                </div>
                                <span className="text-xs opacity-75">Dari sumber TX: +{txPowerDbm.toFixed(2)} dBm</span>
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-current/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <span className="inline-block px-3 py-1 rounded-full text-xs font-extrabold uppercase bg-white/70 dark:bg-black/30 shadow-sm">
                                {statusAssessment.badge}
                            </span>
                            <p className="text-xs sm:text-sm font-medium opacity-90">
                                {statusAssessment.label}
                            </p>
                        </div>
                    </div>
                </div>

                {/* ODP Quick Match Card */}
                <Card>
                    <div className="p-4 space-y-3">
                        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Cek ODP di Database:
                        </label>
                        <select
                            value={selectedOdpId}
                            onChange={(e) => setSelectedOdpId(e.target.value)}
                            className="w-full p-2 text-sm border rounded-md bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        >
                            <option value="">-- Pilih ODP Tersimpan --</option>
                            {odps.map(o => (
                                <option key={o.id} value={o.id}>{o.name} ({o.totalPorts || 8} Port)</option>
                            ))}
                        </select>
                        {selectedOdp ? (
                            <div className="text-xs space-y-1.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/40 border dark:border-gray-600">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Parent ODC:</span>
                                    <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedParentOdc?.name || '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Power In (DB):</span>
                                    <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedOdp.powerInput ? `${selectedOdp.powerInput} dBm` : 'N/A'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Power Out (DB):</span>
                                    <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedOdp.powerOutput ? `${selectedOdp.powerOutput} dBm` : 'N/A'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Kapasitas Port:</span>
                                    <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedOdp.totalPorts || 8} Port</span>
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400 italic">
                                Pilih ODP di jaringan Anda untuk membandingkan redaman aktual di lapangan dengan kalkulasi teoritis.
                            </p>
                        )}
                    </div>
                </Card>
            </div>

            {/* Stages / Chain Builder */}
            <Card>
                <div className="p-4 border-b dark:border-gray-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            <span>Tahapan Jalur Optik (Optical Link Chain)</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 font-semibold">
                                {stages.length} Segmen
                            </span>
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Ubah panjang kabel, rasio splitter, atau jumlah sambungan untuk melihat pergeseran nilai dBm secara langsung.
                        </p>
                    </div>

                    {/* Add Stage Dropdown buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-gray-500 font-medium mr-1">Tambah:</span>
                        <button
                            onClick={() => handleAddStage('cable')}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 font-medium border dark:border-gray-600 flex items-center gap-1"
                        >
                            + Kabel
                        </button>
                        <button
                            onClick={() => handleAddStage('plc_splitter')}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 font-medium border dark:border-gray-600 flex items-center gap-1"
                        >
                            + PLC Splitter
                        </button>
                        <button
                            onClick={() => handleAddStage('fbt_coupler')}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 font-medium border dark:border-gray-600 flex items-center gap-1"
                        >
                            + Coupler FBT
                        </button>
                        <button
                            onClick={() => handleAddStage('splice')}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 font-medium border dark:border-gray-600 flex items-center gap-1"
                        >
                            + Splicing
                        </button>
                        <button
                            onClick={() => handleAddStage('connector')}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 font-medium border dark:border-gray-600 flex items-center gap-1"
                        >
                            + Konektor
                        </button>
                        <button
                            onClick={() => handleAddStage('custom_attenuator')}
                            className="px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 font-medium border dark:border-gray-600 flex items-center gap-1"
                        >
                            + Attenuator
                        </button>
                    </div>
                </div>

                {/* Stages Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700/50 dark:text-gray-400">
                            <tr>
                                <th scope="col" className="px-4 py-3 w-12 text-center">#</th>
                                <th scope="col" className="px-4 py-3">Nama Segmen / Komponen</th>
                                <th scope="col" className="px-4 py-3">Parameter & Spesifikasi</th>
                                <th scope="col" className="px-4 py-3 text-right">Loss (dB)</th>
                                <th scope="col" className="px-4 py-3 text-right">Daya Sisa</th>
                                <th scope="col" className="px-4 py-3 text-right w-24">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {calculatedProgression.progression.map((stage, idx) => (
                                <tr key={stage.id} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750">
                                    <td className="px-4 py-3 text-center text-xs font-bold text-gray-400">
                                        {idx + 1}
                                    </td>
                                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                                        <input
                                            type="text"
                                            value={stage.name}
                                            onChange={(e) => handleUpdateStage(stage.id, { name: e.target.value })}
                                            className="w-full p-1 border rounded text-xs bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-medium"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        {/* Dynamic Parameter Controls based on stage type */}
                                        {stage.type === 'cable' && (
                                            <div className="flex items-center gap-2 flex-wrap text-xs">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-gray-500">Panjang:</span>
                                                    <input
                                                        type="number"
                                                        value={stage.lengthMeters ?? 500}
                                                        onChange={(e) => handleUpdateStage(stage.id, { lengthMeters: Math.max(0, parseInt(e.target.value) || 0) })}
                                                        className="w-20 p-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                        min="0"
                                                    />
                                                    <span>m</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-gray-500">Koef:</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={stage.attenuationPerKm ?? 0.35}
                                                        onChange={(e) => handleUpdateStage(stage.id, { attenuationPerKm: parseFloat(e.target.value) || 0.35 })}
                                                        className="w-16 p-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    />
                                                    <span>dB/km</span>
                                                </div>
                                            </div>
                                        )}

                                        {stage.type === 'plc_splitter' && (
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="text-gray-500">Rasio Splitter:</span>
                                                <select
                                                    value={stage.plcRatio || '1:8'}
                                                    onChange={(e) => handleUpdateStage(stage.id, { plcRatio: e.target.value as any })}
                                                    className="p-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white font-semibold"
                                                >
                                                    <option value="1:2">PLC 1:2 (~3.7 dB)</option>
                                                    <option value="1:4">PLC 1:4 (~7.2 dB)</option>
                                                    <option value="1:8">PLC 1:8 (~10.5 dB)</option>
                                                    <option value="1:16">PLC 1:16 (~13.8 dB)</option>
                                                    <option value="1:32">PLC 1:32 (~17.1 dB)</option>
                                                    <option value="1:64">PLC 1:64 (~20.5 dB)</option>
                                                </select>
                                            </div>
                                        )}

                                        {stage.type === 'fbt_coupler' && (
                                            <div className="flex items-center gap-2 text-xs flex-wrap">
                                                <span className="text-gray-500">Rasio:</span>
                                                <select
                                                    value={stage.fbtRatio || '90:10'}
                                                    onChange={(e) => handleUpdateStage(stage.id, { fbtRatio: e.target.value as any })}
                                                    className="p-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white font-semibold"
                                                >
                                                    <option value="90:10">FBT 90:10</option>
                                                    <option value="80:20">FBT 80:20</option>
                                                    <option value="70:30">FBT 70:30</option>
                                                    <option value="60:40">FBT 60:40</option>
                                                    <option value="50:50">FBT 50:50</option>
                                                </select>

                                                <span className="text-gray-500">Port Dipakai:</span>
                                                <select
                                                    value={stage.fbtPort || 'tap'}
                                                    onChange={(e) => handleUpdateStage(stage.id, { fbtPort: e.target.value as any })}
                                                    className="p-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white font-semibold"
                                                >
                                                    <option value="tap">TAP (% Kecil - Keluar ke ODP/Pelanggan)</option>
                                                    <option value="through">THROUGH (% Besar - Lanjut ke Tiang Berikutnya)</option>
                                                </select>
                                            </div>
                                        )}

                                        {stage.type === 'splice' && (
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="text-gray-500">Jumlah Titik Sambung:</span>
                                                <input
                                                    type="number"
                                                    value={stage.spliceCount ?? 1}
                                                    onChange={(e) => handleUpdateStage(stage.id, { spliceCount: Math.max(0, parseInt(e.target.value) || 0) })}
                                                    className="w-16 p-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    min="0"
                                                />
                                                <span className="text-gray-400">(@ 0.1 dB per core)</span>
                                            </div>
                                        )}

                                        {stage.type === 'connector' && (
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="text-gray-500">Jumlah Fast Connector:</span>
                                                <input
                                                    type="number"
                                                    value={stage.connectorCount ?? 2}
                                                    onChange={(e) => handleUpdateStage(stage.id, { connectorCount: Math.max(0, parseInt(e.target.value) || 0) })}
                                                    className="w-16 p-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    min="0"
                                                />
                                                <span className="text-gray-400">(@ 0.25 dB per konektor)</span>
                                            </div>
                                        )}

                                        {stage.type === 'custom_attenuator' && (
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="text-gray-500">Nilai Redaman:</span>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    value={stage.customLossDb ?? 2.0}
                                                    onChange={(e) => handleUpdateStage(stage.id, { customLossDb: Math.max(0, parseFloat(e.target.value) || 0) })}
                                                    className="w-20 p-1 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    min="0"
                                                />
                                                <span>dB</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-xs font-bold text-red-600 dark:text-red-400">
                                        -{stage.lossDb.toFixed(2)} dB
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-xs font-bold text-gray-900 dark:text-white">
                                        {stage.remainingPowerDbm.toFixed(2)} dBm
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => handleMoveStage(idx, 'up')}
                                                disabled={idx === 0}
                                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30"
                                                title="Pindah ke atas"
                                            >
                                                ▲
                                            </button>
                                            <button
                                                onClick={() => handleMoveStage(idx, 'down')}
                                                disabled={idx === stages.length - 1}
                                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30"
                                                title="Pindah ke bawah"
                                            >
                                                ▼
                                            </button>
                                            <button
                                                onClick={() => handleRemoveStage(stage.id)}
                                                className="p-1 text-red-500 hover:text-red-700 dark:hover:text-red-400"
                                                title="Hapus segmen ini"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-gray-100 dark:bg-gray-700/70 font-semibold text-gray-900 dark:text-white text-xs">
                            <tr>
                                <td colSpan={3} className="px-4 py-3 text-right uppercase tracking-wider">
                                    Total Redaman Link & Daya Sisa Akhir:
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-red-600 dark:text-red-400 font-bold">
                                    -{calculatedProgression.totalLossDb.toFixed(2)} dB
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-sm font-extrabold text-blue-600 dark:text-blue-400">
                                    {calculatedProgression.rxPowerDbm.toFixed(2)} dBm
                                </td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </Card>

            {/* Practical Reference Cheat Sheet for Field Technicians */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <div className="p-4 space-y-2">
                        <h4 className="font-bold text-sm text-gray-800 dark:text-gray-200 flex items-center gap-2">
                            <span>📖 Referensi Standar Redaman PLC Splitter</span>
                        </h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left text-gray-600 dark:text-gray-300">
                                <thead className="bg-gray-100 dark:bg-gray-700/50 uppercase font-semibold">
                                    <tr>
                                        <th className="p-2">Tipe Splitter</th>
                                        <th className="p-2">Teoritis (Logis)</th>
                                        <th className="p-2">Standar Loss Lapangan</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    <tr><td className="p-2 font-medium">1:2</td><td className="p-2">3.0 dB</td><td className="p-2 font-mono text-red-500">~ 3.6 s/d 3.8 dB</td></tr>
                                    <tr><td className="p-2 font-medium">1:4</td><td className="p-2">6.0 dB</td><td className="p-2 font-mono text-red-500">~ 7.0 s/d 7.3 dB</td></tr>
                                    <tr><td className="p-2 font-medium">1:8</td><td className="p-2">9.0 dB</td><td className="p-2 font-mono text-red-500">~ 10.2 s/d 10.6 dB</td></tr>
                                    <tr><td className="p-2 font-medium">1:16</td><td className="p-2">12.0 dB</td><td className="p-2 font-mono text-red-500">~ 13.5 s/d 14.0 dB</td></tr>
                                    <tr><td className="p-2 font-medium">1:32</td><td className="p-2">15.0 dB</td><td className="p-2 font-mono text-red-500">~ 16.8 s/d 17.5 dB</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </Card>

                <Card>
                    <div className="p-4 space-y-2">
                        <h4 className="font-bold text-sm text-gray-800 dark:text-gray-200 flex items-center gap-2">
                            <span>📐 Referensi FBT Coupler Ratio (Daisy Chain)</span>
                        </h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left text-gray-600 dark:text-gray-300">
                                <thead className="bg-gray-100 dark:bg-gray-700/50 uppercase font-semibold">
                                    <tr>
                                        <th className="p-2">Rasio Coupler</th>
                                        <th className="p-2">Through (Lanjut Tiang)</th>
                                        <th className="p-2">Tap (Masuk ODP)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    <tr><td className="p-2 font-medium">90:10 (Tiang 1)</td><td className="p-2 font-mono">~ 0.6 dB</td><td className="p-2 font-mono text-blue-600 font-bold">~ 10.5 dB</td></tr>
                                    <tr><td className="p-2 font-medium">80:20 (Tiang 2)</td><td className="p-2 font-mono">~ 1.2 dB</td><td className="p-2 font-mono text-blue-600 font-bold">~ 7.5 dB</td></tr>
                                    <tr><td className="p-2 font-medium">70:30 (Tiang 3)</td><td className="p-2 font-mono">~ 1.9 dB</td><td className="p-2 font-mono text-blue-600 font-bold">~ 5.8 dB</td></tr>
                                    <tr><td className="p-2 font-medium">60:40 (Tiang 4)</td><td className="p-2 font-mono">~ 2.7 dB</td><td className="p-2 font-mono text-blue-600 font-bold">~ 4.4 dB</td></tr>
                                    <tr><td className="p-2 font-medium">50:50 (Tiang Ujung)</td><td className="p-2 font-mono">~ 3.6 dB</td><td className="p-2 font-mono text-blue-600 font-bold">~ 3.6 dB</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default FiberCalculator;
