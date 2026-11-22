import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Odp, Odc, Customer, CustomerStatus } from '../../types';
import { fetchWithAuth } from '~/components/api';

// --- Types & Constants ---
export interface SimulatedNode {
    id: string;
    name: string;
    type: 'odp' | 'odc';
    parentId: string;
    parentType: 'olt' | 'odc' | 'odp';
    cableMeters: number;
    cableType: string;
    splitterType: string;
    spliceCount: number;
    connectorCount: number;
    totalPorts: number;
    calculatedPowerIn: number;
    calculatedPowerOut: number;
    status: 'OPTIMAL' | 'WARNING' | 'CRITICAL';
    address?: string;
    createdAt: string;
}

export interface TreeNode {
    id: string;
    name: string;
    type: 'olt' | 'odc' | 'odp' | 'simulated';
    parentId?: string;
    parentType?: 'olt' | 'odc' | 'odp';
    totalPorts: number;
    usedPorts: number;
    powerIn?: number | null;
    powerOut?: number | null;
    calculatedPowerIn: number;
    calculatedPowerOut: number;
    cableMeters: number;
    cableLabel: string;
    location?: { lat: number; lng: number } | null;
    address?: string;
    customers: Customer[];
    children: TreeNode[];
    isSimulated?: boolean;
    simulatedData?: SimulatedNode;
    // Position on canvas
    x: number;
    y: number;
}

const PLC_LOSS_MAP: Record<string, number> = {
    '1:2': 3.7,
    '1:4': 7.2,
    '1:8': 10.5,
    '1:16': 13.8,
    '1:32': 17.1,
    '1:64': 20.5,
    'fbt_90_10_tap': 10.5,
    'fbt_80_20_tap': 7.5,
    'fbt_70_30_tap': 5.8,
};

const SFP_PRESETS: Record<string, { label: string; powerDbm: number }> = {
    'class_b': { label: 'Class B+ (+2.5 dBm)', powerDbm: 2.5 },
    'class_c': { label: 'Class C+ (+5.0 dBm)', powerDbm: 5.0 },
    'class_c_plus': { label: 'Class C++ (+7.5 dBm)', powerDbm: 7.5 },
    'custom': { label: 'Custom TX Power', powerDbm: 5.0 },
};

const haversineMeters = (pos1?: { lat: number; lng: number } | null, pos2?: { lat: number; lng: number } | null): number | null => {
    if (!pos1 || !pos2 || !pos1.lat || !pos1.lng || !pos2.lat || !pos2.lng) return null;
    const R = 6371e3;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(pos2.lat - pos1.lat);
    const dLng = toRad(pos2.lng - pos1.lng);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(pos1.lat)) * Math.cos(toRad(pos2.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 1.25); // 1.25 routing detour factor
};

const evaluateOpticalStatus = (powerOutDbm: number): { status: 'OPTIMAL' | 'WARNING' | 'CRITICAL'; label: string; color: string; badgeBg: string } => {
    if (powerOutDbm >= -24 && powerOutDbm <= -14) {
        return { status: 'OPTIMAL', label: 'Optimal (-14 s/d -24 dBm)', color: 'text-emerald-400', badgeBg: 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' };
    }
    if (powerOutDbm < -24 && powerOutDbm >= -27) {
        return { status: 'WARNING', label: 'Waspada (-24 s/d -27 dBm)', color: 'text-amber-400', badgeBg: 'bg-amber-950/60 border-amber-500/40 text-amber-300' };
    }
    return { status: 'CRITICAL', label: 'Kritis / Redaman Buruk (< -27 dBm)', color: 'text-rose-400', badgeBg: 'bg-rose-950/60 border-rose-500/40 text-rose-300' };
};

interface FiberCalculatorProps {
    initialOdpId?: string | null;
    onBack?: () => void;
}

const FiberCalculator: React.FC<FiberCalculatorProps> = ({ initialOdpId, onBack }) => {
    // Data sources
    const [odps, setOdps] = useState<Odp[]>([]);
    const [odcs, setOdcs] = useState<Odc[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // OLT & Optical Settings
    const [sfpClass, setSfpClass] = useState<string>('class_c');
    const [customTxPower, setCustomTxPower] = useState<number>(5.0);
    const currentTxPower = sfpClass === 'custom' ? customTxPower : (SFP_PRESETS[sfpClass]?.powerDbm ?? 5.0);

    // Canvas view state
    const [zoom, setZoom] = useState<number>(1);
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 30, y: 40 });
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const canvasContainerRef = useRef<HTMLDivElement>(null);

    // Filters and UI Toggles
    const [showCustomers, setShowCustomers] = useState<boolean>(true);
    const [showAuditMode, setShowAuditMode] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [selectedOdcFilter, setSelectedOdcFilter] = useState<string>('all');
    const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);

    // Simulated / Planned Nodes State
    const [simulatedNodes, setSimulatedNodes] = useState<SimulatedNode[]>([]);
    const [isPlannerOpen, setIsPlannerOpen] = useState<boolean>(false);
    const [plannerParentId, setPlannerParentId] = useState<string>('');
    const [plannerName, setPlannerName] = useState<string>('');
    const [plannerCableMeters, setPlannerCableMeters] = useState<number>(450);
    const [plannerCableType, setPlannerCableType] = useState<string>('12C Distribusi');
    const [plannerSplitter, setPlannerSplitter] = useState<string>('1:8');
    const [plannerSplices, setPlannerSplices] = useState<number>(2);
    const [plannerConnectors, setPlannerConnectors] = useState<number>(2);
    const [plannerPorts, setPlannerPorts] = useState<number>(8);
    const [isSavingOdp, setIsSavingOdp] = useState<boolean>(false);
    const [copyNotice, setCopyNotice] = useState<string | null>(null);

    // Fetch live network data
    const fetchNetworkData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [odpRes, odcRes, custRes] = await Promise.all([
                fetchWithAuth('/api/network/odps'),
                fetchWithAuth('/api/network/odcs'),
                fetchWithAuth('/api/customers'),
            ]);
            if (!odpRes.ok || !odcRes.ok) {
                throw new Error('Gagal memuat data ODP/ODC dari server.');
            }
            const odpData = await odpRes.json();
            const odcData = await odcRes.json();
            const custData = custRes.ok ? await custRes.json() : [];
            setOdps(odpData || []);
            setOdcs(odcData || []);
            setCustomers(custData || []);
        } catch (err: any) {
            setError(err.message || 'Terjadi kesalahan saat memuat data jaringan.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchNetworkData();
    }, []);

    // Build hierarchical tree nodes
    const { tree, flattenedNodes } = useMemo(() => {
        const rootTx = currentTxPower;
        const allFlattened: TreeNode[] = [];

        // 1. Group customers by ODP
        const customersByOdp: Record<string, Customer[]> = {};
        customers.forEach((c) => {
            if (c.odpId) {
                if (!customersByOdp[c.odpId]) customersByOdp[c.odpId] = [];
                customersByOdp[c.odpId].push(c);
            }
        });

        // Maps for fast parent-child hierarchical resolution
        const odcIdSet = new Set(odcs.map((o) => o.id));
        const odcMapById = new Map(odcs.map((o) => [o.id, o]));
        const odpMapById = new Map(odps.map((o) => [o.id, o]));

        // Helper to trace any ODP's root ODC ID (whether direct parent is ODC, or cascading ODP -> ODC)
        const findRootOdcId = (parentId?: string | null): string | null => {
            let curr = parentId;
            const visited = new Set<string>();
            while (curr && !visited.has(curr)) {
                visited.add(curr);
                if (odcIdSet.has(curr)) {
                    return curr;
                }
                const parentOdp = odpMapById.get(curr);
                if (!parentOdp) break;
                curr = parentOdp.parentId;
            }
            return null;
        };

        // 2. Identify active ODC nodes
        const activeOdcs = odcs.filter((odc) => selectedOdcFilter === 'all' || odc.id === selectedOdcFilter);
        const odcNodeMap = new Map<string, TreeNode>();

        const odcNodes: TreeNode[] = activeOdcs.map((odc) => {
            const estMeters = 850;
            const cableLoss = (estMeters / 1000) * 0.35;
            const splitterLoss = 7.2; // default PLC 1:4 on ODC
            const calcPowerIn = rootTx - cableLoss;
            const calcPowerOut = calcPowerIn - splitterLoss;

            const odcNode: TreeNode = {
                id: odc.id,
                name: odc.name,
                type: 'odc',
                parentId: 'root-olt',
                parentType: 'olt',
                totalPorts: odc.totalPorts || 24,
                usedPorts: 0,
                powerIn: odc.powerInput ?? null,
                powerOut: odc.powerOutput ?? null,
                calculatedPowerIn: Number(calcPowerIn.toFixed(2)),
                calculatedPowerOut: Number(calcPowerOut.toFixed(2)),
                cableMeters: estMeters,
                cableLabel: `FDR-OLT1-${odc.name.replace(/\s+/g, '')} • 24C • ${estMeters}m`,
                location: odc.location,
                address: odc.address,
                customers: [],
                children: [],
                x: 0,
                y: 0,
            };
            odcNodeMap.set(odc.id, odcNode);
            return odcNode;
        });

        // 3. Filter and attach ODP nodes strictly belonging to selected ODC (or all if 'all')
        const odpMap = new Map<string, TreeNode>();

        const targetOdps = odps.filter((odp) => {
            if (selectedOdcFilter === 'all') return true;
            const rootOdcId = findRootOdcId(odp.parentId);
            return rootOdcId === selectedOdcFilter;
        });

        targetOdps.forEach((odp) => {
            const custs = customersByOdp[odp.id] || [];
            const parentOdc = odcMapById.get(odp.parentId || '');
            const parentOdp = odpMapById.get(odp.parentId || '');

            let distanceMeters = 420;
            if (parentOdc?.location && odp.location) {
                const dist = haversineMeters(parentOdc.location, odp.location);
                if (dist) distanceMeters = dist;
            } else if (parentOdp?.location && odp.location) {
                const dist = haversineMeters(parentOdp.location, odp.location);
                if (dist) distanceMeters = dist;
            }

            const cableLoss = (distanceMeters / 1000) * 0.35;
            const splitterLoss = PLC_LOSS_MAP[odp.totalPorts === 16 ? '1:16' : '1:8'] || 10.5;
            const spliceLoss = 0.2; // 2 splices average
            const connectorLoss = 0.5; // 2 connectors

            // Estimate power based on parent
            let parentPowerOut = rootTx - 7.5; // fallback
            if (parentOdc) {
                parentPowerOut = rootTx - ((850 / 1000) * 0.35 + 7.2);
            }

            const calcPowerIn = Number((parentPowerOut - cableLoss).toFixed(2));
            const calcPowerOut = Number((calcPowerIn - splitterLoss - spliceLoss - connectorLoss).toFixed(2));

            const node: TreeNode = {
                id: odp.id,
                name: odp.name,
                type: 'odp',
                parentId: odp.parentId || undefined,
                parentType: parentOdc ? 'odc' : parentOdp ? 'odp' : 'odc',
                totalPorts: odp.totalPorts || 8,
                usedPorts: custs.length,
                powerIn: odp.powerInput ?? null,
                powerOut: odp.powerOutput ?? null,
                calculatedPowerIn: calcPowerIn,
                calculatedPowerOut: calcPowerOut,
                cableMeters: distanceMeters,
                cableLabel: `DST • 12C • ${distanceMeters}m`,
                location: odp.location,
                address: odp.address,
                customers: custs,
                children: [],
                x: 0,
                y: 0,
            };

            odpMap.set(odp.id, node);
        });

        // 4. Attach Simulated Nodes that belong to this view
        simulatedNodes.forEach((sim) => {
            const rootOdcId = findRootOdcId(sim.parentId) || (odcIdSet.has(sim.parentId) ? sim.parentId : null);
            if (selectedOdcFilter !== 'all' && rootOdcId !== selectedOdcFilter && sim.parentId !== selectedOdcFilter) {
                return;
            }

            const node: TreeNode = {
                id: sim.id,
                name: `${sim.name} [RENCANA]`,
                type: 'simulated',
                parentId: sim.parentId,
                parentType: sim.parentType,
                totalPorts: sim.totalPorts,
                usedPorts: 0,
                powerIn: null,
                powerOut: null,
                calculatedPowerIn: sim.calculatedPowerIn,
                calculatedPowerOut: sim.calculatedPowerOut,
                cableMeters: sim.cableMeters,
                cableLabel: `DRAF • ${sim.cableType} • ${sim.cableMeters}m`,
                location: null,
                address: sim.address,
                customers: [],
                children: [],
                isSimulated: true,
                simulatedData: sim,
                x: 0,
                y: 0,
            };
            odpMap.set(sim.id, node);
        });

        // 5. Connect children to parents strictly without fallback hijacking
        const unassignedOdps: TreeNode[] = [];

        odpMap.forEach((odpNode) => {
            // Check if direct parent is an active ODC
            const odcParent = odcNodeMap.get(odpNode.parentId || '');
            if (odcParent) {
                odcParent.children.push(odpNode);
                odcParent.usedPorts += 1;
                return;
            }

            // Check if direct parent is another ODP (cascading)
            const odpParent = odpMap.get(odpNode.parentId || '');
            if (odpParent) {
                odpParent.children.push(odpNode);
                return;
            }

            // If unparented (and we are in 'all' view):
            if (selectedOdcFilter === 'all') {
                unassignedOdps.push(odpNode);
            }
        });

        // Root Node OLT
        const rootOltNode: TreeNode = {
            id: 'root-olt',
            name: 'OLT-PUSAT',
            type: 'olt',
            totalPorts: 16,
            usedPorts: odcNodes.length,
            powerIn: null,
            powerOut: rootTx,
            calculatedPowerIn: rootTx,
            calculatedPowerOut: rootTx,
            cableMeters: 0,
            cableLabel: 'ROOT SFP TX',
            customers: [],
            children: [...odcNodes],
            x: 50,
            y: 0,
        };

        // If in 'all' view and there are unparented ODPs, add a clean distinct branch for them
        if (unassignedOdps.length > 0 && selectedOdcFilter === 'all') {
            const unassignedGroupNode: TreeNode = {
                id: 'unassigned-odp-group',
                name: 'ODP Belum Dipetakan',
                type: 'odc',
                parentId: 'root-olt',
                parentType: 'olt',
                totalPorts: unassignedOdps.length,
                usedPorts: unassignedOdps.length,
                powerIn: null,
                powerOut: null,
                calculatedPowerIn: rootTx,
                calculatedPowerOut: Number((rootTx - 7.5).toFixed(2)),
                cableMeters: 300,
                cableLabel: 'UNMAPPED • Jalur Bebas',
                customers: [],
                children: unassignedOdps,
                x: 0,
                y: 0,
            };
            rootOltNode.children.push(unassignedGroupNode);
        }

        // 6. Compute 2D layout coordinates (Level X, Subtree Y)
        const COLUMN_WIDTH = 340;
        let currentY = 50;

        const assignPositions = (node: TreeNode, depth: number) => {
            node.x = 50 + depth * COLUMN_WIDTH;

            if (node.children.length === 0) {
                // Leaf node height considers its customers
                const custRows = showCustomers ? Math.max(1, node.customers.length) : 1;
                const nodeHeight = Math.max(110, custRows * 42 + 20);
                node.y = currentY + nodeHeight / 2;
                currentY += nodeHeight + 35;
                allFlattened.push(node);
                return;
            }

            // Internal node: position children first, then center parent vertically
            const childYPositions: number[] = [];
            node.children.forEach((child) => {
                assignPositions(child, depth + 1);
                childYPositions.push(child.y);
            });

            const minY = Math.min(...childYPositions);
            const maxY = Math.max(...childYPositions);
            node.y = (minY + maxY) / 2;
            allFlattened.push(node);
        };

        assignPositions(rootOltNode, 0);

        return { tree: rootOltNode, flattenedNodes: allFlattened };
    }, [odps, odcs, customers, currentTxPower, selectedOdcFilter, simulatedNodes, showCustomers]);

    // Set initial selected node if odpId passed
    useEffect(() => {
        if (initialOdpId && flattenedNodes.length > 0) {
            const found = flattenedNodes.find((n) => n.id === initialOdpId);
            if (found) setSelectedNode(found);
        }
    }, [initialOdpId, flattenedNodes]);

    // Canvas Mouse Dragging & Panning
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.interactive-node, button, input, select')) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        setPan({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y,
        });
    };

    const handleMouseUp = () => setIsDragging(false);

    // Zoom handlers
    const handleZoomIn = () => setZoom((prev) => Math.min(1.6, prev + 0.15));
    const handleZoomOut = () => setZoom((prev) => Math.max(0.4, prev - 0.15));
    const handleResetZoom = () => {
        setZoom(1);
        setPan({ x: 30, y: 40 });
    };

    // Calculate real-time simulation in planner drawer
    const plannerCalculations = useMemo(() => {
        // Find parent node
        const parent = flattenedNodes.find((n) => n.id === plannerParentId) || tree;
        const parentOutPower = parent.type === 'olt' ? currentTxPower : (parent.calculatedPowerOut || -7.5);

        const cableLoss = (plannerCableMeters / 1000) * 0.35;
        const splitterLoss = PLC_LOSS_MAP[plannerSplitter] || 10.5;
        const spliceLoss = plannerSplices * 0.1;
        const connLoss = plannerConnectors * 0.25;

        const totalAdditionalLoss = cableLoss + splitterLoss + spliceLoss + connLoss;
        const estPowerIn = Number((parentOutPower - cableLoss).toFixed(2));
        const estPowerOut = Number((estPowerIn - splitterLoss - spliceLoss - connLoss).toFixed(2));
        const optStatus = evaluateOpticalStatus(estPowerOut);

        return {
            parentOutPower,
            cableLoss: Number(cableLoss.toFixed(2)),
            splitterLoss,
            spliceLoss: Number(spliceLoss.toFixed(2)),
            connLoss: Number(connLoss.toFixed(2)),
            totalAdditionalLoss: Number(totalAdditionalLoss.toFixed(2)),
            estPowerIn,
            estPowerOut,
            optStatus,
        };
    }, [plannerParentId, plannerCableMeters, plannerSplitter, plannerSplices, plannerConnectors, currentTxPower, flattenedNodes, tree]);

    // Action: Add Simulated Node to Diagram
    const handleAddSimulatedNode = () => {
        if (!plannerName.trim()) {
            alert('Masukkan nama ODP/cabang rencana.');
            return;
        }

        const parent = flattenedNodes.find((n) => n.id === plannerParentId) || tree;
        const newSimNode: SimulatedNode = {
            id: `SIM-${Date.now()}`,
            name: plannerName.trim(),
            type: 'odp',
            parentId: parent.id,
            parentType: parent.type === 'odc' ? 'odc' : parent.type === 'odp' ? 'odp' : 'olt',
            cableMeters: plannerCableMeters,
            cableType: plannerCableType,
            splitterType: plannerSplitter,
            spliceCount: plannerSplices,
            connectorCount: plannerConnectors,
            totalPorts: plannerPorts,
            calculatedPowerIn: plannerCalculations.estPowerIn,
            calculatedPowerOut: plannerCalculations.estPowerOut,
            status: plannerCalculations.optStatus.status,
            createdAt: new Date().toISOString(),
        };

        setSimulatedNodes((prev) => [...prev, newSimNode]);
        setIsPlannerOpen(false);
        setPlannerName('');
    };

    // Action: Commit Simulated Node to Official Database
    const handleCommitToDatabase = async () => {
        if (!plannerName.trim()) {
            alert('Masukkan nama ODP rencana.');
            return;
        }

        setIsSavingOdp(true);
        try {
            const parent = flattenedNodes.find((n) => n.id === plannerParentId);
            const res = await fetchWithAuth('/api/network/odps', {
                method: 'POST',
                body: JSON.stringify({
                    name: plannerName.trim(),
                    parentId: parent?.id || null,
                    totalPorts: plannerPorts,
                    powerInput: plannerCalculations.estPowerIn,
                    powerOutput: plannerCalculations.estPowerOut,
                    address: `Simulasi tarikan dari ${parent?.name || 'OLT'} (${plannerCableMeters}m)`,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || 'Gagal menyimpan ODP baru ke database.');
            }

            await fetchNetworkData();
            setIsPlannerOpen(false);
            setPlannerName('');
            alert(`Sukses! ${plannerName.trim()} berhasil resmi ditambahkan ke database ODP.`);
        } catch (err: any) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsSavingOdp(false);
        }
    };

    // Remove simulated node
    const handleRemoveSimulatedNode = (simId: string) => {
        setSimulatedNodes((prev) => prev.filter((s) => s.id !== simId));
        if (selectedNode?.id === simId) setSelectedNode(null);
    };

    // Copy NOC / WhatsApp Report
    const handleCopyReport = () => {
        const textLines = [
            `*LAPORAN TOPOLOGI FO & BUDGETING ISP*`,
            `Tanggal: ${new Date().toLocaleString('id-ID')}`,
            `SFP OLT TX: ${currentTxPower} dBm`,
            `Total ODC: ${odcs.length} unit`,
            `Total ODP: ${odps.length} unit (Simulasi Tambahan: ${simulatedNodes.length})`,
            `Total Pelanggan Terpasang: ${customers.length} user`,
            '',
            `*DAFTAR NODE OPTIK & REDAMAN:*`,
        ];

        flattenedNodes.forEach((node) => {
            if (node.type === 'olt') return;
            const statusLabel = evaluateOpticalStatus(node.calculatedPowerOut).label;
            const actualStr = node.powerOut != null ? ` | OPM Riil: ${node.powerOut} dBm` : '';
            textLines.push(`• [${node.type.toUpperCase()}] ${node.name} (${node.usedPorts}/${node.totalPorts} Port) -> Desain: ${node.calculatedPowerOut} dBm${actualStr} [${statusLabel}]`);
        });

        navigator.clipboard.writeText(textLines.join('\n')).then(() => {
            setCopyNotice('Laporan skematik berhasil disalin ke clipboard!');
            setTimeout(() => setCopyNotice(null), 3500);
        });
    };

    return (
        <div className="space-y-4">
            {/* Top Header Card */}
            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 shadow-xl text-white">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-slate-800">
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="p-2 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 shadow-lg shadow-cyan-500/20 text-white">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </span>
                            <div>
                                <h2 className="text-xl font-black tracking-tight text-slate-100 flex items-center gap-2">
                                    <span>FO Network Topology & Budgeting Planner</span>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-mono">
                                        NOC Interactive Tree
                                    </span>
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Peta visual skematik jalur OLT &rarr; ODC &rarr; ODP &rarr; Pelanggan. Desain jalur tarikan baru & evaluasi redaman optik riil vs teoritis.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                            >
                                Kembali ke ODP
                            </button>
                        )}
                        <button
                            onClick={handleCopyReport}
                            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 transition-colors flex items-center gap-1.5"
                            title="Salin ringkasan laporan ke WhatsApp"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 4.315 1.731 6.086l.107.192-.533 1.955 1.976-.518.188.112z" />
                            </svg>
                            <span>Salin Laporan WA</span>
                        </button>
                        <button
                            onClick={() => {
                                setPlannerParentId(odcs[0]?.id || 'root-olt');
                                setPlannerName(`ODP-BARU-${odps.length + 1}`);
                                setIsPlannerOpen(true);
                            }}
                            className="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/25 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                            </svg>
                            <span>+ Rencanakan Tarikan ODP</span>
                        </button>
                    </div>
                </div>

                {/* Sub-toolbar Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-xs">
                    {/* Left: OLT Power & Filter */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl">
                            <span className="text-slate-400">SFP OLT TX:</span>
                            <select
                                value={sfpClass}
                                onChange={(e) => setSfpClass(e.target.value)}
                                className="bg-transparent text-cyan-300 font-semibold focus:outline-none cursor-pointer"
                            >
                                {Object.entries(SFP_PRESETS).map(([k, v]) => (
                                    <option key={k} value={k} className="bg-slate-900 text-white">
                                        {v.label}
                                    </option>
                                ))}
                            </select>
                            {sfpClass === 'custom' && (
                                <input
                                    type="number"
                                    step="0.1"
                                    value={customTxPower}
                                    onChange={(e) => setCustomTxPower(parseFloat(e.target.value) || 0)}
                                    className="w-16 bg-slate-800 text-white text-center rounded px-1 py-0.5 border border-slate-600 font-mono text-xs"
                                />
                            )}
                        </div>

                        {/* Filter by ODC */}
                        <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl">
                            <span className="text-slate-400">Filter ODC:</span>
                            <select
                                value={selectedOdcFilter}
                                onChange={(e) => setSelectedOdcFilter(e.target.value)}
                                className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
                            >
                                <option value="all" className="bg-slate-900 text-white">Semua ODC ({odcs.length})</option>
                                {odcs.map((o) => (
                                    <option key={o.id} value={o.id} className="bg-slate-900 text-white">
                                        {o.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Search Box */}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Cari ODP / Pelanggan..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-500 rounded-xl px-3 py-1.5 w-48 sm:w-60 focus:outline-none focus:border-cyan-500 text-xs"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-1.5 text-slate-400 hover:text-white"
                                >
                                    &times;
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Right: View Toggles & Zoom Controls */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                        {/* Toggle Customer Chips */}
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl">
                            <input
                                type="checkbox"
                                checked={showCustomers}
                                onChange={(e) => setShowCustomers(e.target.checked)}
                                className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-slate-300">Tampilkan Pelanggan</span>
                        </label>

                        {/* Toggle Audit Mode */}
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl">
                            <input
                                type="checkbox"
                                checked={showAuditMode}
                                onChange={(e) => setShowAuditMode(e.target.checked)}
                                className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-slate-300">Audit OPM vs Desain</span>
                        </label>

                        {/* Zoom buttons */}
                        <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-xl overflow-hidden divide-x divide-slate-800">
                            <button
                                onClick={handleZoomOut}
                                className="px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 font-bold"
                                title="Zoom Out (-)"
                            >
                                &minus;
                            </button>
                            <span className="px-2 py-1.5 font-mono text-[11px] text-slate-400">
                                {Math.round(zoom * 100)}%
                            </span>
                            <button
                                onClick={handleZoomIn}
                                className="px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 font-bold"
                                title="Zoom In (+)"
                            >
                                +
                            </button>
                            <button
                                onClick={handleResetZoom}
                                className="px-2 py-1.5 hover:bg-slate-800 text-xs text-cyan-400"
                                title="Reset Zoom"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {copyNotice && (
                <div className="bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between">
                    <span>{copyNotice}</span>
                    <button onClick={() => setCopyNotice(null)} className="text-emerald-400 font-bold ml-2">&times;</button>
                </div>
            )}

            {error && (
                <div className="bg-rose-950/80 border border-rose-500/50 text-rose-200 px-4 py-3 rounded-xl text-xs">
                    {error}
                </div>
            )}

            {/* Interactive Schematic Diagram Canvas */}
            <div
                ref={canvasContainerRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                className="relative w-full h-[680px] bg-[#070b14] border border-slate-800/90 rounded-2xl overflow-hidden select-none cursor-grab active:cursor-grabbing shadow-2xl"
                style={{
                    backgroundImage: `radial-gradient(circle, rgba(148, 163, 184, 0.08) 1px, transparent 1px)`,
                    backgroundSize: '24px 24px',
                }}
            >
                {isLoading && (
                    <div className="absolute inset-0 bg-[#070b14]/80 backdrop-blur-sm z-50 flex items-center justify-center text-cyan-400 text-sm font-semibold">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Memuat Topologi Fiber Optic & Pelanggan...
                    </div>
                )}

                {/* SVG Connections Layer */}
                <div
                    className="absolute inset-0 origin-top-left transition-transform duration-75"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    }}
                >
                    <svg className="absolute top-0 left-0 w-[4200px] h-[3600px] pointer-events-none">
                        <defs>
                            <linearGradient id="grad-feeder" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.9" />
                            </linearGradient>
                            <linearGradient id="grad-distribution" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.7" />
                                <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.9" />
                            </linearGradient>
                            <linearGradient id="grad-simulated" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.8" />
                                <stop offset="100%" stopColor="#ec4899" stopOpacity="0.8" />
                            </linearGradient>
                        </defs>

                        {/* Render links between parents and children */}
                        {flattenedNodes.map((parent) =>
                            parent.children.map((child) => {
                                const startX = parent.x + (parent.type === 'olt' ? 160 : parent.type === 'odc' ? 200 : 180);
                                const startY = parent.y;
                                const endX = child.x;
                                const endY = child.y;
                                const dx = endX - startX;
                                const midX = startX + dx * 0.5;

                                const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
                                const isSim = child.isSimulated;

                                return (
                                    <g key={`edge-${parent.id}-${child.id}`}>
                                        {/* Background glow path */}
                                        <path
                                            d={pathD}
                                            fill="none"
                                            stroke={isSim ? '#f59e0b' : child.type === 'odc' ? '#06b6d4' : '#14b8a6'}
                                            strokeWidth={isSim ? 2.5 : 2}
                                            strokeDasharray={isSim ? '6 4' : 'none'}
                                            opacity={0.7}
                                        />
                                        {/* Label badge in the middle of link */}
                                        <rect
                                            x={midX - 70}
                                            y={(startY + endY) / 2 - 11}
                                            width={140}
                                            height={22}
                                            rx={11}
                                            fill="#0b1324"
                                            stroke={isSim ? '#f59e0b' : '#334155'}
                                            strokeWidth={1}
                                        />
                                        <text
                                            x={midX}
                                            y={(startY + endY) / 2 + 3}
                                            textAnchor="middle"
                                            fill={isSim ? '#fcd34d' : '#94a3b8'}
                                            fontSize="9"
                                            fontFamily="monospace"
                                            fontWeight="600"
                                        >
                                            {child.cableLabel}
                                        </text>
                                    </g>
                                );
                            })
                        )}

                        {/* Render links to Customers */}
                        {showCustomers &&
                            flattenedNodes.map((odp) => {
                                if (odp.type !== 'odp' || odp.customers.length === 0) return null;
                                const startX = odp.x + 180;
                                const startY = odp.y;

                                return odp.customers.map((cust, idx) => {
                                    const custX = odp.x + 320;
                                    const custY = odp.y - (odp.customers.length * 20) + idx * 42 + 20;
                                    const dx = custX - startX;
                                    const midX = startX + dx * 0.5;
                                    const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${custY}, ${custX} ${custY}`;
                                    const strokeColor =
                                        cust.status === CustomerStatus.Active
                                            ? '#10b981'
                                            : cust.status === CustomerStatus.Inactive
                                            ? '#f43f5e'
                                            : '#f59e0b';

                                    return (
                                        <path
                                            key={`cust-edge-${cust.id}`}
                                            d={pathD}
                                            fill="none"
                                            stroke={strokeColor}
                                            strokeWidth={1.5}
                                            strokeDasharray="4 3"
                                            opacity={0.65}
                                        />
                                    );
                                });
                            })}
                    </svg>

                    {/* HTML Node Cards Layer */}
                    <div className="absolute top-0 left-0 w-[4200px] h-[3600px] pointer-events-none">
                        {flattenedNodes.map((node) => {
                            const isSelected = selectedNode?.id === node.id;
                            const isSearchMatch = searchQuery
                                ? node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                  node.customers.some((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                : false;

                            // Deviation check
                            const hasDeviation =
                                showAuditMode &&
                                node.powerOut != null &&
                                Math.abs(node.powerOut - node.calculatedPowerOut) > 2.5;

                            if (node.type === 'olt') {
                                return (
                                    <div
                                        key={node.id}
                                        onClick={() => setSelectedNode(node)}
                                        className={`interactive-node pointer-events-auto absolute p-4 rounded-2xl bg-gradient-to-b from-[#161f36] to-[#0f172a] border-2 transition-all cursor-pointer shadow-xl ${
                                            isSelected
                                                ? 'border-amber-400 ring-4 ring-amber-500/20 shadow-amber-500/30'
                                                : 'border-amber-500/70 hover:border-amber-400 shadow-amber-500/10'
                                        }`}
                                        style={{
                                            left: `${node.x}px`,
                                            top: `${node.y - 45}px`,
                                            width: '180px',
                                        }}
                                    >
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40">
                                                OLT • {node.usedPorts}/{node.totalPorts}
                                            </span>
                                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                                        </div>
                                        <div className="font-extrabold text-sm text-slate-100 tracking-tight">{node.name}</div>
                                        <div className="text-[11px] font-mono text-cyan-300 mt-0.5">
                                            Root Tx: +{node.powerOut} dBm
                                        </div>
                                    </div>
                                );
                            }

                            if (node.type === 'odc') {
                                return (
                                    <div
                                        key={node.id}
                                        onClick={() => setSelectedNode(node)}
                                        className={`interactive-node pointer-events-auto absolute p-3.5 rounded-2xl bg-[#0f192e] border transition-all cursor-pointer shadow-lg ${
                                            isSelected
                                                ? 'border-cyan-400 ring-4 ring-cyan-500/20 shadow-cyan-500/30'
                                                : 'border-cyan-500/50 hover:border-cyan-400 shadow-cyan-500/10'
                                        } ${isSearchMatch ? 'ring-2 ring-yellow-400' : ''}`}
                                        style={{
                                            left: `${node.x}px`,
                                            top: `${node.y - 45}px`,
                                            width: '210px',
                                        }}
                                    >
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
                                                ODC • {node.usedPorts}/{node.totalPorts}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPlannerParentId(node.id);
                                                    setPlannerName(`ODP-BARU-${odps.length + 1}`);
                                                    setIsPlannerOpen(true);
                                                }}
                                                className="text-[10px] bg-cyan-900/60 hover:bg-cyan-800 text-cyan-200 px-1.5 py-0.5 rounded border border-cyan-700/50"
                                                title="Tarik ODP Baru dari ODC ini"
                                            >
                                                + Tarik ODP
                                            </button>
                                        </div>
                                        <div className="font-bold text-sm text-slate-100 truncate" title={node.name}>
                                            {node.name}
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] font-mono mt-1 pt-1 border-t border-slate-800/80 text-slate-400">
                                            <span>Est. Power:</span>
                                            <span className="text-cyan-400 font-bold">{node.calculatedPowerOut} dBm</span>
                                        </div>
                                    </div>
                                );
                            }

                            // ODP & Simulated Node
                            const isSim = node.isSimulated;
                            const optEval = evaluateOpticalStatus(node.calculatedPowerOut);

                            return (
                                <React.Fragment key={node.id}>
                                    <div
                                        onClick={() => setSelectedNode(node)}
                                        className={`interactive-node pointer-events-auto absolute p-3.5 rounded-2xl bg-[#0b1424] border transition-all cursor-pointer shadow-lg ${
                                            isSim
                                                ? 'border-2 border-dashed border-amber-400 shadow-amber-500/20'
                                                : isSelected
                                                ? 'border-teal-400 ring-4 ring-teal-500/20 shadow-teal-500/30'
                                                : 'border-teal-500/40 hover:border-teal-400 shadow-teal-500/10'
                                        } ${isSearchMatch ? 'ring-2 ring-yellow-400' : ''}`}
                                        style={{
                                            left: `${node.x}px`,
                                            top: `${node.y - 48}px`,
                                            width: '190px',
                                        }}
                                    >
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span
                                                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                                                    isSim
                                                        ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                                        : 'bg-teal-950/80 text-teal-300 border border-teal-500/40'
                                                }`}
                                            >
                                                {isSim ? 'DRAF' : 'ODP'} • {node.usedPorts}/{node.totalPorts}
                                            </span>
                                            {hasDeviation ? (
                                                <span
                                                    className="text-[9px] px-1 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/50 font-bold animate-pulse"
                                                    title={`Deviasi tinggi! OPM ukur (${node.powerOut} dBm) vs Desain (${node.calculatedPowerOut} dBm)`}
                                                >
                                                    ! Bending
                                                </span>
                                            ) : (
                                                <span className={`w-2 h-2 rounded-full ${node.usedPorts >= node.totalPorts ? 'bg-rose-500' : 'bg-teal-400'}`}></span>
                                            )}
                                        </div>

                                        <div className="font-bold text-sm text-slate-100 truncate" title={node.name}>
                                            {node.name}
                                        </div>

                                        {/* Optical Level Info */}
                                        <div className="flex items-center justify-between text-[11px] font-mono mt-1 pt-1 border-t border-slate-800/80">
                                            <span className="text-slate-400">Power Out:</span>
                                            <span className={`font-bold ${optEval.color}`}>
                                                {node.calculatedPowerOut} dBm
                                            </span>
                                        </div>

                                        {node.powerOut != null && (
                                            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                                                <span>OPM Riil:</span>
                                                <span className="text-slate-200">{node.powerOut} dBm</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Render Customer Port Chips */}
                                    {showCustomers &&
                                        node.customers.map((cust, idx) => {
                                            const custX = node.x + 320;
                                            const custY = node.y - (node.customers.length * 20) + idx * 42;
                                            const portNum = idx + 1;
                                            const isActive = cust.status === CustomerStatus.Active;

                                            return (
                                                <div
                                                    key={cust.id}
                                                    className={`interactive-node pointer-events-auto absolute px-3 py-1.5 rounded-xl border text-xs shadow-sm flex items-center justify-between gap-2.5 transition-all ${
                                                        isActive
                                                            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                                                            : cust.status === CustomerStatus.Inactive
                                                            ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                                                            : 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                                                    }`}
                                                    style={{
                                                        left: `${custX}px`,
                                                        top: `${custY}px`,
                                                        width: '210px',
                                                    }}
                                                >
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <span className="font-mono font-bold text-[10px] opacity-80">
                                                            P#{portNum}
                                                        </span>
                                                        <span className="truncate font-semibold text-slate-100" title={cust.name}>
                                                            {cust.name}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] font-mono opacity-70">
                                                        {cust.pppoeUsername || cust.status}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* Floating Canvas Helper Legend */}
                <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl px-4 py-2 text-[11px] text-slate-400 flex items-center gap-4 shadow-lg pointer-events-none">
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                        <span>Feeder (24C)</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
                        <span>Distribusi (12C)</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                        <span>Pelanggan Aktif</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
                        <span>Pelanggan Suspend</span>
                    </span>
                    <span className="text-slate-500">| Geser kanvas untuk panning • Scroll untuk zoom</span>
                </div>
            </div>

            {/* Slide-over / Modal: Planner Simulator */}
            {isPlannerOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-2xl p-6 shadow-2xl text-white space-y-5 animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                            <div>
                                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                                    <span>Rencanakan Tarikan ODP Baru (FO Planner)</span>
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Simulasikan panjang kabel dan splitter sebelum memasang ODP fisik di tiang.
                                </p>
                            </div>
                            <button
                                onClick={() => setIsPlannerOpen(false)}
                                className="text-slate-400 hover:text-white text-xl font-bold"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1">
                                    Titik Sumber / Parent Node:
                                </label>
                                <select
                                    value={plannerParentId}
                                    onChange={(e) => setPlannerParentId(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                                >
                                    <optgroup label="ODC Distribusi">
                                        {odcs.map((o) => (
                                            <option key={o.id} value={o.id}>
                                                {o.name} (Output: ~-4.2 dBm)
                                            </option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Cascading dari ODP Lain">
                                        {odps.map((o) => (
                                            <option key={o.id} value={o.id}>
                                                {o.name} (Output: {o.powerOutput || '-16.8'} dBm)
                                            </option>
                                        ))}
                                    </optgroup>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1">
                                    Nama ODP Rencana:
                                </label>
                                <input
                                    type="text"
                                    value={plannerName}
                                    onChange={(e) => setPlannerName(e.target.value)}
                                    placeholder="Contoh: ODP-TBT-03"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-semibold"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1">
                                    Panjang Tarikan Kabel (Meter):
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min="10"
                                        max="15000"
                                        step="50"
                                        value={plannerCableMeters}
                                        onChange={(e) => setPlannerCableMeters(parseInt(e.target.value) || 0)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                                    />
                                    <span className="text-xs text-slate-400 font-mono">meter</span>
                                </div>
                                <span className="text-[10px] text-slate-400 mt-1 block">
                                    Loss kabel: {plannerCalculations.cableLoss} dB (rate 0.35 dB/km)
                                </span>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1">
                                    Jenis Kabel:
                                </label>
                                <select
                                    value={plannerCableType}
                                    onChange={(e) => setPlannerCableType(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                                >
                                    <option value="12C Distribusi">12 Core (Distribusi)</option>
                                    <option value="24C Feeder">24 Core (Feeder)</option>
                                    <option value="2C Dropcore">2 Core (Dropcore)</option>
                                    <option value="1C Dropcore">1 Core (Dropcore)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1">
                                    Tipe Splitter ODP:
                                </label>
                                <select
                                    value={plannerSplitter}
                                    onChange={(e) => setPlannerSplitter(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                                >
                                    <option value="1:4">PLC 1:4 (Loss 7.2 dB)</option>
                                    <option value="1:8">PLC 1:8 (Loss 10.5 dB) - Standar</option>
                                    <option value="1:16">PLC 1:16 (Loss 13.8 dB)</option>
                                    <option value="1:2">PLC 1:2 (Loss 3.7 dB)</option>
                                    <option value="fbt_90_10_tap">FBT Coupler 90:10 Tap (Loss 10.5 dB)</option>
                                    <option value="fbt_80_20_tap">FBT Coupler 80:20 Tap (Loss 7.5 dB)</option>
                                    <option value="fbt_70_30_tap">FBT Coupler 70:30 Tap (Loss 5.8 dB)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1">
                                    Jumlah Sambungan Splice & Konektor:
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <span className="text-[10px] text-slate-400">Splice (0.1 dB):</span>
                                        <input
                                            type="number"
                                            min="0"
                                            value={plannerSplices}
                                            onChange={(e) => setPlannerSplices(parseInt(e.target.value) || 0)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-center text-white"
                                        />
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-400">Konektor (0.25 dB):</span>
                                        <input
                                            type="number"
                                            min="0"
                                            value={plannerConnectors}
                                            onChange={(e) => setPlannerConnectors(parseInt(e.target.value) || 0)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-center text-white"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1">
                                    Kapasitas Port ODP:
                                </label>
                                <select
                                    value={plannerPorts}
                                    onChange={(e) => setPlannerPorts(parseInt(e.target.value) || 8)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                                >
                                    <option value={8}>8 Port</option>
                                    <option value={16}>16 Port</option>
                                    <option value={4}>4 Port</option>
                                </select>
                            </div>
                        </div>

                        {/* Real-time Calculation Result Box */}
                        <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 space-y-3">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-400 font-semibold uppercase tracking-wider">Hasil Perhitungan Power Budgeting</span>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${plannerCalculations.optStatus.badgeBg}`}>
                                    {plannerCalculations.optStatus.label}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                                <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                                    <span className="text-[10px] text-slate-400 block">Daya Sumber (In)</span>
                                    <span className="text-sm font-bold text-slate-100">{plannerCalculations.parentOutPower} dBm</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                                    <span className="text-[10px] text-slate-400 block">Loss Tarikan Kabel</span>
                                    <span className="text-sm font-bold text-amber-400">-{plannerCalculations.cableLoss} dB</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                                    <span className="text-[10px] text-slate-400 block">Loss Splitter ODP</span>
                                    <span className="text-sm font-bold text-amber-400">-{plannerCalculations.splitterLoss} dB</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                                    <span className="text-[10px] text-slate-400 block">Est. Daya Output ODP</span>
                                    <span className={`text-base font-black ${plannerCalculations.optStatus.color}`}>
                                        {plannerCalculations.estPowerOut} dBm
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setIsPlannerOpen(false)}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={handleAddSimulatedNode}
                                className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-500 text-white shadow-md transition-colors"
                            >
                                Simulasikan di Diagram
                            </button>
                            <button
                                type="button"
                                disabled={isSavingOdp}
                                onClick={handleCommitToDatabase}
                                className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/25 transition-all disabled:opacity-50"
                            >
                                {isSavingOdp ? 'Menyimpan...' : 'Terapkan & Simpan ke ODP'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Selected Node Inspector Drawer */}
            {selectedNode && (
                <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 shadow-xl text-white">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-800">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-bold text-slate-100">{selectedNode.name}</h3>
                                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                                    {selectedNode.type}
                                </span>
                                {selectedNode.isSimulated && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40">
                                        SIMULASI
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Alamat: {selectedNode.address || 'Belum diatur'} | Parent: {selectedNode.parentId || 'None'}
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            {selectedNode.isSimulated && (
                                <button
                                    onClick={() => handleRemoveSimulatedNode(selectedNode.id)}
                                    className="px-3 py-1.5 rounded-lg bg-rose-950 text-rose-300 border border-rose-500/40 text-xs font-semibold hover:bg-rose-900"
                                >
                                    Hapus Simulasi
                                </button>
                            )}
                            {selectedNode.location && (
                                <button
                                    onClick={() =>
                                        window.open(
                                            `https://www.google.com/maps?q=${selectedNode.location?.lat},${selectedNode.location?.lng}`,
                                            '_blank'
                                        )
                                    }
                                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                                >
                                    Buka Google Maps
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setPlannerParentId(selectedNode.id);
                                    setPlannerName(`ODP-CABANG-${odps.length + 1}`);
                                    setIsPlannerOpen(true);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold"
                            >
                                + Tarik Cabang Baru
                            </button>
                            <button
                                onClick={() => setSelectedNode(null)}
                                className="text-slate-400 hover:text-white text-sm px-2"
                            >
                                &times;
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 text-xs font-mono">
                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                            <span className="text-[10px] text-slate-400 block">Utilisasi Port</span>
                            <span className="text-sm font-bold text-slate-100">
                                {selectedNode.usedPorts} / {selectedNode.totalPorts} Port
                            </span>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                            <span className="text-[10px] text-slate-400 block">Daya Hitungan Desain</span>
                            <span className="text-sm font-bold text-cyan-400">
                                {selectedNode.calculatedPowerOut} dBm
                            </span>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                            <span className="text-[10px] text-slate-400 block">Daya Ukur Riil (OPM)</span>
                            <span className="text-sm font-bold text-slate-200">
                                {selectedNode.powerOut != null ? `${selectedNode.powerOut} dBm` : 'Belum diukur'}
                            </span>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                            <span className="text-[10px] text-slate-400 block">Status Akurasi Optik</span>
                            <span className={`text-xs font-bold ${evaluateOpticalStatus(selectedNode.calculatedPowerOut).color}`}>
                                {evaluateOpticalStatus(selectedNode.calculatedPowerOut).label}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FiberCalculator;
