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

// Fiber Cable Model (Loose Tube standard)
export interface FiberCable {
    id: string;
    name: string;
    fromNodeId: string;
    toNodeId: string;
    totalCores: number; // 12, 24, 48
    tubesCount: number; // 1, 2, 4
    coresPerTube: number; // default 12
    lengthMeters: number;
    cableType: string; // 'Feeder' | 'Distribusi' | 'Dropcore'
    status?: 'ACTIVE' | 'PLANNED';
    notes?: string;
}

// Splice Joint Connection Model inside Enclosure (ODC / JB / ODP)
export interface SpliceConnection {
    id: string;
    enclosureNodeId: string;
    fromCableId: string;
    fromTubeNumber: number; // 1-based (1..N)
    fromCoreNumber: number; // 1-based (1..12)
    toCableId: string;
    toTubeNumber: number; // 1-based (1..N)
    toCoreNumber: number; // 1-based (1..12)
    lossDb: number; // e.g. 0.05
    notes?: string;
    createdAt?: string;
}

// Custom Added Node (ODC, JB, ODP, Tiang)
export interface CustomTopologyNode {
    id: string;
    name: string;
    category: 'odc' | 'jb' | 'odp' | 'tiang';
    parentId?: string;
    totalPorts: number;
    address?: string;
    powerInput?: number | null;
    powerOutput?: number | null;
    location?: { lat: number; lng: number } | null;
}

// TIA/EIA-598 Color Standard (12 standard colors)
export interface TIA598Color {
    num: number;
    name: string;
    hex: string;
    textColor: string;
}

export const TIA598_COLORS: TIA598Color[] = [
    { num: 1, name: 'Biru', hex: '#0284c7', textColor: '#ffffff' },
    { num: 2, name: 'Oranye', hex: '#ea580c', textColor: '#ffffff' },
    { num: 3, name: 'Hijau', hex: '#16a34a', textColor: '#ffffff' },
    { num: 4, name: 'Cokelat', hex: '#92400e', textColor: '#ffffff' },
    { num: 5, name: 'Abu-abu', hex: '#64748b', textColor: '#ffffff' },
    { num: 6, name: 'Putih', hex: '#f8fafc', textColor: '#0f172a' },
    { num: 7, name: 'Merah', hex: '#dc2626', textColor: '#ffffff' },
    { num: 8, name: 'Hitam', hex: '#1e293b', textColor: '#ffffff' },
    { num: 9, name: 'Kuning', hex: '#ca8a04', textColor: '#ffffff' },
    { num: 10, name: 'Ungu', hex: '#7c3aed', textColor: '#ffffff' },
    { num: 11, name: 'Pink', hex: '#db2777', textColor: '#ffffff' },
    { num: 12, name: 'Toska', hex: '#0891b2', textColor: '#ffffff' },
];

export const getTubeColor = (tubeNum: number): TIA598Color => {
    const idx = ((tubeNum - 1) % 12 + 12) % 12;
    return TIA598_COLORS[idx];
};

export const getCoreColor = (coreNum: number): TIA598Color => {
    const idx = ((coreNum - 1) % 12 + 12) % 12;
    return TIA598_COLORS[idx];
};

// Check if a specific tube and core in a cable is currently spliced
export function isCoreSpliced(
    cableId: string,
    tubeNumber: number,
    coreNumber: number,
    splices: SpliceConnection[],
    enclosureNodeId?: string
): { isSpliced: boolean; splice?: SpliceConnection } {
    const found = splices.find((s) => {
        if (enclosureNodeId && s.enclosureNodeId !== enclosureNodeId) return false;
        return (
            (s.fromCableId === cableId && s.fromTubeNumber === tubeNumber && s.fromCoreNumber === coreNumber) ||
            (s.toCableId === cableId && s.toTubeNumber === tubeNumber && s.toCoreNumber === coreNumber)
        );
    });
    return { isSpliced: !!found, splice: found };
}

// Count total unique active cores in a cable
export function countCableUsedCores(cableId: string, splices: SpliceConnection[]): number {
    const uniqueKeys = new Set<string>();
    splices.forEach((s) => {
        if (s.fromCableId === cableId) {
            uniqueKeys.add(`T${s.fromTubeNumber}-C${s.fromCoreNumber}`);
        }
        if (s.toCableId === cableId) {
            uniqueKeys.add(`T${s.toTubeNumber}-C${s.toCoreNumber}`);
        }
    });
    return uniqueKeys.size;
}

// Compute upstream trace path from a selected node up to root OLT
export function getUpstreamTracePath(
    targetNodeId: string,
    cables: FiberCable[]
): { traceNodeIds: Set<string>; traceCableIds: Set<string> } {
    const traceNodeIds = new Set<string>();
    const traceCableIds = new Set<string>();

    if (!targetNodeId) return { traceNodeIds, traceCableIds };
    traceNodeIds.add(targetNodeId);

    let queue = [targetNodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const incomingCables = cables.filter((c) => c.toNodeId === currentId);
        for (const cable of incomingCables) {
            traceCableIds.add(cable.id);
            traceNodeIds.add(cable.fromNodeId);
            if (cable.fromNodeId !== 'root-olt') {
                queue.push(cable.fromNodeId);
            }
        }
    }

    return { traceNodeIds, traceCableIds };
}

// Automatically synthesize full FiberCable objects from topology parent-child tree
export function synthesizeTopologyCables(
    persistedCables: FiberCable[] = [],
    flattenedNodes: TreeNode[] = [],
    deletedKeys: Record<string, boolean> = {}
): FiberCable[] {
    const list: FiberCable[] = [];
    const pairToCableMap = new Map<string, FiberCable>();

    // 1. First add any custom/persisted cables
    persistedCables.forEach((c) => {
        const pairKey = `${c.fromNodeId}->${c.toNodeId}`;
        if (!deletedKeys[pairKey] && !deletedKeys[c.id]) {
            list.push(c);
            pairToCableMap.set(pairKey, c);
        }
    });

    // 2. Synthesize missing cables for any parent->child connections in the tree
    flattenedNodes.forEach((parent) => {
        if (!parent.children) return;
        parent.children.forEach((child) => {
            const pairKey = `${parent.id}->${child.id}`;
            if (deletedKeys[pairKey]) return;

            if (!pairToCableMap.has(pairKey)) {
                const isFeeder = parent.type === 'olt';
                const childCode = (child.name || '').replace(/[^A-Za-z0-9]/g, '');
                const parentCode = (parent.name || '').replace(/[^A-Za-z0-9]/g, '');
                const autoName = isFeeder
                    ? `FDR-OLT1-${childCode}`
                    : `DST-${parentCode}-${childCode}`;

                if (deletedKeys[autoName]) return;

                const totalCores = isFeeder ? 24 : (child.totalPorts > 8 ? 24 : 12);
                const tubesCount = isFeeder ? 2 : Math.max(1, Math.ceil(totalCores / 12));

                const synCable: FiberCable = {
                    id: autoName,
                    name: autoName,
                    fromNodeId: parent.id,
                    toNodeId: child.id,
                    totalCores,
                    tubesCount,
                    coresPerTube: 12,
                    lengthMeters: child.cableMeters || (isFeeder ? 850 : 350),
                    cableType: isFeeder ? 'Feeder' : 'Distribusi',
                    status: child.isSimulated ? 'PLANNED' : 'ACTIVE',
                };
                list.push(synCable);
                pairToCableMap.set(pairKey, synCable);
            }
        });
    });

    return list;
}

// Split a fiber cable by inserting an intermediate Joint Box (JB / Closure)
export function splitCableWithJointBox({
    originalCable,
    jbName,
    jbId,
    distanceFromStart,
    autoSplice = true,
}: {
    originalCable: FiberCable;
    jbName: string;
    jbId?: string;
    distanceFromStart: number;
    autoSplice?: boolean;
}): {
    jbNodeId: string;
    cable1: FiberCable;
    cable2: FiberCable;
    generatedSplices: SpliceConnection[];
    deletedCableKeys: Record<string, boolean>;
} {
    const fromCode = originalCable.fromNodeId.replace(/[^A-Za-z0-9]/g, '');
    const toCode = originalCable.toNodeId.replace(/[^A-Za-z0-9]/g, '');
    const jbNodeId = jbId || jbName.trim().toUpperCase().replace(/\s+/g, '-');
    const jbCode = jbNodeId.replace(/[^A-Za-z0-9]/g, '');
    const isFeeder = originalCable.cableType === 'Feeder' || originalCable.fromNodeId === 'root-olt';

    const cable1Name = isFeeder ? `FDR-${fromCode}-${jbCode}` : `DST-${fromCode}-${jbCode}`;
    const cable2Name = isFeeder ? `FDR-${jbCode}-${toCode}` : `DST-${jbCode}-${toCode}`;

    const dist1 = Math.max(10, Math.min(originalCable.lengthMeters - 10, distanceFromStart));
    const dist2 = Math.max(10, originalCable.lengthMeters - dist1);

    const cable1: FiberCable = {
        id: cable1Name,
        name: cable1Name,
        fromNodeId: originalCable.fromNodeId,
        toNodeId: jbNodeId,
        totalCores: originalCable.totalCores,
        tubesCount: originalCable.tubesCount,
        coresPerTube: originalCable.coresPerTube || 12,
        lengthMeters: dist1,
        cableType: originalCable.cableType,
    };

    const cable2: FiberCable = {
        id: cable2Name,
        name: cable2Name,
        fromNodeId: jbNodeId,
        toNodeId: originalCable.toNodeId,
        totalCores: originalCable.totalCores,
        tubesCount: originalCable.tubesCount,
        coresPerTube: originalCable.coresPerTube || 12,
        lengthMeters: dist2,
        cableType: originalCable.cableType,
    };

    const generatedSplices: SpliceConnection[] = [];
    if (autoSplice) {
        const tubes = originalCable.tubesCount || Math.max(1, Math.ceil(originalCable.totalCores / 12));
        for (let t = 1; t <= tubes; t++) {
            for (let c = 1; c <= 12; c++) {
                const coreIndex = (t - 1) * 12 + c;
                if (coreIndex > originalCable.totalCores) break;
                generatedSplices.push({
                    id: `spl-${jbCode}-t${t}c${c}`,
                    enclosureNodeId: jbNodeId,
                    fromCableId: cable1.id,
                    fromTubeNumber: t,
                    fromCoreNumber: c,
                    toCableId: cable2.id,
                    toTubeNumber: t,
                    toCoreNumber: c,
                    lossDb: 0.05,
                    notes: `Straight splice T${t}-C${c}`,
                });
            }
        }
    }

    return {
        jbNodeId,
        cable1,
        cable2,
        generatedSplices,
        deletedCableKeys: {
            [originalCable.id]: true,
            [`${originalCable.fromNodeId}->${originalCable.toNodeId}`]: true,
        },
    };
}

// Reference Demo Topology matching user's schematic design (OLT-PUSAT -> ODCs -> JBs -> ODPs -> Customers)
export const DEMO_TOPOLOGY_ODCS: Odc[] = [
    {
        id: 'ODC-TBT-01',
        name: 'ODC-TBT-01',
        address: 'Jl. Tebet Raya No. 10',
        totalPorts: 24,
        powerInput: 4.7,
        powerOutput: -4.2,
        location: { lat: -6.225, lng: 106.855 },
    },
    {
        id: 'ODC-PSM-01',
        name: 'ODC-PSM-01',
        address: 'Jl. Pasar Minggu No. 45',
        totalPorts: 24,
        powerInput: 4.5,
        powerOutput: -5.1,
        location: { lat: -6.285, lng: 106.842 },
    },
];

export const DEMO_TOPOLOGY_ODPS: Odp[] = [
    // Branch 1: ODC-TBT-01
    {
        id: 'JB-TBT-01',
        name: 'JB-TBT-01',
        parentId: 'ODC-TBT-01',
        totalPorts: 24,
        powerInput: -4.2,
        powerOutput: -4.6,
        address: 'Jl. Tebet Barat (Joint Box Closure)',
        location: { lat: -6.228, lng: 106.853 },
    },
    {
        id: 'ODP-TBT-01',
        name: 'ODP-TBT-01',
        parentId: 'JB-TBT-01',
        totalPorts: 8,
        powerInput: -4.8,
        powerOutput: -16.8,
        address: 'Jl. Tebet Barat Raya Tiang 01',
        location: { lat: -6.229, lng: 106.852 },
    },
    {
        id: 'ODP-TBT-02',
        name: 'ODP-TBT-02',
        parentId: 'JB-TBT-01',
        totalPorts: 8,
        powerInput: -5.1,
        powerOutput: -17.4,
        address: 'Jl. Tebet Barat Raya Tiang 08',
        location: { lat: -6.231, lng: 106.851 },
    },
    {
        id: 'ODP-KMG-01',
        name: 'ODP-KMG-01',
        parentId: 'ODP-TBT-02', // Cascaded from ODP-TBT-02
        totalPorts: 8,
        powerInput: -7.5,
        powerOutput: -20.1,
        address: 'Jl. Kemang Timur No. 12',
        location: { lat: -6.242, lng: 106.845 },
    },

    // Branch 2: ODC-PSM-01
    {
        id: 'JB-PSM-01',
        name: 'JB-PSM-01',
        parentId: 'ODC-PSM-01',
        totalPorts: 12,
        powerInput: -5.1,
        powerOutput: -6.4,
        address: 'Jl. Pasar Minggu Km 18 (Closure)',
        location: { lat: -6.287, lng: 106.841 },
    },
    {
        id: 'TNG-042',
        name: 'TNG-042',
        parentId: 'JB-PSM-01',
        totalPorts: 4,
        powerInput: -6.6,
        powerOutput: -14.2,
        address: 'Tiang Distribusi No. 42',
        location: { lat: -6.289, lng: 106.839 },
    },
    {
        id: 'ODP-PSM-01',
        name: 'ODP-PSM-01',
        parentId: 'JB-PSM-01',
        totalPorts: 8,
        powerInput: -6.7,
        powerOutput: -16.9,
        address: 'Jl. Pasar Minggu Raya Gg. Bidan',
        location: { lat: -6.291, lng: 106.838 },
    },
    {
        id: 'ODP-LTA-01',
        name: 'ODP-LTA-01',
        parentId: 'JB-PSM-01',
        totalPorts: 16,
        powerInput: -5.5,
        powerOutput: -21.3,
        address: 'Jl. Lenteng Agung Timur No. 8',
        location: { lat: -6.305, lng: 106.835 },
    },
];

export const DEMO_TOPOLOGY_CUSTOMERS: Customer[] = [
    // ODP-TBT-01 (Power: -16.8 dB)
    { id: 'c1', name: 'Budi Santoso', odpId: 'ODP-TBT-01', status: CustomerStatus.Active, pppoeUsername: 'budi@net' } as any,
    { id: 'c2', name: 'Siti Rahmawati', odpId: 'ODP-TBT-01', status: CustomerStatus.Active, pppoeUsername: 'siti@net' } as any,
    { id: 'c3', name: 'Fajar Ramadhan', odpId: 'ODP-TBT-01', status: CustomerStatus.Active, pppoeUsername: 'fajar@net' } as any,

    // ODP-TBT-02 (Power: -17.4 dB)
    { id: 'c4', name: 'PT Karya Mandiri', odpId: 'ODP-TBT-02', status: CustomerStatus.Active, pppoeUsername: 'karya@corp' } as any,
    { id: 'c5', name: 'Agus Wijaya', odpId: 'ODP-TBT-02', status: CustomerStatus.Active, pppoeUsername: 'agus@net' } as any,

    // ODP-KMG-01 (Power: -20.1 dB)
    { id: 'c6', name: 'Dewi Lestari', odpId: 'ODP-KMG-01', status: CustomerStatus.Inactive, pppoeUsername: 'dewi@net' } as any,
    { id: 'c7', name: 'Rizky Pratama', odpId: 'ODP-KMG-01', status: CustomerStatus.Active, pppoeUsername: 'rizky@net' } as any,
    { id: 'c8', name: 'Toko Sinar Baru', odpId: 'ODP-KMG-01', status: CustomerStatus.Active, pppoeUsername: 'sinar@net' } as any,
    { id: 'c9', name: 'Bapak Hartono', odpId: 'ODP-KMG-01', status: CustomerStatus.Active, pppoeUsername: 'hartono@net' } as any,

    // TNG-042 (Power: -14.2 dB)
    { id: 'c10', name: 'Klinik Sehat Bersama', odpId: 'TNG-042', status: CustomerStatus.Active, pppoeUsername: 'sehat@net' } as any,

    // ODP-PSM-01 (Power: -16.9 dB)
    { id: 'c11', name: 'Hendro Gunawan', odpId: 'ODP-PSM-01', status: CustomerStatus.Inactive, pppoeUsername: 'hendro@net' } as any,
    { id: 'c12', name: 'Rina Permata', odpId: 'ODP-PSM-01', status: CustomerStatus.Active, pppoeUsername: 'rina@net' } as any,

    // ODP-LTA-01 (Power: -21.3 dB)
    { id: 'c13', name: 'Warung Kopi Nusantara', odpId: 'ODP-LTA-01', status: CustomerStatus.Active, pppoeUsername: 'warkop@net' } as any,
    { id: 'c14', name: 'Nadia Kusuma', odpId: 'ODP-LTA-01', status: CustomerStatus.Active, pppoeUsername: 'nadia@net' } as any,
    { id: 'c15', name: 'Kafe Ruang Seduh', odpId: 'ODP-LTA-01', status: CustomerStatus.Active, pppoeUsername: 'ruangseduh@net' } as any,
];

// Reference Demo Cables matching the schematic diagram
export const DEMO_TOPOLOGY_CABLES: FiberCable[] = [
    {
        id: 'FDR-OLT1-ODC1',
        name: 'FDR-OLT1-ODC1',
        fromNodeId: 'root-olt',
        toNodeId: 'ODC-TBT-01',
        totalCores: 24,
        tubesCount: 2,
        coresPerTube: 12,
        lengthMeters: 850,
        cableType: 'Feeder',
    },
    {
        id: 'FDR-OLT1-ODC2',
        name: 'FDR-OLT1-ODC2',
        fromNodeId: 'root-olt',
        toNodeId: 'ODC-PSM-01',
        totalCores: 24,
        tubesCount: 2,
        coresPerTube: 12,
        lengthMeters: 1420,
        cableType: 'Feeder',
    },
    {
        id: 'DST-ODC1-JB1',
        name: 'DST-ODC1-JB1',
        fromNodeId: 'ODC-TBT-01',
        toNodeId: 'JB-TBT-01',
        totalCores: 24,
        tubesCount: 2,
        coresPerTube: 12,
        lengthMeters: 240,
        cableType: 'Distribusi',
    },
    {
        id: 'DST-JB1-ODP1',
        name: 'DST-JB1-ODP1',
        fromNodeId: 'JB-TBT-01',
        toNodeId: 'ODP-TBT-01',
        totalCores: 12,
        tubesCount: 1,
        coresPerTube: 12,
        lengthMeters: 380,
        cableType: 'Distribusi',
    },
    {
        id: 'DST-JB1-ODP2',
        name: 'DST-JB1-ODP2',
        fromNodeId: 'JB-TBT-01',
        toNodeId: 'ODP-TBT-02',
        totalCores: 12,
        tubesCount: 1,
        coresPerTube: 12,
        lengthMeters: 520,
        cableType: 'Distribusi',
    },
    {
        id: 'DST-ODP2-KMG1',
        name: 'DST-ODP2-KMG1',
        fromNodeId: 'ODP-TBT-02',
        toNodeId: 'ODP-KMG-01',
        totalCores: 12,
        tubesCount: 1,
        coresPerTube: 12,
        lengthMeters: 640,
        cableType: 'Distribusi',
    },
    {
        id: 'DST-ODC2-JB2',
        name: 'DST-ODC2-JB2',
        fromNodeId: 'ODC-PSM-01',
        toNodeId: 'JB-PSM-01',
        totalCores: 24,
        tubesCount: 2,
        coresPerTube: 12,
        lengthMeters: 520,
        cableType: 'Distribusi',
    },
    {
        id: 'DST-ODC2-LTA1',
        name: 'DST-ODC2-LTA1',
        fromNodeId: 'ODC-PSM-01',
        toNodeId: 'ODP-LTA-01',
        totalCores: 12,
        tubesCount: 1,
        coresPerTube: 12,
        lengthMeters: 980,
        cableType: 'Distribusi',
    },
    {
        id: 'DST-ODC2-TNG42',
        name: 'DST-ODC2-TNG42',
        fromNodeId: 'ODC-PSM-01',
        toNodeId: 'TNG-042',
        totalCores: 12,
        tubesCount: 1,
        coresPerTube: 12,
        lengthMeters: 210,
        cableType: 'Distribusi',
    },
    {
        id: 'DST-JB2-ODP4',
        name: 'DST-JB2-ODP4',
        fromNodeId: 'JB-PSM-01',
        toNodeId: 'ODP-PSM-01',
        totalCores: 12,
        tubesCount: 1,
        coresPerTube: 12,
        lengthMeters: 320,
        cableType: 'Distribusi',
    },
];

// Reference Demo Splices matching the schematic
export const DEMO_TOPOLOGY_SPLICES: SpliceConnection[] = [
    // In ODC-PSM-01:
    {
        id: 'spl-psm-1',
        enclosureNodeId: 'ODC-PSM-01',
        fromCableId: 'FDR-OLT1-ODC2',
        fromTubeNumber: 1,
        fromCoreNumber: 1,
        toCableId: 'DST-ODC2-JB2',
        toTubeNumber: 1,
        toCoreNumber: 1,
        lossDb: 0.05,
        notes: 'Main trunk to JB-PSM-01',
    },
    {
        id: 'spl-psm-2',
        enclosureNodeId: 'ODC-PSM-01',
        fromCableId: 'FDR-OLT1-ODC2',
        fromTubeNumber: 1,
        fromCoreNumber: 2,
        toCableId: 'DST-ODC2-LTA1',
        toTubeNumber: 1,
        toCoreNumber: 1,
        lossDb: 0.05,
        notes: 'Direct branch to ODP-LTA-01',
    },
    {
        id: 'spl-psm-3',
        enclosureNodeId: 'ODC-PSM-01',
        fromCableId: 'FDR-OLT1-ODC2',
        fromTubeNumber: 1,
        fromCoreNumber: 3,
        toCableId: 'DST-ODC2-TNG42',
        toTubeNumber: 1,
        toCoreNumber: 1,
        lossDb: 0.05,
        notes: 'Branch to Tiang 42',
    },
    // In JB-PSM-01:
    {
        id: 'spl-jbpsm-1',
        enclosureNodeId: 'JB-PSM-01',
        fromCableId: 'DST-ODC2-JB2',
        fromTubeNumber: 1,
        fromCoreNumber: 1,
        toCableId: 'DST-JB2-ODP4',
        toTubeNumber: 1,
        toCoreNumber: 1,
        lossDb: 0.05,
        notes: 'Distribution to ODP-PSM-01',
    },
    // In ODC-TBT-01:
    {
        id: 'spl-tbt-1',
        enclosureNodeId: 'ODC-TBT-01',
        fromCableId: 'FDR-OLT1-ODC1',
        fromTubeNumber: 1,
        fromCoreNumber: 1,
        toCableId: 'DST-ODC1-JB1',
        toTubeNumber: 1,
        toCoreNumber: 1,
        lossDb: 0.05,
        notes: 'Trunk to JB-TBT-01 Core 1',
    },
    {
        id: 'spl-tbt-2',
        enclosureNodeId: 'ODC-TBT-01',
        fromCableId: 'FDR-OLT1-ODC1',
        fromTubeNumber: 1,
        fromCoreNumber: 2,
        toCableId: 'DST-ODC1-JB1',
        toTubeNumber: 1,
        toCoreNumber: 2,
        lossDb: 0.05,
        notes: 'Trunk to JB-TBT-01 Core 2',
    },
    // In JB-TBT-01:
    {
        id: 'spl-jbtbt-1',
        enclosureNodeId: 'JB-TBT-01',
        fromCableId: 'DST-ODC1-JB1',
        fromTubeNumber: 1,
        fromCoreNumber: 1,
        toCableId: 'DST-JB1-ODP1',
        toTubeNumber: 1,
        toCoreNumber: 1,
        lossDb: 0.05,
        notes: 'Drop to ODP-TBT-01',
    },
    {
        id: 'spl-jbtbt-2',
        enclosureNodeId: 'JB-TBT-01',
        fromCableId: 'DST-ODC1-JB1',
        fromTubeNumber: 1,
        fromCoreNumber: 2,
        toCableId: 'DST-JB1-ODP2',
        toTubeNumber: 1,
        toCoreNumber: 1,
        lossDb: 0.05,
        notes: 'Drop to ODP-TBT-02',
    },
    // In ODP-TBT-02:
    {
        id: 'spl-tbt2-1',
        enclosureNodeId: 'ODP-TBT-02',
        fromCableId: 'DST-JB1-ODP2',
        fromTubeNumber: 1,
        fromCoreNumber: 2,
        toCableId: 'DST-ODP2-KMG1',
        toTubeNumber: 1,
        toCoreNumber: 1,
        lossDb: 0.05,
        notes: 'Cascade pass-through to ODP-KMG-01',
    },
];

export const resolveNodeCategory = (name: string, type: string, isSimulated?: boolean): string => {
    if (type === 'olt') return 'OLT';
    if (type === 'odc') return 'ODC';
    if (isSimulated) return 'DRAF';
    const upper = (name || '').toUpperCase();
    if (upper.startsWith('JB-') || upper.startsWith('JB ') || upper.startsWith('JC-') || upper.startsWith('CLOSURE') || upper.startsWith('SPLICE')) {
        return 'JB';
    }
    if (upper.startsWith('TIANG') || upper.startsWith('TNG-') || upper.startsWith('TNG ') || upper.startsWith('POLE')) {
        return 'TIANG';
    }
    return 'ODP';
};

export const evaluateCustomerDropStatus = (cust: Customer, odpPowerOut: number, portIdx: number) => {
    if (cust.status === CustomerStatus.Inactive) {
        return {
            color: '#f43f5e',
            strokeColor: '#f43f5e',
            pillBorder: 'border-rose-500/80',
            pillBg: 'bg-[#180d14]',
            portText: 'text-rose-400',
            label: 'Redaman Kritis / Tidak Aktif (< -27 dBm)',
        };
    }
    const isWarning = odpPowerOut < -20 || portIdx === 3 || cust.status === CustomerStatus.Suspended;
    if (isWarning) {
        return {
            color: '#f59e0b',
            strokeColor: '#f59e0b',
            pillBorder: 'border-amber-500/80',
            pillBg: 'bg-[#18120a]',
            portText: 'text-amber-400',
            label: 'Redaman Waspada (-24 s/d -27 dBm)',
        };
    }
    return {
        color: '#10b981',
        strokeColor: '#10b981',
        pillBorder: 'border-emerald-500/80',
        pillBg: 'bg-[#091522]',
        portText: 'text-emerald-400',
        label: 'Optimal (-14 s/d -24 dBm)',
    };
};

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

export const getBadgeColorClass = (category: string): string => {
    switch (category) {
        case 'OLT': return 'text-sky-400';
        case 'ODC': return 'text-cyan-400';
        case 'JB': return 'text-indigo-400';
        case 'TIANG': return 'text-slate-300';
        case 'DRAF': return 'text-amber-400';
        default: return 'text-teal-400'; // ODP
    }
};

export const getCardBorderClass = (category: string, isSimulated?: boolean): string => {
    if (isSimulated) return 'border-2 border-dashed border-amber-500/70 shadow-amber-950/40';
    switch (category) {
        case 'OLT': return 'border border-sky-500/50 shadow-sky-950/40';
        case 'ODC': return 'border border-cyan-500/50 shadow-cyan-950/40';
        case 'JB': return 'border border-indigo-500/50 shadow-indigo-950/40';
        case 'TIANG': return 'border border-slate-600/60 shadow-slate-950/40';
        default: return 'border border-teal-500/50 shadow-teal-950/40'; // ODP
    }
};

export const getMetricColorClass = (node: TreeNode): string => {
    if (node.type === 'olt') return 'text-sky-300';
    if (node.calculatedPowerOut >= -24 && node.calculatedPowerOut <= -14) return 'text-cyan-400';
    if (node.calculatedPowerOut < -24 && node.calculatedPowerOut >= -27) return 'text-amber-400';
    if (node.calculatedPowerOut < -27) return 'text-rose-400';
    return 'text-emerald-400';
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

    // Mode Toggle: Live Database vs Reference Design Demo
    const [useDemoTopology, setUseDemoTopology] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('fo_calc_use_demo_topology');
            return saved ? saved === 'true' : false;
        } catch {
            return false;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('fo_calc_use_demo_topology', String(useDemoTopology));
        } catch { }
    }, [useDemoTopology]);

    // OLT & Optical Settings
    const [sfpClass, setSfpClass] = useState<string>('class_c');
    const [customTxPower, setCustomTxPower] = useState<number>(5.0);
    const currentTxPower = sfpClass === 'custom' ? customTxPower : (SFP_PRESETS[sfpClass]?.powerDbm ?? 5.0);

    // OLT Port PON Capacity & ODC Splitter Configurations
    const [oltPonCapacity, setOltPonCapacity] = useState<number>(() => {
        try {
            const saved = localStorage.getItem('fo_calc_olt_pon_capacity');
            return saved ? Number(saved) : 16;
        } catch {
            return 16;
        }
    });

    const [odcSplitterMap, setOdcSplitterMap] = useState<Record<string, string>>(() => {
        try {
            const saved = localStorage.getItem('fo_calc_odc_splitters');
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('fo_calc_olt_pon_capacity', String(oltPonCapacity));
        } catch { }
    }, [oltPonCapacity]);

    useEffect(() => {
        try {
            localStorage.setItem('fo_calc_odc_splitters', JSON.stringify(odcSplitterMap));
        } catch { }
    }, [odcSplitterMap]);

    // Custom topology nodes created by user (ODC / JB / ODP / Tiang)
    const [customNodes, setCustomNodes] = useState<CustomTopologyNode[]>(() => {
        try {
            const saved = localStorage.getItem('fo_calc_custom_nodes');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('fo_calc_custom_nodes', JSON.stringify(customNodes));
        } catch { }
    }, [customNodes]);

    // FO Cables state (Loose Tube & Cores)
    const [cables, setCables] = useState<FiberCable[]>(() => {
        try {
            const saved = localStorage.getItem('fo_calc_cables');
            if (saved) return JSON.parse(saved);
        } catch { }
        return DEMO_TOPOLOGY_CABLES;
    });

    useEffect(() => {
        try {
            localStorage.setItem('fo_calc_cables', JSON.stringify(cables));
        } catch { }
    }, [cables]);

    // Track explicitly deleted cables so synthesized topology cables can be suppressed
    const [deletedCableKeys, setDeletedCableKeys] = useState<Record<string, boolean>>(() => {
        try {
            const saved = localStorage.getItem('fo_calc_deleted_cables');
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('fo_calc_deleted_cables', JSON.stringify(deletedCableKeys));
        } catch { }
    }, [deletedCableKeys]);

    // Splice Joints state inside enclosures
    const [splices, setSplices] = useState<SpliceConnection[]>(() => {
        try {
            const saved = localStorage.getItem('fo_calc_splices');
            if (saved) return JSON.parse(saved);
        } catch { }
        return DEMO_TOPOLOGY_SPLICES;
    });

    useEffect(() => {
        try {
            localStorage.setItem('fo_calc_splices', JSON.stringify(splices));
        } catch { }
    }, [splices]);

    // Canvas view state
    const [zoom, setZoom] = useState<number>(1);
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 30, y: 40 });
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const inspectorRef = useRef<HTMLDivElement>(null);

    // Custom Draggable Node Positions (persisted in localStorage)
    const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => {
        try {
            const saved = localStorage.getItem('fo_calc_node_positions');
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });
    const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState<{
        mouseX: number;
        mouseY: number;
        initialNodeX: number;
        initialNodeY: number;
        moved: boolean;
    } | null>(null);

    // Selected Node & Inspector Tabs
    const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
    const [activeInspectorTab, setActiveInspectorTab] = useState<'mapping' | 'kabel' | 'splice'>('kabel');

    // Delete Node Confirmation State
    const [deletingNode, setDeletingNode] = useState<TreeNode | null>(null);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Delete Cable Confirmation State
    const [deletingCable, setDeletingCable] = useState<FiberCable | null>(null);

    // Filters and UI Toggles
    const [showCustomers, setShowCustomers] = useState<boolean>(true);
    const [showAuditMode, setShowAuditMode] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [selectedOdcFilter, setSelectedOdcFilter] = useState<string>('all');

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

    // Modal: Add Cable (Tarik Kabel FO)
    const [isAddCableModalOpen, setIsAddCableModalOpen] = useState<boolean>(false);
    const [newCableFromNode, setNewCableFromNode] = useState<string>('root-olt');
    const [newCableToNode, setNewCableToNode] = useState<string>('');
    const [newCableName, setNewCableName] = useState<string>('');
    const [newCableCores, setNewCableCores] = useState<number>(12);
    const [newCableLength, setNewCableLength] = useState<number>(350);
    const [newCableType, setNewCableType] = useState<string>('Distribusi');

    // Modal: Add Splice (Sambung Core)
    const [isAddSpliceModalOpen, setIsAddSpliceModalOpen] = useState<boolean>(false);
    const [newSpliceFromCableId, setNewSpliceFromCableId] = useState<string>('');
    const [newSpliceFromTube, setNewSpliceFromTube] = useState<number>(1);
    const [newSpliceFromCore, setNewSpliceFromCore] = useState<number>(1);
    const [newSpliceToCableId, setNewSpliceToCableId] = useState<string>('');
    const [newSpliceToTube, setNewSpliceToTube] = useState<number>(1);
    const [newSpliceToCore, setNewSpliceToCore] = useState<number>(1);
    const [newSpliceLoss, setNewSpliceLoss] = useState<number>(0.05);
    const [newSpliceNotes, setNewSpliceNotes] = useState<string>('');

    // Modal: Add Node (ODC / JB / ODP / Tiang)
    const [isAddNodeModalOpen, setIsAddNodeModalOpen] = useState<boolean>(false);
    const [newNodeCategory, setNewNodeCategory] = useState<'odc' | 'jb' | 'odp' | 'tiang'>('odp');
    const [newNodeName, setNewNodeName] = useState<string>('');
    const [newNodeParentId, setNewNodeParentId] = useState<string>('');
    const [newNodePorts, setNewNodePorts] = useState<number>(8);
    const [newNodeAddress, setNewNodeAddress] = useState<string>('');
    const [newNodeAutoCable, setNewNodeAutoCable] = useState<boolean>(true);

    // Modal: Sisipkan JB pada Kabel (Cable Split / Cut Restoration)
    const [splitCableTarget, setSplitCableTarget] = useState<FiberCable | null>(null);
    const [splitJbName, setSplitJbName] = useState<string>('');
    const [splitDistanceStart, setSplitDistanceStart] = useState<number>(400);
    const [splitAutoSplice, setSplitAutoSplice] = useState<boolean>(true);
    const [splitJbCategory, setSplitJbCategory] = useState<'jb' | 'tiang'>('jb');

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

        // Active dataset based on mode, merged with custom created nodes
        const baseOdcs = useDemoTopology ? DEMO_TOPOLOGY_ODCS : odcs;
        const customOdcList: Odc[] = customNodes
            .filter((n) => n.category === 'odc')
            .map((n) => ({
                id: n.id,
                name: n.name,
                address: n.address || '',
                totalPorts: n.totalPorts,
                powerInput: n.powerInput ?? 4.5,
                powerOutput: n.powerOutput ?? -5.1,
                location: n.location || { lat: -6.22, lng: 106.85 },
            }));
        const activeOdcsSource = [...baseOdcs, ...customOdcList];

        const baseOdps = useDemoTopology ? DEMO_TOPOLOGY_ODPS : odps;
        const customOdpList: Odp[] = customNodes
            .filter((n) => n.category !== 'odc')
            .map((n) => ({
                id: n.id,
                name: n.name,
                parentId: n.parentId,
                totalPorts: n.totalPorts,
                powerInput: n.powerInput ?? -6.0,
                powerOutput: n.powerOutput ?? -16.5,
                address: n.address || '',
                location: n.location || { lat: -6.22, lng: 106.85 },
            }));
        const activeOdpsSource = [...baseOdps, ...customOdpList];

        const activeCustsSource = useDemoTopology ? DEMO_TOPOLOGY_CUSTOMERS : customers;
        const effectivePonCapacity = useDemoTopology ? 16 : oltPonCapacity;

        // 1. Group customers by ODP
        const customersByOdp: Record<string, Customer[]> = {};
        activeCustsSource.forEach((c) => {
            if (c.odpId) {
                if (!customersByOdp[c.odpId]) customersByOdp[c.odpId] = [];
                customersByOdp[c.odpId].push(c);
            }
        });

        // Maps for fast parent-child hierarchical resolution
        const odcIdSet = new Set(activeOdcsSource.map((o) => o.id));
        const odcMapById = new Map(activeOdcsSource.map((o) => [o.id, o]));
        const odpMapById = new Map(activeOdpsSource.map((o) => [o.id, o]));

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

        // 2. Filter and attach ODP / JB nodes strictly belonging to selected ODC (or all if 'all')
        const odpMap = new Map<string, TreeNode>();

        const targetOdps = activeOdpsSource.filter((odp) => {
            if (selectedOdcFilter === 'all') return true;
            if (odp.parentId === 'root-olt') return true; // Feeder JBs visible in all views
            const rootOdcId = findRootOdcId(odp.parentId);
            return rootOdcId === selectedOdcFilter;
        });

        targetOdps.forEach((odp) => {
            const custs = customersByOdp[odp.id] || [];
            const parentOdc = odcMapById.get(odp.parentId || '');
            const parentOdp = odpMapById.get(odp.parentId || '');

            const matchingCable = cables.find((c) => c.toNodeId === odp.id);
            let distanceMeters = matchingCable ? matchingCable.lengthMeters : 420;

            if (!matchingCable) {
                if (useDemoTopology) {
                    if (odp.id === 'JB-TBT-01') distanceMeters = 240;
                    else if (odp.id === 'ODP-TBT-01') distanceMeters = 380;
                    else if (odp.id === 'ODP-TBT-02') distanceMeters = 520;
                    else if (odp.id === 'ODP-KMG-01') distanceMeters = 640;
                    else if (odp.id === 'JB-PSM-01') distanceMeters = 520;
                    else if (odp.id === 'TNG-042') distanceMeters = 210;
                    else if (odp.id === 'ODP-PSM-01') distanceMeters = 320;
                    else if (odp.id === 'ODP-LTA-01') distanceMeters = 980;
                } else if (parentOdc?.location && odp.location) {
                    const dist = haversineMeters(parentOdc.location, odp.location);
                    if (dist) distanceMeters = dist;
                } else if (parentOdp?.location && odp.location) {
                    const dist = haversineMeters(parentOdp.location, odp.location);
                    if (dist) distanceMeters = dist;
                }
            }

            const cableLoss = (distanceMeters / 1000) * 0.35;
            const splitterLoss = PLC_LOSS_MAP[odp.totalPorts === 16 ? '1:16' : '1:8'] || 10.5;
            const spliceLoss = 0.05;
            const connectorLoss = 0.5;

            let parentPowerOut = rootTx;
            if (odp.parentId === 'root-olt') {
                parentPowerOut = rootTx;
            } else if (parentOdc) {
                parentPowerOut = rootTx - 7.5;
            } else if (parentOdp) {
                const parentOdpNode = odpMap.get(parentOdp.id);
                parentPowerOut = parentOdpNode ? parentOdpNode.calculatedPowerOut : -16.8;
            }

            const isFeederClosure = odp.parentId === 'root-olt' || odp.name.toUpperCase().startsWith('JB') || odp.name.toUpperCase().startsWith('TIANG');
            const calcPowerIn = Number((parentPowerOut - cableLoss).toFixed(2));
            const calcPowerOut = useDemoTopology && odp.powerOutput != null
                ? odp.powerOutput
                : (isFeederClosure && odp.parentId === 'root-olt')
                    ? Number((calcPowerIn - spliceLoss).toFixed(2)) // Straight splice loss without PLC splitter
                    : Number((calcPowerIn - splitterLoss - spliceLoss - connectorLoss).toFixed(2));

            const parentName = (odp.parentId === 'root-olt' ? 'OLT' : parentOdc?.name || parentOdp?.name || 'NODE').replace(/[^A-Za-z0-9]/g, '');
            const childName = odp.name.replace(/[^A-Za-z0-9]/g, '');
            const isFeeder = odp.parentId === 'root-olt';
            const cableLabel = matchingCable
                ? `${matchingCable.name} • ${matchingCable.totalCores}C • ${matchingCable.lengthMeters}m`
                : `${isFeeder ? 'FDR' : 'DST'}-${parentName}-${childName} • ${isFeeder ? '24C' : '12C'} • ${distanceMeters}m`;

            const node: TreeNode = {
                id: odp.id,
                name: odp.name,
                type: 'odp',
                parentId: odp.parentId || undefined,
                parentType: odp.parentId === 'root-olt' ? 'olt' : parentOdc ? 'odc' : 'odp',
                totalPorts: odp.totalPorts || 8,
                usedPorts: custs.length,
                powerIn: odp.powerInput ?? null,
                powerOut: odp.powerOutput ?? null,
                calculatedPowerIn: calcPowerIn,
                calculatedPowerOut: calcPowerOut,
                cableMeters: distanceMeters,
                cableLabel,
                location: odp.location,
                address: odp.address,
                customers: custs,
                children: [],
                x: 0,
                y: 0,
            };

            odpMap.set(odp.id, node);
        });

        // 3. Identify active ODC nodes (may connect to OLT or an intermediate Feeder JB)
        const activeOdcs = activeOdcsSource.filter((odc) => selectedOdcFilter === 'all' || odc.id === selectedOdcFilter);
        const odcNodeMap = new Map<string, TreeNode>();

        const odcNodes: TreeNode[] = activeOdcs.map((odc) => {
            const incomingCable = cables.find((c) => c.toNodeId === odc.id) || cables.find((c) => c.fromNodeId === 'root-olt' && c.toNodeId === odc.id);
            const parentId = incomingCable ? incomingCable.fromNodeId : (odc.parentId || 'root-olt');
            const parentType = parentId === 'root-olt' ? 'olt' : (odpMap.has(parentId) ? 'jb' : 'odc');
            const estMeters = incomingCable ? incomingCable.lengthMeters : (odc.id === 'ODC-PSM-01' ? 1420 : 850);
            const cableLoss = (estMeters / 1000) * 0.35;

            // Dedicated SFP PON port to each ODC (or from Feeder JB)
            let parentTx = rootTx;
            if (parentId !== 'root-olt') {
                const jbParent = odpMap.get(parentId);
                if (jbParent) parentTx = jbParent.calculatedPowerOut;
            }
            const calcPowerIn = Number((parentTx - cableLoss).toFixed(2));

            // Inside ODC: configurable splitter
            const odcSplitter = odcSplitterMap[odc.id] || '1:4';
            let splitterLoss = 7.2;
            if (odcSplitter === 'direct' || odcSplitter === '1:1') splitterLoss = 0;
            else if (odcSplitter === '1:2') splitterLoss = 3.7;
            else if (odcSplitter === '1:8') splitterLoss = 10.5;

            const calcPowerOut = useDemoTopology && odc.powerOutput != null
                ? odc.powerOutput
                : Number((calcPowerIn - splitterLoss).toFixed(2));

            const fdrCode = odc.name.replace(/[^A-Za-z0-9]/g, '');
            const cableLabel = incomingCable
                ? `${incomingCable.name} • ${incomingCable.totalCores}C • ${incomingCable.lengthMeters}m`
                : `FDR-OLT1-${fdrCode} • 24C • ${estMeters}m`;

            const odcNode: TreeNode = {
                id: odc.id,
                name: odc.name,
                type: 'odc',
                parentId,
                parentType: parentType as any,
                totalPorts: odc.totalPorts || 24,
                usedPorts: 0,
                powerIn: odc.powerInput ?? null,
                powerOut: odc.powerOutput ?? null,
                calculatedPowerIn: calcPowerIn,
                calculatedPowerOut: calcPowerOut,
                cableMeters: estMeters,
                cableLabel,
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
            if (odpNode.parentId === 'root-olt') {
                return; // Handled directly as root-level feeder closure
            }

            const odcParent = odcNodeMap.get(odpNode.parentId || '');
            if (odcParent) {
                odcParent.children.push(odpNode);
                odcParent.usedPorts += 1;
                return;
            }

            const odpParent = odpMap.get(odpNode.parentId || '');
            if (odpParent) {
                odpParent.children.push(odpNode);
                odpParent.usedPorts += 1;
                return;
            }

            if (selectedOdcFilter === 'all') {
                unassignedOdps.push(odpNode);
            }
        });

        // Root Level Nodes: Feeder JBs + ODCs not attached to a JB
        const rootChildren: TreeNode[] = [];

        // 1. Feeder JBs connected directly to root-olt
        odpMap.forEach((odpNode) => {
            if (odpNode.parentId === 'root-olt') {
                rootChildren.push(odpNode);
            }
        });

        // 2. ODCs: attach to parent JB if exists, else attach to root OLT
        odcNodes.forEach((odcNode) => {
            if (odcNode.parentId && odcNode.parentId !== 'root-olt') {
                const jbParent = odpMap.get(odcNode.parentId);
                if (jbParent) {
                    jbParent.children.push(odcNode);
                    jbParent.usedPorts += 1;
                    return;
                }
            }
            rootChildren.push(odcNode);
        });

        // Root Node OLT
        const rootOltNode: TreeNode = {
            id: 'root-olt',
            name: 'OLT-PUSAT',
            type: 'olt',
            totalPorts: effectivePonCapacity,
            usedPorts: useDemoTopology ? 12 : odcNodes.length,
            powerIn: null,
            powerOut: rootTx,
            calculatedPowerIn: rootTx,
            calculatedPowerOut: rootTx,
            cableMeters: 0,
            cableLabel: 'ROOT SFP TX',
            customers: [],
            children: [...rootChildren],
            x: 50,
            y: 0,
        };

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
        let currentY = 50;

        const assignPositions = (node: TreeNode, depthX: number) => {
            node.x = depthX;

            if (node.children.length === 0) {
                const custCount = (showCustomers && node.customers) ? node.customers.length : 0;
                const branchHeight = Math.max(80, custCount * 34 + 16);
                node.y = currentY + branchHeight / 2;
                currentY += branchHeight + 25;
                allFlattened.push(node);
                return;
            }

            const nextDepthX = (showCustomers && node.customers && node.customers.length > 0)
                ? node.x + 390
                : (node.type === 'olt' ? node.x + 280 : node.x + 260);

            const childYPositions: number[] = [];
            node.children.forEach((child) => {
                assignPositions(child, nextDepthX);
                childYPositions.push(child.y);
            });

            const minY = Math.min(...childYPositions);
            const maxY = Math.max(...childYPositions);
            node.y = (minY + maxY) / 2;
            allFlattened.push(node);
        };

        assignPositions(rootOltNode, 50);

        // Apply custom dragged positions if set
        allFlattened.forEach((node) => {
            const customPos = nodePositions[node.id];
            if (customPos) {
                node.x = customPos.x;
                node.y = customPos.y;
            }
        });

        return { tree: rootOltNode, flattenedNodes: allFlattened };
    }, [odps, odcs, customers, currentTxPower, selectedOdcFilter, simulatedNodes, showCustomers, nodePositions, oltPonCapacity, odcSplitterMap, useDemoTopology, customNodes, cables]);

    // Fast Node Lookup Map
    const nodeMap = useMemo(() => {
        return new Map<string, TreeNode>(flattenedNodes.map((n) => [n.id, n]));
    }, [flattenedNodes]);

    // Save custom node positions to localStorage
    useEffect(() => {
        try {
            if (Object.keys(nodePositions).length > 0) {
                localStorage.setItem('fo_calc_node_positions', JSON.stringify(nodePositions));
            } else {
                localStorage.removeItem('fo_calc_node_positions');
            }
        } catch { }
    }, [nodePositions]);

    // Complete effective cables unified across explicit cables and topology parent-child links
    const effectiveCables = useMemo(() => {
        return synthesizeTopologyCables(cables, flattenedNodes, deletedCableKeys);
    }, [cables, flattenedNodes, deletedCableKeys]);

    // Compute Active Upstream Trace Path when a node is selected
    const { traceCableIds } = useMemo(() => {
        if (!selectedNode) {
            return { traceNodeIds: new Set<string>(), traceCableIds: new Set<string>() };
        }
        return getUpstreamTracePath(selectedNode.id, effectiveCables);
    }, [selectedNode, effectiveCables]);

    // Global mouseup to release dragging reliably
    useEffect(() => {
        const handleGlobalMouseUp = () => {
            if (draggingNodeId) {
                if (dragOffset && !dragOffset.moved) {
                    const found = flattenedNodes.find((n) => n.id === draggingNodeId);
                    if (found) {
                        setSelectedNode(found);
                    }
                }
                setDraggingNodeId(null);
                setDragOffset(null);
            }
            if (isDragging) {
                setIsDragging(false);
            }
        };

        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, [draggingNodeId, dragOffset, isDragging, flattenedNodes]);

    // Set initial selected node if odpId passed
    useEffect(() => {
        if (initialOdpId && flattenedNodes.length > 0) {
            const found = flattenedNodes.find((n) => n.id === initialOdpId);
            if (found) setSelectedNode(found);
        }
    }, [initialOdpId, flattenedNodes]);

    // Node Mouse Dragging on Canvas
    const handleNodeMouseDown = (e: React.MouseEvent, node: TreeNode) => {
        if ((e.target as HTMLElement).closest('button, input, select, a')) return;
        e.stopPropagation();
        setDraggingNodeId(node.id);
        setDragOffset({
            mouseX: e.clientX,
            mouseY: e.clientY,
            initialNodeX: node.x,
            initialNodeY: node.y,
            moved: false,
        });
    };

    // Canvas Mouse Dragging & Panning
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.interactive-node, button, input, select')) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (draggingNodeId && dragOffset) {
            const deltaX = (e.clientX - dragOffset.mouseX) / zoom;
            const deltaY = (e.clientY - dragOffset.mouseY) / zoom;
            if (!dragOffset.moved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
                setDragOffset((prev) => (prev ? { ...prev, moved: true } : null));
            }
            setNodePositions((prev) => ({
                ...prev,
                [draggingNodeId]: {
                    x: Math.round(dragOffset.initialNodeX + deltaX),
                    y: Math.round(dragOffset.initialNodeY + deltaY),
                },
            }));
            return;
        }

        if (!isDragging) return;
        setPan({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y,
        });
    };

    const handleMouseUp = () => {
        if (draggingNodeId) {
            if (dragOffset && !dragOffset.moved) {
                const found = flattenedNodes.find((n) => n.id === draggingNodeId);
                if (found) setSelectedNode(found);
            }
            setDraggingNodeId(null);
            setDragOffset(null);
            return;
        }
        setIsDragging(false);
    };

    // Reset all nodes to auto-layout
    const handleResetPositions = () => {
        setNodePositions({});
        try {
            localStorage.removeItem('fo_calc_node_positions');
        } catch { }
        setPan({ x: 30, y: 40 });
        setZoom(1);
        setCopyNotice('Semua posisi node berhasil diatur ulang secara otomatis.');
        setTimeout(() => setCopyNotice(null), 3000);
    };

    // Zoom handlers
    const handleZoomIn = () => setZoom((prev) => Math.min(1.6, prev + 0.15));
    const handleZoomOut = () => setZoom((prev) => Math.max(0.4, prev - 0.15));
    const handleResetZoom = () => {
        setZoom(1);
        setPan({ x: 30, y: 40 });
    };

    // Calculate real-time simulation in planner drawer
    const plannerCalculations = useMemo(() => {
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
        setNodePositions((prev) => {
            const next = { ...prev };
            delete next[simId];
            return next;
        });
        if (selectedNode?.id === simId) setSelectedNode(null);
    };

    // Delete ODP or ODC permanently from database or custom nodes
    const handleDeleteNode = async (node: TreeNode) => {
        if (node.isSimulated) {
            handleRemoveSimulatedNode(node.id);
            setDeletingNode(null);
            setCopyNotice(`Node simulasi ${node.name} berhasil dihapus.`);
            setTimeout(() => setCopyNotice(null), 3000);
            return;
        }

        // Check if it's a custom user node
        const isCustom = customNodes.some((n) => n.id === node.id);
        if (isCustom) {
            setCustomNodes((prev) => prev.filter((n) => n.id !== node.id));
            setCables((prev) => prev.filter((c) => c.fromNodeId !== node.id && c.toNodeId !== node.id));
            setSplices((prev) => prev.filter((s) => s.enclosureNodeId !== node.id));
            setNodePositions((prev) => {
                const next = { ...prev };
                delete next[node.id];
                return next;
            });
            if (selectedNode?.id === node.id) setSelectedNode(null);
            setDeletingNode(null);
            setCopyNotice(`Node ${node.name} berhasil dihapus.`);
            setTimeout(() => setCopyNotice(null), 3000);
            return;
        }

        // Live DB node
        setIsDeleting(true);
        setDeleteError(null);
        try {
            const endpoint = node.type === 'odc' ? `/api/network/odcs/${node.id}` : `/api/network/odps/${node.id}`;
            const res = await fetchWithAuth(endpoint, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || `Gagal menghapus ${node.type.toUpperCase()}.`);
            }

            if (node.type === 'odc') {
                setOdcs((prev) => prev.filter((o) => o.id !== node.id));
                if (selectedOdcFilter === node.id) setSelectedOdcFilter('all');
            } else {
                setOdps((prev) => prev.filter((o) => o.id !== node.id));
            }

            setCables((prev) => prev.filter((c) => c.fromNodeId !== node.id && c.toNodeId !== node.id));
            setSplices((prev) => prev.filter((s) => s.enclosureNodeId !== node.id));

            setNodePositions((prev) => {
                const next = { ...prev };
                delete next[node.id];
                return next;
            });

            if (selectedNode?.id === node.id) {
                setSelectedNode(null);
            }

            setDeletingNode(null);
            setCopyNotice(`${node.type.toUpperCase()} ${node.name} berhasil dihapus dari sistem.`);
            setTimeout(() => setCopyNotice(null), 3500);
            await fetchNetworkData();
        } catch (err: any) {
            setDeleteError(err.message || `Gagal menghapus ${node.type.toUpperCase()}.`);
        } finally {
            setIsDeleting(false);
        }
    };

    // Action: Create New Custom Node (ODC, JB, ODP, Tiang)
    const handleCreateCustomNode = () => {
        if (!newNodeName.trim()) {
            alert('Masukkan nama node baru.');
            return;
        }

        const nodeId = newNodeName.trim().toUpperCase().replace(/\s+/g, '-');
        const parent = flattenedNodes.find((n) => n.id === newNodeParentId);

        const newCustom: CustomTopologyNode = {
            id: nodeId,
            name: newNodeName.trim(),
            category: newNodeCategory,
            parentId: parent?.id || (newNodeCategory === 'odc' ? 'root-olt' : odcs[0]?.id || 'root-olt'),
            totalPorts: newNodePorts,
            address: newNodeAddress.trim() || undefined,
            powerInput: newNodeCategory === 'odc' ? 4.5 : -5.5,
            powerOutput: newNodeCategory === 'odc' ? -4.5 : -17.0,
        };

        setCustomNodes((prev) => [...prev, newCustom]);

        // Auto create cable if checked
        if (newNodeAutoCable && newCustom.parentId) {
            const autoCableName = `DST-${newCustom.parentId.replace(/[^A-Za-z0-9]/g, '')}-${nodeId.replace(/[^A-Za-z0-9]/g, '')}`;
            const newCable: FiberCable = {
                id: autoCableName,
                name: autoCableName,
                fromNodeId: newCustom.parentId,
                toNodeId: nodeId,
                totalCores: 12,
                tubesCount: 1,
                coresPerTube: 12,
                lengthMeters: 350,
                cableType: newNodeCategory === 'odc' ? 'Feeder' : 'Distribusi',
            };
            setCables((prev) => [...prev, newCable]);
        }

        setIsAddNodeModalOpen(false);
        setNewNodeName('');
        setNewNodeAddress('');
        setCopyNotice(`Node ${newCustom.name} (${newCustom.category.toUpperCase()}) berhasil ditambahkan.`);
        setTimeout(() => setCopyNotice(null), 3500);
    };

    // Action: Open Split Cable (Sisipkan Joint Box pada Titik Putus)
    const handleOpenSplitCable = (cable: FiberCable) => {
        const toNode = flattenedNodes.find((n) => n.id === cable.toNodeId);
        const toCode = toNode ? toNode.name.replace(/[^A-Za-z0-9]/g, '') : 'NODE';
        const defaultName = `JB-${toCode}-01`;
        const halfDist = Math.max(10, Math.round(cable.lengthMeters / 2));

        setSplitCableTarget(cable);
        setSplitJbName(defaultName);
        setSplitDistanceStart(halfDist);
        setSplitAutoSplice(true);
        setSplitJbCategory('jb');
    };

    // Action: Confirm Split Cable with JB
    const handleConfirmSplitCable = () => {
        if (!splitCableTarget) return;
        if (!splitJbName.trim()) {
            alert('Masukkan nama Joint Box.');
            return;
        }

        const splitResult = splitCableWithJointBox({
            originalCable: splitCableTarget,
            jbName: splitJbName.trim(),
            distanceFromStart: splitDistanceStart,
            autoSplice: splitAutoSplice,
        });

        // 1. Create the new JB node
        const newJbNode: CustomTopologyNode = {
            id: splitResult.jbNodeId,
            name: splitJbName.trim(),
            category: splitJbCategory,
            parentId: splitCableTarget.fromNodeId,
            totalPorts: splitCableTarget.totalCores,
            powerInput: 4.86,
            powerOutput: 4.81,
            address: `Titik Sambung Closure (${splitDistanceStart}m dari ${splitCableTarget.fromNodeId})`,
        };

        setCustomNodes((prev) => [...prev, newJbNode]);

        // 2. Mark old cable as deleted in deleted keys
        setDeletedCableKeys((prev) => ({
            ...prev,
            ...splitResult.deletedCableKeys,
        }));

        // 3. Update cables state with the two new segments
        setCables((prev) => {
            const filtered = prev.filter(
                (c) => c.id !== splitCableTarget.id && `${c.fromNodeId}->${c.toNodeId}` !== `${splitCableTarget.fromNodeId}->${splitCableTarget.toNodeId}`
            );
            return [...filtered, splitResult.cable1, splitResult.cable2];
        });

        // 4. Add generated splices into splices state
        if (splitResult.generatedSplices.length > 0) {
            setSplices((prev) => [...prev, ...splitResult.generatedSplices]);
        }

        setSplitCableTarget(null);
        setCopyNotice(`Joint Box ${splitJbName.trim()} (${splitCableTarget.totalCores} Core) berhasil disisipkan di ${splitDistanceStart}m!`);
        setTimeout(() => setCopyNotice(null), 4000);
    };

    // Action: Create New Cable
    const handleCreateCable = () => {
        if (!newCableName.trim()) {
            alert('Masukkan nama/kode kabel FO.');
            return;
        }
        if (newCableFromNode === newCableToNode) {
            alert('Node asal dan node tujuan tidak boleh sama.');
            return;
        }

        const tubes = Math.max(1, Math.ceil(newCableCores / 12));
        const newCable: FiberCable = {
            id: newCableName.trim(),
            name: newCableName.trim(),
            fromNodeId: newCableFromNode,
            toNodeId: newCableToNode,
            totalCores: newCableCores,
            tubesCount: tubes,
            coresPerTube: 12,
            lengthMeters: newCableLength,
            cableType: newCableType,
        };

        setCables((prev) => [...prev, newCable]);
        setIsAddCableModalOpen(false);
        setNewCableName('');
        setCopyNotice(`Kabel FO ${newCable.name} (${newCable.totalCores} Core, ${newCable.lengthMeters}m) berhasil ditarik.`);
        setTimeout(() => setCopyNotice(null), 3500);
    };

    // Action: Delete Cable
    const handleDeleteCable = (cable: FiberCable) => {
        const pairKey = `${cable.fromNodeId}->${cable.toNodeId}`;
        setDeletedCableKeys((prev) => ({
            ...prev,
            [pairKey]: true,
            [cable.id]: true,
        }));
        setCables((prev) => prev.filter((c) => c.id !== cable.id));
        setSplices((prev) => prev.filter((s) => s.fromCableId !== cable.id && s.toCableId !== cable.id));
        setDeletingCable(null);
        setCopyNotice(`Kabel FO ${cable.name} berhasil dihapus.`);
        setTimeout(() => setCopyNotice(null), 3000);
    };

    // Action: Create New Splice Joint
    const handleCreateSplice = () => {
        if (!selectedNode) {
            alert('Pilih node enclosure terlebih dahulu.');
            return;
        }
        if (!newSpliceFromCableId || !newSpliceToCableId) {
            alert('Pilih kabel IN dan kabel OUT untuk disambung.');
            return;
        }
        if (newSpliceFromCableId === newSpliceToCableId && newSpliceFromTube === newSpliceToTube && newSpliceFromCore === newSpliceToCore) {
            alert('Tidak dapat menyambung core ke core yang sama pada kabel yang sama.');
            return;
        }

        // Validate not already spliced in this enclosure
        const alreadyFrom = isCoreSpliced(newSpliceFromCableId, newSpliceFromTube, newSpliceFromCore, splices, selectedNode.id);
        if (alreadyFrom.isSpliced) {
            alert(`Core IN (Tube ${newSpliceFromTube}, Core ${newSpliceFromCore}) sudah disambung di enclosure ini.`);
            return;
        }
        const alreadyTo = isCoreSpliced(newSpliceToCableId, newSpliceToTube, newSpliceToCore, splices, selectedNode.id);
        if (alreadyTo.isSpliced) {
            alert(`Core OUT (Tube ${newSpliceToTube}, Core ${newSpliceToCore}) sudah disambung di enclosure ini.`);
            return;
        }

        const newSplice: SpliceConnection = {
            id: `spl-${Date.now()}`,
            enclosureNodeId: selectedNode.id,
            fromCableId: newSpliceFromCableId,
            fromTubeNumber: newSpliceFromTube,
            fromCoreNumber: newSpliceFromCore,
            toCableId: newSpliceToCableId,
            toTubeNumber: newSpliceToTube,
            toCoreNumber: newSpliceToCore,
            lossDb: newSpliceLoss || 0.05,
            notes: newSpliceNotes.trim() || undefined,
            createdAt: new Date().toISOString(),
        };

        setSplices((prev) => [...prev, newSplice]);
        setIsAddSpliceModalOpen(false);
        setNewSpliceNotes('');
        setCopyNotice(`Sambungan splice baru di ${selectedNode.name} berhasil dibuat.`);
        setTimeout(() => setCopyNotice(null), 3500);
    };

    // Action: Delete / Disconnect Splice
    const handleDeleteSplice = (spliceId: string) => {
        setSplices((prev) => prev.filter((s) => s.id !== spliceId));
        setCopyNotice('Sambungan core (splice) berhasil diputus.');
        setTimeout(() => setCopyNotice(null), 3000);
    };

    // Connected cables for the currently selected node
    const nodeIncomingCables = useMemo(() => {
        if (!selectedNode) return [];
        return effectiveCables.filter((c) => c.toNodeId === selectedNode.id);
    }, [selectedNode, effectiveCables]);

    const nodeOutgoingCables = useMemo(() => {
        if (!selectedNode) return [];
        return effectiveCables.filter((c) => c.fromNodeId === selectedNode.id);
    }, [selectedNode, effectiveCables]);

    const nodeAllCables = useMemo(() => {
        return [...nodeIncomingCables, ...nodeOutgoingCables];
    }, [nodeIncomingCables, nodeOutgoingCables]);

    // Splices inside currently selected node
    const nodeSplices = useMemo(() => {
        if (!selectedNode) return [];
        return splices.filter((s) => s.enclosureNodeId === selectedNode.id);
    }, [selectedNode, splices]);

    // Copy NOC / WhatsApp Report
    const handleCopyReport = () => {
        const textLines = [
            `*LAPORAN TOPOLOGI FO & BUDGETING ISP*`,
            `Tanggal: ${new Date().toLocaleString('id-ID')}`,
            `SFP OLT TX: ${currentTxPower} dBm`,
            `Total ODC: ${odcs.length + customNodes.filter((n) => n.category === 'odc').length} unit`,
            `Total ODP/JB: ${odps.length + customNodes.filter((n) => n.category !== 'odc').length} unit`,
            `Total Kabel FO: ${effectiveCables.length} ruas kabel`,
            `Total Sambungan Splice: ${splices.length} joint`,
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
        <div className="space-y-5 pb-32 min-h-screen">
            {/* Top Header Card */}
            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 shadow-xl text-white">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-slate-800">
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 shadow-lg shadow-cyan-500/20 text-white">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </span>
                            <div>
                                <h2 className="text-xl font-black tracking-tight text-slate-100 flex items-center gap-2">
                                    <span>FO Network Topology & Budgeting Planner</span>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-mono">
                                        TIA/EIA-598 Matrix
                                    </span>
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Peta visual skematik jalur OLT &rarr; ODC &rarr; JB &rarr; ODP &rarr; Pelanggan. Dokumentasi sambungan core & tube, tarik kabel, dan kalkulasi redaman.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap">
                        {/* Mode Selector: Live vs Reference Demo */}
                        <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-xl p-1 text-xs">
                            <button
                                type="button"
                                onClick={() => setUseDemoTopology(false)}
                                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${!useDemoTopology
                                    ? 'bg-cyan-600 text-white font-bold shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                title="Gunakan data riil ODC & ODP dari database server"
                            >
                                Data Riil (DB)
                            </button>
                            <button
                                type="button"
                                onClick={() => setUseDemoTopology(true)}
                                className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${useDemoTopology
                                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                title="Tampilkan topologi desain lengkap sesuai skema diagram (OLT -> ODC -> JB -> ODP -> Pelanggan)"
                            >
                                <span>Topologi Desain</span>
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            </button>
                        </div>

                        {onBack && (
                            <button
                                onClick={onBack}
                                className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                            >
                                Kembali ke ODP
                            </button>
                        )}
                        <button
                            onClick={handleCopyReport}
                            className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 transition-colors flex items-center gap-1.5 cursor-pointer"
                            title="Salin ringkasan laporan ke WhatsApp"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 4.315 1.731 6.086l.107.192-.533 1.955 1.976-.518.188.112z" />
                            </svg>
                            <span>Salin Laporan</span>
                        </button>

                        {/* Button: Add Node (ODC/JB/ODP) */}
                        <button
                            type="button"
                            onClick={() => {
                                setNewNodeCategory('odp');
                                setNewNodeName(`ODP-BARU-${odps.length + 1}`);
                                setNewNodeParentId(selectedNode?.id || odcs[0]?.id || 'root-olt');
                                setIsAddNodeModalOpen(true);
                            }}
                            className="px-3.5 py-2 text-xs font-bold rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-white shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span>+ Tambah Node</span>
                        </button>

                        {/* Button: Tarik Kabel FO Baru */}
                        <button
                            type="button"
                            onClick={() => {
                                setNewCableFromNode(selectedNode?.id || 'root-olt');
                                setNewCableToNode(odcs[0]?.id || '');
                                setNewCableName(`DST-KABEL-${cables.length + 1}`);
                                setIsAddCableModalOpen(true);
                            }}
                            className="px-3.5 py-2 text-xs font-bold rounded-xl bg-cyan-700/80 hover:bg-cyan-600 text-white shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            <span>+ Tarik Kabel FO</span>
                        </button>
                    </div>
                </div>

                {/* Sub-toolbar Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-xs">
                    {/* Left: OLT Power & Filter */}
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* SFP OLT TX */}
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

                        {/* OLT PON Port Capacity */}
                        <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl">
                            <span className="text-slate-400">Port PON OLT:</span>
                            <select
                                value={oltPonCapacity}
                                onChange={(e) => setOltPonCapacity(Number(e.target.value))}
                                className="bg-transparent text-amber-300 font-semibold focus:outline-none cursor-pointer"
                            >
                                <option value={4} className="bg-slate-900 text-white">4 Port PON</option>
                                <option value={8} className="bg-slate-900 text-white">8 Port PON</option>
                                <option value={16} className="bg-slate-900 text-white">16 Port PON</option>
                                <option value={32} className="bg-slate-900 text-white">32 Port PON</option>
                            </select>
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
                                className="bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-500 rounded-xl px-3 py-1.5 w-44 sm:w-56 focus:outline-none focus:border-cyan-500 text-xs"
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

                    {/* Right: View Toggles, Auto-Layout & Zoom Controls */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                        {/* Selected Node Action: Delete Button */}
                        {selectedNode && selectedNode.type !== 'olt' && (
                            <button
                                type="button"
                                onClick={() => setDeletingNode(selectedNode)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/40 text-xs font-semibold transition-colors cursor-pointer animate-in fade-in shadow-md"
                                title={`Hapus ${selectedNode.name} dari jaringan`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Hapus {selectedNode.name}</span>
                            </button>
                        )}

                        {/* Toggle Customer Chips */}
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl">
                            <input
                                type="checkbox"
                                checked={showCustomers}
                                onChange={(e) => setShowCustomers(e.target.checked)}
                                className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-slate-300">Pelanggan</span>
                        </label>

                        {/* Toggle Audit Mode */}
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-xl">
                            <input
                                type="checkbox"
                                checked={showAuditMode}
                                onChange={(e) => setShowAuditMode(e.target.checked)}
                                className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-slate-300">Audit OPM</span>
                        </label>

                        {/* Reset Auto Layout Button */}
                        <button
                            type="button"
                            onClick={handleResetPositions}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 border border-slate-700/80 text-xs font-semibold transition-colors cursor-pointer"
                            title="Atur ulang posisi semua node ke susunan otomatis pohon hierarki"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span>Atur Otomatis</span>
                        </button>

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

            {/* Split Screen Layout: Left Canvas | Right Side Inspector Drawer */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Left Column: Interactive Schematic Canvas */}
                <div className={selectedNode ? 'lg:col-span-7 xl:col-span-8' : 'lg:col-span-12'}>
                    <div
                        ref={canvasContainerRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        className="relative w-full h-[700px] bg-[#070b14] border border-slate-800/90 rounded-2xl overflow-hidden select-none cursor-grab active:cursor-grabbing shadow-2xl"
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
                                    <filter id="glow-gold" x="-20%" y="-20%" width="140%" height="140%">
                                        <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#f59e0b" floodOpacity="0.8" />
                                    </filter>
                                    <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                                        <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#06b6d4" floodOpacity="0.5" />
                                    </filter>
                                </defs>

                                {/* Render all unified effective cables */}
                                {effectiveCables.map((cable) => {
                                    const parent = nodeMap.get(cable.fromNodeId);
                                    const child = nodeMap.get(cable.toNodeId);
                                    if (!parent || !child) return null;

                                    const startX = parent.x + 160;
                                    const startY = parent.y;
                                    const endX = child.x;
                                    const endY = child.y;
                                    const dx = endX - startX;
                                    const ctrlDist = Math.max(35, Math.abs(dx) * 0.45);
                                    const ctrl1X = startX + (endX >= startX ? ctrlDist : -ctrlDist);
                                    const ctrl2X = endX - (endX >= startX ? ctrlDist : -ctrlDist);

                                    const pathD = `M ${startX} ${startY} C ${ctrl1X} ${startY}, ${ctrl2X} ${endY}, ${endX} ${endY}`;
                                    const isTraceActive = traceCableIds.has(cable.id);
                                    const midX = (startX + endX) / 2;
                                    const midY = (startY + endY) / 2;
                                    const isFeeder = cable.cableType === 'Feeder' || parent.type === 'olt';
                                    const isSim = cable.status === 'PLANNED' || child.isSimulated;

                                    const strokeColor = isTraceActive
                                        ? '#f59e0b'
                                        : isSim
                                            ? '#f59e0b'
                                            : isFeeder
                                                ? '#0284c7'
                                                : '#0d9488';

                                    const strokeWidth = isTraceActive ? 3.5 : (isFeeder ? 2.5 : 2);
                                    const labelText = `${cable.name} • ${cable.totalCores}C • ${cable.lengthMeters}m`;
                                    const labelWidth = Math.max(130, labelText.length * 6.5 + 20);

                                    return (
                                        <g key={`cable-${cable.id}`}>
                                            <circle cx={startX} cy={startY} r="3" fill={isTraceActive ? '#f59e0b' : '#38bdf8'} />
                                            <circle cx={endX} cy={endY} r="3" fill={isTraceActive ? '#f59e0b' : '#38bdf8'} />

                                            <path
                                                d={pathD}
                                                fill="none"
                                                stroke={strokeColor}
                                                strokeWidth={strokeWidth}
                                                strokeDasharray={isSim ? '6 4' : 'none'}
                                                opacity={isTraceActive ? 1 : 0.85}
                                                filter={isTraceActive ? 'url(#glow-gold)' : undefined}
                                            />

                                            <rect
                                                x={midX - labelWidth / 2}
                                                y={midY - 10}
                                                width={labelWidth}
                                                height={20}
                                                rx={10}
                                                fill="#080f1e"
                                                stroke={isTraceActive ? '#f59e0b' : isSim ? '#f59e0b' : '#1e3a5f'}
                                                strokeWidth={isTraceActive ? 1.5 : 1}
                                            />
                                            <text
                                                x={midX}
                                                y={midY + 3.5}
                                                textAnchor="middle"
                                                fill={isTraceActive ? '#fbbf24' : isSim ? '#fcd34d' : '#7dd3fc'}
                                                fontSize="9"
                                                fontFamily="monospace"
                                                fontWeight={isTraceActive ? '700' : '600'}
                                            >
                                                {labelText}
                                            </text>
                                        </g>
                                    );
                                })}

                                {/* Render links to Customers */}
                                {showCustomers &&
                                    flattenedNodes.map((odp) => {
                                        if (odp.type === 'olt' || odp.customers.length === 0) return null;
                                        const startX = odp.x + 160;
                                        const startY = odp.y;
                                        const custCount = odp.customers.length;

                                        return odp.customers.map((cust, idx) => {
                                            const custX = odp.x + 195;
                                            const custY = Math.round(odp.y - ((custCount - 1) * 32) / 2 + idx * 32);
                                            const dropEval = evaluateCustomerDropStatus(cust, odp.calculatedPowerOut, idx + 1);
                                            const dx = custX - startX;
                                            const midX = startX + dx * 0.5;
                                            const pathD = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${custY}, ${custX} ${custY}`;

                                            return (
                                                <path
                                                    key={`cust-edge-${odp.id}-${cust.id}`}
                                                    d={pathD}
                                                    fill="none"
                                                    stroke={dropEval.strokeColor}
                                                    strokeWidth={1.5}
                                                    strokeDasharray="4 3"
                                                    opacity={0.85}
                                                />
                                            );
                                        });
                                    })}
                            </svg>

                            {/* HTML Node Cards Layer */}
                            <div className="absolute top-0 left-0 w-[4200px] h-[3600px] pointer-events-none">
                                {flattenedNodes.map((node) => {
                                    const isSelected = selectedNode?.id === node.id;
                                    const isNodeDragging = draggingNodeId === node.id;
                                    const isSearchMatch = searchQuery
                                        ? node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                        node.customers.some((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                        : false;

                                    const category = resolveNodeCategory(node.name, node.type, node.isSimulated);
                                    const effectivePonCap = useDemoTopology ? 16 : oltPonCapacity;
                                    const badgeText = category === 'OLT'
                                        ? `OLT • ${node.usedPorts}/${effectivePonCap}`
                                        : `${category} • ${node.usedPorts}/${node.totalPorts}`;

                                    const metricText = node.type === 'olt'
                                        ? 'Root Tx'
                                        : `${node.calculatedPowerOut} dB`;

                                    return (
                                        <React.Fragment key={node.id}>
                                            <div
                                                onMouseDown={(e) => handleNodeMouseDown(e, node)}
                                                className={`group interactive-node pointer-events-auto absolute p-2 rounded-2xl transition-all select-none shadow-xl cursor-grab active:cursor-grabbing flex flex-col justify-between items-center text-center ${isNodeDragging
                                                    ? 'ring-4 ring-cyan-400/50 scale-[1.02] z-40 shadow-2xl opacity-95 bg-[#0e172a]'
                                                    : isSelected
                                                        ? 'border-2 border-dashed border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.45)] ring-2 ring-amber-400/20 bg-[#0c1424] z-30'
                                                        : `${getCardBorderClass(category, node.isSimulated)} bg-[#0c1424] hover:border-slate-500/80 hover:shadow-cyan-900/30`
                                                    } ${isSearchMatch ? 'ring-2 ring-yellow-400' : ''}`}
                                                style={{
                                                    left: `${node.x}px`,
                                                    top: `${node.y - 37}px`,
                                                    width: '160px',
                                                    height: '74px',
                                                }}
                                            >
                                                {/* Top Badge with subtle hover drag handle and action buttons */}
                                                <div className="w-full flex items-center justify-between px-1 relative">
                                                    <span className="opacity-0 group-hover:opacity-60 text-slate-400 text-[10px] cursor-grab" title="Geser node">
                                                        ⋮⋮
                                                    </span>
                                                    <span className={`text-[10px] font-mono font-semibold tracking-wider ${getBadgeColorClass(category)}`}>
                                                        {badgeText}
                                                    </span>
                                                    <div className="flex items-center gap-1">
                                                        {node.type !== 'olt' && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDeletingNode(node);
                                                                }}
                                                                className={`p-1 rounded transition-all cursor-pointer ${
                                                                    isSelected
                                                                        ? 'opacity-100 bg-rose-500/25 text-rose-300 hover:bg-rose-500/40 hover:text-white'
                                                                        : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10'
                                                                }`}
                                                                title={`Hapus ${node.name}`}
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Node Name */}
                                                <div className="font-bold text-[13px] text-white tracking-tight truncate w-full px-1" title={node.name}>
                                                    {node.name}
                                                </div>

                                                {/* Metric Subtitle */}
                                                <div className={`text-[11px] font-mono font-medium ${getMetricColorClass(node)}`}>
                                                    {metricText}
                                                </div>
                                            </div>

                                            {/* Customer Port Chips */}
                                            {showCustomers &&
                                                node.customers.map((cust, idx) => {
                                                    const custCount = node.customers.length;
                                                    const custX = node.x + 195;
                                                    const custY = Math.round(node.y - ((custCount - 1) * 32) / 2 + idx * 32);
                                                    const dropEval = evaluateCustomerDropStatus(cust, node.calculatedPowerOut, idx + 1);

                                                    return (
                                                        <div
                                                            key={`cust-chip-${node.id}-${cust.id}`}
                                                            className={`interactive-node pointer-events-auto absolute px-2.5 py-1 rounded-xl border text-xs shadow-sm flex items-center justify-between gap-1.5 transition-all select-none ${dropEval.pillBg} ${dropEval.pillBorder}`}
                                                            style={{
                                                                left: `${custX}px`,
                                                                top: `${custY - 15}px`,
                                                                width: '170px',
                                                                height: '30px',
                                                            }}
                                                            title={`Pelanggan: ${cust.name} | Status: ${cust.status} | Estimasi: ${dropEval.label}`}
                                                        >
                                                            <div className="flex items-center gap-1.5 truncate">
                                                                <span className={`font-mono font-bold text-[10px] ${dropEval.portText}`}>
                                                                    P#{idx + 1}
                                                                </span>
                                                                <span className="truncate font-medium text-slate-100 text-xs" title={cust.name}>
                                                                    {cust.name}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Floating Canvas Helper Legend */}
                        <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl px-4 py-2 text-[11px] text-slate-400 flex items-center gap-3.5 shadow-lg flex-wrap">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-sky-400"></span>
                                <span>OLT</span>
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                                <span>ODC</span>
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-indigo-400"></span>
                                <span>JB</span>
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
                                <span>ODP</span>
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-4 h-1 bg-amber-400 rounded-full"></span>
                                <span className="text-amber-300 font-semibold">Jalur Trace Aktif</span>
                            </span>
                            <span className="text-slate-500">|</span>
                            <span className="text-cyan-300 font-medium">Drag node untuk atur posisi</span>
                        </div>
                    </div>
                </div>

                {/* Right Column: Side Inspector Drawer with 3 Tabs [Mapping] [Kabel (N)] [Splice (M)] */}
                {selectedNode && (
                    <div
                        ref={inspectorRef}
                        className="lg:col-span-5 xl:col-span-4 bg-[#0b1220] border border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col gap-4 max-h-[700px] overflow-y-auto text-white sticky top-4"
                    >
                        {/* Drawer Header */}
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base font-bold text-white tracking-tight">{selectedNode.name}</h3>
                                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 font-bold ${getBadgeColorClass(resolveNodeCategory(selectedNode.name, selectedNode.type, selectedNode.isSimulated))}`}>
                                        {resolveNodeCategory(selectedNode.name, selectedNode.type, selectedNode.isSimulated)}
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-400 truncate max-w-[260px] mt-0.5">
                                    {selectedNode.address || 'Alamat fisik belum diatur'}
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                                {selectedNode.type !== 'olt' && (
                                    <button
                                        type="button"
                                        onClick={() => setDeletingNode(selectedNode)}
                                        className="px-2 py-1 text-xs font-semibold rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 flex items-center gap-1 transition-colors cursor-pointer"
                                        title={`Hapus ${selectedNode.name} dari jaringan`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                        <span>Hapus</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setSelectedNode(null)}
                                    className="text-slate-400 hover:text-white text-xl p-1 leading-none cursor-pointer"
                                    title="Tutup Inspector"
                                >
                                    &times;
                                </button>
                            </div>
                        </div>

                        {/* 3 Tabs Header: [Mapping] [Kabel (N)] [Splice (M)] */}
                        <div className="grid grid-cols-3 gap-1 bg-slate-900/90 border border-slate-800 p-1 rounded-xl text-xs font-semibold">
                            <button
                                type="button"
                                onClick={() => setActiveInspectorTab('mapping')}
                                className={`py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer ${activeInspectorTab === 'mapping'
                                    ? 'bg-cyan-600 text-white font-bold shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                Mapping
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveInspectorTab('kabel')}
                                className={`py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer ${activeInspectorTab === 'kabel'
                                    ? 'bg-cyan-600 text-white font-bold shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                Kabel ({nodeAllCables.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveInspectorTab('splice')}
                                className={`py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer ${activeInspectorTab === 'splice'
                                    ? 'bg-cyan-600 text-white font-bold shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                    }`}
                            >
                                Splice ({nodeSplices.length})
                            </button>
                        </div>

                        {/* Tab 1: Mapping Details */}
                        {activeInspectorTab === 'mapping' && (
                            <div className="space-y-4 animate-in fade-in">
                                {selectedNode.type === 'odc' ? (
                                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Power In (Feeder)</span>
                                            <span className="text-sm font-bold text-emerald-400">
                                                +{selectedNode.calculatedPowerIn} dBm
                                            </span>
                                            <span className="text-[9px] text-slate-500 block">Direct OLT Tx</span>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block mb-0.5">Splitter Internal</span>
                                            <select
                                                value={odcSplitterMap[selectedNode.id] || '1:4'}
                                                onChange={(e) => setOdcSplitterMap((prev) => ({ ...prev, [selectedNode.id]: e.target.value }))}
                                                className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-cyan-300 font-mono w-full focus:outline-none cursor-pointer"
                                            >
                                                <option value="direct">Direct 1:1 (0 dB)</option>
                                                <option value="1:2">PLC 1:2 (3.7 dB)</option>
                                                <option value="1:4">PLC 1:4 (7.2 dB)</option>
                                                <option value="1:8">PLC 1:8 (10.5 dB)</option>
                                            </select>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Power Out (ke ODP)</span>
                                            <span className="text-sm font-bold text-cyan-400">
                                                {selectedNode.calculatedPowerOut} dBm
                                            </span>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Daya Ukur Riil (OPM)</span>
                                            <span className="text-sm font-bold text-slate-200">
                                                {selectedNode.powerOut != null ? `${selectedNode.powerOut} dBm` : 'Belum diukur'}
                                            </span>
                                        </div>
                                    </div>
                                ) : selectedNode.type === 'olt' ? (
                                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Kapasitas PON</span>
                                            <span className="text-sm font-bold text-amber-300">
                                                {selectedNode.usedPorts} / {selectedNode.totalPorts} PON
                                            </span>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Power Tx SFP</span>
                                            <span className="text-sm font-bold text-cyan-400">
                                                +{selectedNode.powerOut} dBm
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Utilisasi Port</span>
                                            <span className="text-sm font-bold text-slate-100">
                                                {selectedNode.usedPorts} / {selectedNode.totalPorts} Port
                                            </span>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Daya Hitungan Desain</span>
                                            <span className="text-sm font-bold text-cyan-400">
                                                {selectedNode.calculatedPowerOut} dBm
                                            </span>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Daya Ukur Riil (OPM)</span>
                                            <span className="text-sm font-bold text-slate-200">
                                                {selectedNode.powerOut != null ? `${selectedNode.powerOut} dBm` : 'Belum diukur'}
                                            </span>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                                            <span className="text-[10px] text-slate-400 block">Status Akurasi Optik</span>
                                            <span className={`text-[11px] font-bold ${evaluateOpticalStatus(selectedNode.calculatedPowerOut).color}`}>
                                                {evaluateOpticalStatus(selectedNode.calculatedPowerOut).label}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex flex-col gap-2 pt-2 border-t border-slate-800 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPlannerParentId(selectedNode.id);
                                            setPlannerName(`ODP-CABANG-${odps.length + 1}`);
                                            setIsPlannerOpen(true);
                                        }}
                                        className="w-full py-2 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-bold text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        <span>+ Rencanakan Tarikan ODP Baru</span>
                                    </button>

                                    {selectedNode.location && (
                                        <button
                                            type="button"
                                            onClick={() => window.open(`https://www.google.com/maps?q=${selectedNode.location?.lat},${selectedNode.location?.lng}`, '_blank')}
                                            className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700"
                                        >
                                            <span>Buka di Google Maps</span>
                                        </button>
                                    )}

                                    {selectedNode.type !== 'olt' && (
                                        <button
                                            type="button"
                                            onClick={() => setDeletingNode(selectedNode)}
                                            className="w-full py-2 px-3 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/40 font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                            <span>Hapus Node {selectedNode.name}</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Tab 2: Kabel FO Terhubung (IN & OUT cards + TIA-598 12 Core Pills) */}
                        {activeInspectorTab === 'kabel' && (
                            <div className="space-y-3.5 animate-in fade-in">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-200">Kabel FO Terhubung</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setNewCableFromNode(selectedNode.id);
                                            setNewCableToNode('');
                                            setNewCableName(`DST-${selectedNode.name.replace(/[^A-Za-z0-9]/g, '')}-BARU`);
                                            setIsAddCableModalOpen(true);
                                        }}
                                        className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                        <span>+ Buat Kabel Keluar</span>
                                    </button>
                                </div>

                                {nodeAllCables.length === 0 ? (
                                    <div className="p-4 rounded-xl bg-slate-900/60 border border-dashed border-slate-800 text-center text-xs text-slate-400">
                                        <p>Belum ada kabel FO yang terhubung ke node ini.</p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setNewCableFromNode('root-olt');
                                                setNewCableToNode(selectedNode.id);
                                                setNewCableName(`FDR-OLT-${selectedNode.name.replace(/[^A-Za-z0-9]/g, '')}`);
                                                setIsAddCableModalOpen(true);
                                            }}
                                            className="mt-2.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer"
                                        >
                                            + Sambungkan Kabel Masuk
                                        </button>
                                    </div>
                                ) : (
                                    nodeAllCables.map((cable) => {
                                        const isIncoming = cable.toNodeId === selectedNode.id;
                                        const fromNode = nodeMap.get(cable.fromNodeId);
                                        const toNode = nodeMap.get(cable.toNodeId);
                                        const usedCores = countCableUsedCores(cable.id, splices);
                                        const totalTubes = cable.tubesCount || Math.max(1, Math.ceil(cable.totalCores / 12));

                                        return (
                                            <div
                                                key={`cable-card-${cable.id}`}
                                                className="p-3.5 rounded-xl bg-[#0c1527] border border-slate-800/90 shadow-md space-y-2.5"
                                            >
                                                {/* Header Row */}
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded font-mono ${isIncoming ? 'bg-sky-950 text-sky-300 border border-sky-500/40' : 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'}`}>
                                                            {isIncoming ? 'IN' : 'OUT'} • {cable.name}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[11px] font-mono font-bold text-emerald-400">
                                                            {usedCores}/{cable.totalCores} Core
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenSplitCable(cable)}
                                                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/40 transition-colors cursor-pointer flex items-center gap-1"
                                                            title="Sisipkan Joint Box (JB) jika kabel putus atau butuh sambungan di tengah"
                                                        >
                                                            <span>✂️ Sisipkan JB</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setDeletingCable(cable)}
                                                            className="text-slate-500 hover:text-rose-400 text-xs p-0.5 cursor-pointer"
                                                            title="Hapus Kabel"
                                                        >
                                                            &times;
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Subtitle Details */}
                                                <p className="text-[11px] text-slate-400 font-sans">
                                                    {isIncoming ? `Dari ${fromNode?.name || cable.fromNodeId}` : `Ke ${toNode?.name || cable.toNodeId}`}
                                                    {' • '}
                                                    {totalTubes} Tube × 12 Core • {cable.lengthMeters}m
                                                </p>

                                                {/* Tube and Core Matrix with TIA-598 Standard Colors */}
                                                <div className="space-y-2 pt-1">
                                                    {Array.from({ length: totalTubes }).map((_, tubeIdx) => {
                                                        const tubeNum = tubeIdx + 1;
                                                        const tubeColor = getTubeColor(tubeNum);

                                                        return (
                                                            <div key={`cable-${cable.id}-tube-${tubeNum}`} className="space-y-1">
                                                                {totalTubes > 1 && (
                                                                    <div className="flex items-center gap-1.5 text-[10px] text-slate-300 font-semibold">
                                                                        <span
                                                                            className="w-2 h-2 rounded-full ring-1 ring-white/30"
                                                                            style={{ backgroundColor: tubeColor.hex }}
                                                                        />
                                                                        <span>Tube {tubeNum} ({tubeColor.name})</span>
                                                                    </div>
                                                                )}

                                                                {/* 12 Core Pills */}
                                                                <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                                                                    {Array.from({ length: 12 }).map((__, coreIdx) => {
                                                                        const coreNum = coreIdx + 1;
                                                                        const coreColor = getCoreColor(coreNum);
                                                                        const spliceStatus = isCoreSpliced(cable.id, tubeNum, coreNum, splices, selectedNode.id);

                                                                        return (
                                                                            <button
                                                                                key={`core-btn-${cable.id}-${tubeNum}-${coreNum}`}
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    if (isIncoming) {
                                                                                        setNewSpliceFromCableId(cable.id);
                                                                                        setNewSpliceFromTube(tubeNum);
                                                                                        setNewSpliceFromCore(coreNum);
                                                                                        if (nodeOutgoingCables.length > 0) {
                                                                                            setNewSpliceToCableId(nodeOutgoingCables[0].id);
                                                                                        }
                                                                                    } else {
                                                                                        setNewSpliceToCableId(cable.id);
                                                                                        setNewSpliceToTube(tubeNum);
                                                                                        setNewSpliceToCore(coreNum);
                                                                                        if (nodeIncomingCables.length > 0) {
                                                                                            setNewSpliceFromCableId(nodeIncomingCables[0].id);
                                                                                        }
                                                                                    }
                                                                                    setIsAddSpliceModalOpen(true);
                                                                                }}
                                                                                title={`Tube ${tubeNum} Core ${coreNum} (${coreColor.name}): ${spliceStatus.isSpliced ? 'Terpakai (Spliced)' : 'Idle / Tersedia'}`}
                                                                                className="relative h-6 flex items-center justify-center rounded-md font-mono text-[10px] font-bold border transition-transform hover:scale-105 cursor-pointer shadow-sm"
                                                                                style={{
                                                                                    backgroundColor: coreColor.hex,
                                                                                    color: coreColor.textColor,
                                                                                    borderColor: spliceStatus.isSpliced ? '#22c55e' : 'rgba(255,255,255,0.2)',
                                                                                }}
                                                                            >
                                                                                <span>{coreNum}</span>
                                                                                {/* Active dot indicator on spliced cores */}
                                                                                <span
                                                                                    className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${spliceStatus.isSpliced
                                                                                        ? 'bg-emerald-300 ring-1 ring-black'
                                                                                        : 'bg-black/40 border border-white/30'
                                                                                        }`}
                                                                                />
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}

                        {/* Tab 3: Daftar Sambungan Splice (Joint Matrix) */}
                        {activeInspectorTab === 'splice' && (
                            <div className="space-y-3.5 animate-in fade-in">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-200">Manajemen Sambungan Splice</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (nodeIncomingCables.length > 0) setNewSpliceFromCableId(nodeIncomingCables[0].id);
                                            if (nodeOutgoingCables.length > 0) setNewSpliceToCableId(nodeOutgoingCables[0].id);
                                            setIsAddSpliceModalOpen(true);
                                        }}
                                        className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                        <span>+ Sambung Core (Splice)</span>
                                    </button>
                                </div>

                                {nodeSplices.length === 0 ? (
                                    <div className="p-4 rounded-xl bg-slate-900/60 border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-2">
                                        <p>Belum ada sambungan core (joint splice) yang tercatat di {selectedNode.name}.</p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (nodeIncomingCables.length > 0) setNewSpliceFromCableId(nodeIncomingCables[0].id);
                                                if (nodeOutgoingCables.length > 0) setNewSpliceToCableId(nodeOutgoingCables[0].id);
                                                setIsAddSpliceModalOpen(true);
                                            }}
                                            className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold cursor-pointer"
                                        >
                                            + Sambungkan Core Pertama
                                        </button>
                                    </div>
                                ) : (
                                    nodeSplices.map((splice, idx) => {
                                        const fromCable = cables.find((c) => c.id === splice.fromCableId);
                                        const toCable = cables.find((c) => c.id === splice.toCableId);
                                        const fromTubeColor = getTubeColor(splice.fromTubeNumber);
                                        const fromCoreColor = getCoreColor(splice.fromCoreNumber);
                                        const toTubeColor = getTubeColor(splice.toTubeNumber);
                                        const toCoreColor = getCoreColor(splice.toCoreNumber);

                                        return (
                                            <div
                                                key={`splice-${splice.id}`}
                                                className="p-3.5 rounded-xl bg-[#0c1527] border border-slate-800/90 shadow-md space-y-2 text-xs"
                                            >
                                                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/70">
                                                    <span className="font-mono text-[10px] text-slate-400">
                                                        Splice #{idx + 1} • Loss: <strong className="text-amber-400">{splice.lossDb} dB</strong>
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteSplice(splice.id)}
                                                        className="text-rose-400 hover:text-rose-300 text-[10px] font-semibold cursor-pointer"
                                                        title="Putus sambungan ini"
                                                    >
                                                        Putus Sambungan
                                                    </button>
                                                </div>

                                                <div className="flex items-center justify-between gap-2">
                                                    {/* From Cable Core */}
                                                    <div className="space-y-1">
                                                        <span className="text-[10px] font-mono text-sky-300 block truncate max-w-[130px]">
                                                            {fromCable?.name || splice.fromCableId}
                                                        </span>
                                                        <div className="flex items-center gap-1.5">
                                                            <span
                                                                className="w-2.5 h-2.5 rounded-full ring-1 ring-white/30"
                                                                style={{ backgroundColor: fromTubeColor.hex }}
                                                                title={`Tube ${splice.fromTubeNumber} (${fromTubeColor.name})`}
                                                            />
                                                            <span
                                                                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                                                                style={{ backgroundColor: fromCoreColor.hex, color: fromCoreColor.textColor }}
                                                            >
                                                                C#{splice.fromCoreNumber} {fromCoreColor.name}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <span className="text-slate-500 font-bold text-sm">&rarr;</span>

                                                    {/* To Cable Core */}
                                                    <div className="space-y-1 text-right">
                                                        <span className="text-[10px] font-mono text-emerald-300 block truncate max-w-[130px]">
                                                            {toCable?.name || splice.toCableId}
                                                        </span>
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            <span
                                                                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                                                                style={{ backgroundColor: toCoreColor.hex, color: toCoreColor.textColor }}
                                                            >
                                                                C#{splice.toCoreNumber} {toCoreColor.name}
                                                            </span>
                                                            <span
                                                                className="w-2.5 h-2.5 rounded-full ring-1 ring-white/30"
                                                                style={{ backgroundColor: toTubeColor.hex }}
                                                                title={`Tube ${splice.toTubeNumber} (${toTubeColor.name})`}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {splice.notes && (
                                                    <p className="text-[10px] text-slate-400 italic pt-1 border-t border-slate-800/50">
                                                        Catatan: {splice.notes}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal: Tarik Kabel FO Baru */}
            {isAddCableModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl text-white space-y-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                                    <span>Tarik Kabel Fiber Optic Baru</span>
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Hubungkan kabel distribusi atau feeder antara dua titik enclosure/tiang.
                                </p>
                            </div>
                            <button
                                onClick={() => setIsAddCableModalOpen(false)}
                                className="text-slate-400 hover:text-white text-xl font-bold"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">Nama / Kode Kabel FO:</label>
                                <input
                                    type="text"
                                    value={newCableName}
                                    onChange={(e) => setNewCableName(e.target.value)}
                                    placeholder="Contoh: DST-ODC2-JB3"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-300 mb-1">Titik Asal (From):</label>
                                    <select
                                        value={newCableFromNode}
                                        onChange={(e) => setNewCableFromNode(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                                    >
                                        <option value="root-olt">OLT-PUSAT (Root)</option>
                                        {flattenedNodes
                                            .filter((n) => n.id !== 'root-olt')
                                            .map((n) => (
                                                <option key={`from-${n.id}`} value={n.id}>
                                                    {n.name} ({n.type.toUpperCase()})
                                                </option>
                                            ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-300 mb-1">Titik Tujuan (To):</label>
                                    <select
                                        value={newCableToNode}
                                        onChange={(e) => setNewCableToNode(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                                    >
                                        <option value="">Pilih Node Tujuan...</option>
                                        {flattenedNodes
                                            .filter((n) => n.id !== newCableFromNode)
                                            .map((n) => (
                                                <option key={`to-${n.id}`} value={n.id}>
                                                    {n.name} ({n.type.toUpperCase()})
                                                </option>
                                            ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-300 mb-1">Kapasitas Core:</label>
                                    <select
                                        value={newCableCores}
                                        onChange={(e) => setNewCableCores(Number(e.target.value))}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                                    >
                                        <option value={12}>12 Core (1 Tube)</option>
                                        <option value={24}>24 Core (2 Tube)</option>
                                        <option value={48}>48 Core (4 Tube)</option>
                                        <option value={96}>96 Core (8 Tube)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-300 mb-1">Panjang (Meter):</label>
                                    <input
                                        type="number"
                                        min="10"
                                        max="15000"
                                        step="50"
                                        value={newCableLength}
                                        onChange={(e) => setNewCableLength(Number(e.target.value) || 0)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                                    />
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-300 mb-1">Jenis Kabel:</label>
                                    <select
                                        value={newCableType}
                                        onChange={(e) => setNewCableType(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                                    >
                                        <option value="Distribusi">Distribusi</option>
                                        <option value="Feeder">Feeder</option>
                                        <option value="Dropcore">Dropcore</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                            <button
                                type="button"
                                onClick={() => setIsAddCableModalOpen(false)}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateCable}
                                className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg"
                            >
                                + Pasang Kabel FO
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Sambung Core (Splice) */}
            {isAddSpliceModalOpen && selectedNode && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl text-white space-y-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                                    <span>Sambung Core FO (Fusion Splice)</span>
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Dokumentasikan joint core di enclosure <strong className="text-cyan-300 font-mono">{selectedNode.name}</strong>.
                                </p>
                            </div>
                            <button
                                onClick={() => setIsAddSpliceModalOpen(false)}
                                className="text-slate-400 hover:text-white text-xl font-bold"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="space-y-4 text-xs">
                            {/* Kabel IN selection */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                                <span className="font-bold text-sky-400 uppercase text-[10px] block">1. Core Sumber (Kabel IN)</span>
                                <div>
                                    <label className="text-slate-400 block mb-1">Pilih Kabel Masuk:</label>
                                    <select
                                        value={newSpliceFromCableId}
                                        onChange={(e) => setNewSpliceFromCableId(e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                                    >
                                        <option value="">Pilih Kabel IN...</option>
                                        {nodeAllCables.map((c) => (
                                            <option key={`inc-${c.id}`} value={c.id}>
                                                {c.name} ({c.totalCores}C)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-slate-400 block mb-1">Tube IN:</label>
                                        <select
                                            value={newSpliceFromTube}
                                            onChange={(e) => setNewSpliceFromTube(Number(e.target.value))}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                                        >
                                            <option value={1}>Tube 1 ({getTubeColor(1).name})</option>
                                            <option value={2}>Tube 2 ({getTubeColor(2).name})</option>
                                            <option value={3}>Tube 3 ({getTubeColor(3).name})</option>
                                            <option value={4}>Tube 4 ({getTubeColor(4).name})</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-slate-400 block mb-1">Core IN (1-12):</label>
                                        <select
                                            value={newSpliceFromCore}
                                            onChange={(e) => setNewSpliceFromCore(Number(e.target.value))}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                                        >
                                            {TIA598_COLORS.map((c) => {
                                                const check = isCoreSpliced(newSpliceFromCableId, newSpliceFromTube, c.num, splices, selectedNode.id);
                                                return (
                                                    <option key={`from-core-${c.num}`} value={c.num}>
                                                        Core {c.num} ({c.name}) {check.isSpliced ? '• [Terpakai]' : '• [Tersedia]'}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Kabel OUT selection */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                                <span className="font-bold text-emerald-400 uppercase text-[10px] block">2. Core Tujuan (Kabel OUT)</span>
                                <div>
                                    <label className="text-slate-400 block mb-1">Pilih Kabel Keluar:</label>
                                    <select
                                        value={newSpliceToCableId}
                                        onChange={(e) => setNewSpliceToCableId(e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                                    >
                                        <option value="">Pilih Kabel OUT...</option>
                                        {nodeAllCables.map((c) => (
                                            <option key={`outc-${c.id}`} value={c.id}>
                                                {c.name} ({c.totalCores}C)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-slate-400 block mb-1">Tube OUT:</label>
                                        <select
                                            value={newSpliceToTube}
                                            onChange={(e) => setNewSpliceToTube(Number(e.target.value))}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                                        >
                                            <option value={1}>Tube 1 ({getTubeColor(1).name})</option>
                                            <option value={2}>Tube 2 ({getTubeColor(2).name})</option>
                                            <option value={3}>Tube 3 ({getTubeColor(3).name})</option>
                                            <option value={4}>Tube 4 ({getTubeColor(4).name})</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-slate-400 block mb-1">Core OUT (1-12):</label>
                                        <select
                                            value={newSpliceToCore}
                                            onChange={(e) => setNewSpliceToCore(Number(e.target.value))}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                                        >
                                            {TIA598_COLORS.map((c) => {
                                                const check = isCoreSpliced(newSpliceToCableId, newSpliceToTube, c.num, splices, selectedNode.id);
                                                return (
                                                    <option key={`to-core-${c.num}`} value={c.num}>
                                                        Core {c.num} ({c.name}) {check.isSpliced ? '• [Terpakai]' : '• [Tersedia]'}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Loss & Notes */}
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-slate-400 mb-1">Loss Splice (dB):</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={newSpliceLoss}
                                        onChange={(e) => setNewSpliceLoss(parseFloat(e.target.value) || 0.05)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-white font-mono text-center"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-slate-400 mb-1">Catatan Sambungan (Opsional):</label>
                                    <input
                                        type="text"
                                        value={newSpliceNotes}
                                        onChange={(e) => setNewSpliceNotes(e.target.value)}
                                        placeholder="Contoh: Jalur Feeder Utama OLT ke JB"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                            <button
                                type="button"
                                onClick={() => setIsAddSpliceModalOpen(false)}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateSplice}
                                className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg"
                            >
                                + Sambungkan Core (Joint)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Tambah Node Baru (ODC / JB / ODP / Tiang) */}
            {isAddNodeModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl text-white space-y-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-slate-100">Tambah Node Jaringan Baru</h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Pasang ODC, Joint Box (JB), ODP, atau Tiang Distribusi baru.
                                </p>
                            </div>
                            <button onClick={() => setIsAddNodeModalOpen(false)} className="text-slate-400 hover:text-white text-xl font-bold">
                                &times;
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">Tipe / Kategori Node:</label>
                                <select
                                    value={newNodeCategory}
                                    onChange={(e) => {
                                        const cat = e.target.value as any;
                                        setNewNodeCategory(cat);
                                        const prefix = cat === 'odc' ? 'ODC' : cat === 'jb' ? 'JB' : cat === 'tiang' ? 'TNG' : 'ODP';
                                        setNewNodeName(`${prefix}-${Date.now().toString().slice(-4)}`);
                                    }}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-semibold"
                                >
                                    <option value="odp">ODP (Optical Distribution Point)</option>
                                    <option value="jb">JB (Joint Box / Closure Sambungan)</option>
                                    <option value="odc">ODC (Optical Distribution Cabinet)</option>
                                    <option value="tiang">TIANG (Tiang Distribusi FO)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">Nama Node:</label>
                                <input
                                    type="text"
                                    value={newNodeName}
                                    onChange={(e) => setNewNodeName(e.target.value)}
                                    placeholder="Contoh: JB-PSM-02"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono font-bold"
                                />
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">Parent Node (Titik Sumber):</label>
                                <select
                                    value={newNodeParentId}
                                    onChange={(e) => setNewNodeParentId(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                                >
                                    <option value="root-olt">OLT-PUSAT (Root)</option>
                                    {flattenedNodes
                                        .filter((n) => n.id !== 'root-olt')
                                        .map((n) => (
                                            <option key={`parent-opt-${n.id}`} value={n.id}>
                                                {n.name} ({n.type.toUpperCase()})
                                            </option>
                                        ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-300 mb-1">Kapasitas Port:</label>
                                    <select
                                        value={newNodePorts}
                                        onChange={(e) => setNewNodePorts(Number(e.target.value))}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                                    >
                                        <option value={4}>4 Port</option>
                                        <option value={8}>8 Port</option>
                                        <option value={12}>12 Port</option>
                                        <option value={16}>16 Port</option>
                                        <option value={24}>24 Port</option>
                                        <option value={48}>48 Port</option>
                                    </select>
                                </div>
                                <div className="flex items-center pt-5">
                                    <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                                        <input
                                            type="checkbox"
                                            checked={newNodeAutoCable}
                                            onChange={(e) => setNewNodeAutoCable(e.target.checked)}
                                            className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0"
                                        />
                                        <span className="text-[11px]">Auto Buat Kabel Masuk</span>
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">Alamat / Lokasi Tiang:</label>
                                <input
                                    type="text"
                                    value={newNodeAddress}
                                    onChange={(e) => setNewNodeAddress(e.target.value)}
                                    placeholder="Contoh: Jl. Kemang Timur Tiang No. 14"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                            <button
                                type="button"
                                onClick={() => setIsAddNodeModalOpen(false)}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateCustomNode}
                                className="px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg"
                            >
                                + Simpan Node
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Sisipkan JB pada Kabel (Titik Putus / Joint Closure) */}
            {splitCableTarget && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0f172a] border border-amber-500/40 rounded-2xl w-full max-w-md p-6 shadow-2xl text-white space-y-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                            <div>
                                <h3 className="text-base font-bold text-amber-300 flex items-center gap-2">
                                    <span>✂️ Sisipkan Joint Box (JB / Closure)</span>
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Potong bentangan kabel <strong className="text-slate-200 font-mono">{splitCableTarget.name}</strong> ({splitCableTarget.lengthMeters}m) untuk penempatan closure sambungan.
                                </p>
                            </div>
                            <button
                                onClick={() => setSplitCableTarget(null)}
                                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="space-y-3.5 text-xs">
                            {/* Detail Bentangan Lama */}
                            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between font-mono text-[11px]">
                                <div>
                                    <span className="text-slate-400 block text-[10px]">Dari:</span>
                                    <span className="text-cyan-300 font-bold">{splitCableTarget.fromNodeId}</span>
                                </div>
                                <div className="text-center text-slate-500">
                                    <span>── {splitCableTarget.lengthMeters}m ({splitCableTarget.totalCores}C) ──▶</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-slate-400 block text-[10px]">Ke:</span>
                                    <span className="text-emerald-300 font-bold">{splitCableTarget.toNodeId}</span>
                                </div>
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">Nama Joint Box / Closure:</label>
                                <input
                                    type="text"
                                    value={splitJbName}
                                    onChange={(e) => setSplitJbName(e.target.value)}
                                    placeholder="Contoh: JB-FDR-CMS01"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono font-bold"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-300 mb-1">Tipe Enclosure:</label>
                                    <select
                                        value={splitJbCategory}
                                        onChange={(e) => setSplitJbCategory(e.target.value as any)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                                    >
                                        <option value="jb">JB (Joint Box / Closure)</option>
                                        <option value="tiang">TIANG (Tiang Sambung)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-300 mb-1">Titik Putus / Jarak (m):</label>
                                    <input
                                        type="number"
                                        min="10"
                                        max={splitCableTarget.lengthMeters - 10}
                                        step="10"
                                        value={splitDistanceStart}
                                        onChange={(e) => setSplitDistanceStart(Number(e.target.value) || 10)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono font-bold"
                                    />
                                </div>
                            </div>

                            {/* Preview Segmen Baru */}
                            <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 text-slate-300 space-y-1.5">
                                <span className="text-[10px] font-bold uppercase text-amber-400 block">Hasil Pembagian Bentangan:</span>
                                <div className="text-[11px] font-mono space-y-1">
                                    <div className="flex justify-between">
                                        <span>Segmen 1 (IN): {splitCableTarget.fromNodeId} ➔ {splitJbName || 'JB'}</span>
                                        <span className="text-amber-300 font-bold">{splitDistanceStart} meter</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Segmen 2 (OUT): {splitJbName || 'JB'} ➔ {splitCableTarget.toNodeId}</span>
                                        <span className="text-amber-300 font-bold">{Math.max(10, splitCableTarget.lengthMeters - splitDistanceStart)} meter</span>
                                    </div>
                                </div>
                            </div>

                            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                                <label className="flex items-start gap-2.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={splitAutoSplice}
                                        onChange={(e) => setSplitAutoSplice(e.target.checked)}
                                        className="mt-0.5 rounded bg-slate-800 border-slate-600 text-amber-500 focus:ring-0"
                                    />
                                    <div className="text-slate-300">
                                        <span className="font-semibold block text-slate-200">
                                            Otomatis Sambung Lurus {splitCableTarget.totalCores} Core (Straight Splice)
                                        </span>
                                        <span className="text-[11px] text-slate-400 block mt-0.5">
                                            Dokumentasikan penyambungan fusion splice core 1–{splitCableTarget.totalCores} (Loss 0.05 dB) secara otomatis di tray closure.
                                        </span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                            <button
                                type="button"
                                onClick={() => setSplitCableTarget(null)}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmSplitCable}
                                className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-lg cursor-pointer flex items-center gap-1.5"
                            >
                                <span>✂️ Pasang JB & Sambung Core</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
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

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">
                                    Titik Sumber / Parent Node:
                                </label>
                                <select
                                    value={plannerParentId}
                                    onChange={(e) => setPlannerParentId(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
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
                                <label className="block font-semibold text-slate-300 mb-1">
                                    Nama ODP Rencana:
                                </label>
                                <input
                                    type="text"
                                    value={plannerName}
                                    onChange={(e) => setPlannerName(e.target.value)}
                                    placeholder="Contoh: ODP-TBT-03"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 font-semibold"
                                />
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">
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
                                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                                    />
                                    <span className="text-slate-400 font-mono">meter</span>
                                </div>
                                <span className="text-[10px] text-slate-400 mt-1 block">
                                    Loss kabel: {plannerCalculations.cableLoss} dB (rate 0.35 dB/km)
                                </span>
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">
                                    Jenis Kabel:
                                </label>
                                <select
                                    value={plannerCableType}
                                    onChange={(e) => setPlannerCableType(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                                >
                                    <option value="12C Distribusi">12 Core (Distribusi)</option>
                                    <option value="24C Feeder">24 Core (Feeder)</option>
                                    <option value="2C Dropcore">2 Core (Dropcore)</option>
                                    <option value="1C Dropcore">1 Core (Dropcore)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">
                                    Tipe Splitter ODP:
                                </label>
                                <select
                                    value={plannerSplitter}
                                    onChange={(e) => setPlannerSplitter(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
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
                                <label className="block font-semibold text-slate-300 mb-1">
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
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center text-white"
                                        />
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-400">Konektor (0.25 dB):</span>
                                        <input
                                            type="number"
                                            min="0"
                                            value={plannerConnectors}
                                            onChange={(e) => setPlannerConnectors(parseInt(e.target.value) || 0)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center text-white"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block font-semibold text-slate-300 mb-1">
                                    Kapasitas Port ODP:
                                </label>
                                <select
                                    value={plannerPorts}
                                    onChange={(e) => setPlannerPorts(parseInt(e.target.value) || 8)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                                >
                                    <option value={4}>4 Port</option>
                                    <option value={8}>8 Port</option>
                                    <option value={16}>16 Port</option>
                                    <option value={24}>24 Port</option>
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

            {/* Modal Konfirmasi Hapus ODP / ODC / Simulasi */}
            {deletingNode && (
                <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl text-white space-y-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-center gap-3 text-rose-400">
                            <span className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/40">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </span>
                            <div>
                                <h3 className="text-base font-bold text-slate-100">
                                    Hapus {deletingNode.isSimulated ? 'Simulasi' : deletingNode.type.toUpperCase()}
                                </h3>
                                <p className="text-xs text-slate-400 font-mono">
                                    {deletingNode.name}
                                </p>
                            </div>
                        </div>

                        {deleteError && (
                            <div className="bg-rose-950/80 border border-rose-500/60 text-rose-200 px-3.5 py-2.5 rounded-xl text-xs">
                                {deleteError}
                            </div>
                        )}

                        <p className="text-xs text-slate-300">
                            Apakah Anda yakin ingin menghapus <strong className="text-white font-mono">{deletingNode.name}</strong>?
                            Kabel dan sambungan splice yang terhubung ke node ini juga akan dilepas.
                        </p>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                            <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => {
                                    setDeletingNode(null);
                                    setDeleteError(null);
                                }}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => handleDeleteNode(deletingNode)}
                                className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                            >
                                {isDeleting ? 'Menghapus...' : 'Hapus Permanen'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Konfirmasi Hapus Kabel */}
            {deletingCable && (
                <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl text-white space-y-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-center gap-3 text-rose-400">
                            <span className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/40">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </span>
                            <div>
                                <h3 className="text-base font-bold text-slate-100">
                                    Hapus Kabel FO
                                </h3>
                                <p className="text-xs text-slate-400 font-mono">
                                    {deletingCable.name}
                                </p>
                            </div>
                        </div>

                        <p className="text-xs text-slate-300">
                            Apakah Anda yakin ingin menghapus ruas kabel <strong className="text-white font-mono">{deletingCable.name}</strong> ({deletingCable.totalCores} Core)?
                            Semua sambungan splice yang menggunakan kabel ini akan otomatis dilepas.
                        </p>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                            <button
                                type="button"
                                onClick={() => setDeletingCable(null)}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDeleteCable(deletingCable)}
                                className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition-all cursor-pointer"
                            >
                                Hapus Kabel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FiberCalculator;
