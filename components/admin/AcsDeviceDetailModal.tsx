import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AcsDevice, AcsDeviceFullDetails } from '../../types';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api/acs';

// Helper component for collapsible sections
const AccordionSection: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="border rounded-md dark:border-gray-700 bg-white dark:bg-gray-800">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex justify-between items-center p-3 font-semibold text-left bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-t-md"
            >
                <span>{title}</span>
                <svg className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"></path></svg>
            </button>
            {isOpen && <div className="p-4 border-t dark:border-gray-600 text-sm">{children}</div>}
        </div>
    );
};

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <>
        <dt className="font-semibold text-gray-600 dark:text-gray-400 truncate" title={label}>{label}</dt>
        <dd className="text-gray-800 dark:text-gray-200 truncate">{value || <span className="text-gray-400 italic">N/A</span>}</dd>
    </>
);

const RxPowerDisplay: React.FC<{ rxPower: string }> = ({ rxPower }) => {
    if (rxPower === 'N/A') {
        return <span className="text-gray-400">N/A</span>;
    }
    const powerValue = parseFloat(rxPower);
    if (isNaN(powerValue)) {
        return <span className="text-gray-400">{rxPower}</span>;
    }
    let colorClass = 'text-gray-800 dark:text-gray-200';
    if (powerValue > -25) {
        colorClass = 'text-green-600 dark:text-green-400';
    } else if (powerValue >= -28) {
        colorClass = 'text-yellow-600 dark:text-yellow-400';
    } else {
        colorClass = 'text-red-600 dark:text-red-400';
    }
    return <span className={`font-semibold ${colorClass}`}>{rxPower}</span>;
};

const formatMacAddress = (mac: any): string => {
    if (mac === null || mac === undefined) return 'N/A';

    const rawValue = (() => {
        if (typeof mac === 'string' || typeof mac === 'number') return String(mac);
        if (typeof mac === 'object') {
            const candidates = [
                (mac as any).mac,
                (mac as any).address,
                (mac as any).value,
                (mac as any)._value,
                (mac as any).MACAddress,
                (mac as any).PhysAddress
            ];
            for (const candidate of candidates) {
                if (candidate !== undefined && candidate !== null) return String(candidate);
            }
            const primitive = Object.values(mac).find(v => typeof v === 'string' || typeof v === 'number');
            if (primitive !== undefined) return String(primitive);
        }
        return '';
    })();

    if (!rawValue) return 'N/A';
    const cleaned = rawValue.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    if (cleaned.length >= 12) {
        const trimmed = cleaned.slice(0, 12);
        const grouped = trimmed.match(/.{1,2}/g);
        return grouped ? grouped.join(':') : trimmed;
    }
    return rawValue;
};

const encodeAcsDeviceId = (deviceId: string) => encodeURIComponent(String(deviceId ?? '').trim());

interface AcsDeviceDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    device: AcsDevice | null;
}

const AcsDeviceDetailModal: React.FC<AcsDeviceDetailModalProps> = ({ isOpen, onClose, device }) => {
    const [details, setDetails] = useState<AcsDeviceFullDetails | null>(null);
    const [rawJson, setRawJson] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isRebooting, setIsRebooting] = useState(false);

    const [editingWlanIndex, setEditingWlanIndex] = useState<number | null>(null);
    const [wlanEditData, setWlanEditData] = useState({ ssid: '', key: '' });
    const [isSavingWlan, setIsSavingWlan] = useState(false);
    const [wlanError, setWlanError] = useState<string | null>(null);

    const [editingWanIndex, setEditingWanIndex] = useState<number | null>(null);
    const [wanFormData, setWanFormData] = useState({ username: '', password: '' });
    const [isSavingWan, setIsSavingWan] = useState(false);
    const [wanError, setWanError] = useState<string | null>(null);
    const encodedDeviceId = device ? encodeAcsDeviceId(device.id) : '';

    const fetchDetails = useCallback(async () => {
        if (!device) return;
        setIsLoading(true);
        setError(null);
        setDetails(null);
        setRawJson('');
        try {
            const res = await fetchWithAuth(`${API_URL}/devices/${encodedDeviceId}/details`);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || `Failed to fetch details for ${device.id}`);
            }
            const data: AcsDeviceFullDetails = await res.json();
            setDetails(data);
            setRawJson(JSON.stringify(data.raw || data, null, 2));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [device]);

    useEffect(() => {
        if (isOpen && device) {
            fetchDetails();
        }
    }, [isOpen, device, fetchDetails]);

    const handleReboot = useCallback(async () => {
        if (!device) return;

        if (!device.isOnline) {
            alert("Cannot send reboot command: Device is offline.");
            return;
        }

        if (!window.confirm(`Are you sure you want to reboot the device ${device.serialNumber}? The device will go offline temporarily.`)) {
            return;
        }
        
        setIsRebooting(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/devices/${encodedDeviceId}/reboot`, {
                method: 'POST',
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to send reboot command.');
            }
            alert(data.message);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsRebooting(false);
        }
    }, [device]);

    const handleSaveWlan = async (wlanConfig: any, idx: number) => {
        // Derive/normalisasi path agar skema IGD/TR-181 tetap konsisten
        const preferIgd = !!((wlanConfig.ssidPath || wlanConfig.keyPath || '')?.includes('InternetGatewayDevice'));

        const derivePaths = (config: any, index: number) => {
            let ssidPath = config.ssidPath;
            let keyPath = config.keyPath;
            const forcedIndex = config.band === '5' ? 5 : config.band === '2.4' ? 1 : index;

            const detectScheme = (path?: string | null) => {
                if (!path) return null;
                if (path.includes('InternetGatewayDevice')) return 'igd';
                if (path.includes('Device.WiFi')) return 'device';
                return null;
            };

            let scheme = detectScheme(ssidPath) || detectScheme(keyPath) || (preferIgd ? 'igd' : null);

            if (!ssidPath && keyPath) {
                if (keyPath.includes('InternetGatewayDevice')) {
                    ssidPath = keyPath.replace(/KeyPassphrase|PreSharedKey\.\d+\.PreSharedKey/g, 'SSID');
                    scheme = 'igd';
                } else if (keyPath.includes('Device.WiFi.AccessPoint')) {
                    const m = keyPath.match(/Device\.WiFi\.AccessPoint\.(\d+)\.Security/);
                    const apIdx = m ? m[1] : forcedIndex;
                    ssidPath = `Device.WiFi.SSID.${apIdx}.SSID`;
                    scheme = 'device';
                }
            }

            if (!keyPath && ssidPath) {
                if (ssidPath.includes('InternetGatewayDevice')) {
                    keyPath = ssidPath.replace(/SSID$/, 'KeyPassphrase');
                    if (keyPath === ssidPath) {
                        keyPath = ssidPath.replace(/SSID$/, 'PreSharedKey.1.PreSharedKey');
                    }
                    scheme = 'igd';
                } else if (ssidPath.includes('Device.WiFi.SSID')) {
                    const m = ssidPath.match(/Device\.WiFi\.SSID\.(\d+)/);
                    const apIdx = m ? m[1] : forcedIndex;
                    keyPath = `Device.WiFi.AccessPoint.${apIdx}.Security.KeyPassphrase`;
                    scheme = 'device';
                }
            }

            if (!scheme) scheme = 'device';

            if (!ssidPath) {
                ssidPath = scheme === 'igd'
                    ? `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${forcedIndex}.SSID`
                    : `Device.WiFi.SSID.${forcedIndex}.SSID`;
            }
            if (!keyPath) {
                keyPath = scheme === 'igd'
                    ? `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${forcedIndex}.PreSharedKey.1.PreSharedKey`
                    : `Device.WiFi.AccessPoint.${forcedIndex}.Security.KeyPassphrase`;
            }
            return { ssidPath, keyPath };
        };

        const paths = derivePaths(wlanConfig, idx + 1);

        setIsSavingWlan(true);
        setWlanError(null);
        
        try {
            const parameters: { path: string, value: string }[] = [];
            parameters.push({ path: paths.ssidPath, value: wlanEditData.ssid });

            if (wlanEditData.key) {
                parameters.push({ path: paths.keyPath, value: wlanEditData.key });
            }

            if (parameters.length === 0) {
                throw new Error("No parameters to update.");
            }
            
            const res = await fetchWithAuth(`${API_URL}/devices/${encodedDeviceId}/set-parameters`, {
                method: 'POST',
                body: JSON.stringify({ parameters }),
            });
    
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to save WLAN settings.');
            }
            
            setEditingWlanIndex(null);
            alert(`SSID "${wlanConfig.name}" updated successfully! The device will apply changes shortly.`);
            setTimeout(fetchDetails, 5000);
    
        } catch (err: any) {
            setWlanError(err.message);
        } finally {
            setIsSavingWlan(false);
        }
    };
    
    const handleSaveWan = async (wanConfig: any) => {
        setIsSavingWan(true);
        setWanError(null);

        if (!wanConfig.usernamePath) {
            setWanError("Cannot save: The username parameter path for this device model is unknown.");
            setIsSavingWan(false);
            return;
        }

        try {
            const parameters = [{ path: wanConfig.usernamePath, value: wanFormData.username }];
            if (wanFormData.password) {
                 if (!wanConfig.passwordPath) {
                    throw new Error("Could not determine the password parameter path for this device model. Password cannot be changed.");
                 }
                parameters.push({ path: wanConfig.passwordPath, value: wanFormData.password });
            }
            
            const res = await fetchWithAuth(`${API_URL}/devices/${encodedDeviceId}/set-parameters`, {
                method: 'POST',
                body: JSON.stringify({ parameters }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to save PPPoE settings.');
            
            setEditingWanIndex(null);
            alert('PPPoE settings saved successfully! The device may need to reconnect to apply them.');
            setTimeout(fetchDetails, 3000);

        } catch (err: any) {
            setWanError(err.message);
        } finally {
            setIsSavingWan(false);
        }
    };

    const uptimeSeconds = Number(details?.general?.uptime);
    const uptimeValue = !isNaN(uptimeSeconds) && uptimeSeconds > 0
        ? `${Math.floor(uptimeSeconds / 86400)}d ${Math.floor((uptimeSeconds % 86400) / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`
        : null;

    // Filter WLAN list to hide meta entries such as "_object" etc.
    const displayWlanList = useMemo(() => {
        if (!details?.wlan) return [];
        return details.wlan.filter(w => {
            const marker = `${w.name || ''} ${w.ssid || ''}`.toLowerCase();
            return !marker.includes('_object') && !marker.includes('_timestamp') && !marker.includes('_writable');
        });
    }, [details]);


    if (!isOpen || !device) return null;

    return (
        <div className="fixed z-20 inset-0 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                <div className="bg-gray-100 dark:bg-gray-900 rounded-lg shadow-xl p-6 z-30 w-full max-w-4xl max-h-[90vh] flex flex-col">
                    <div className="flex-shrink-0 flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{details?.general?.model || device.productClass}</h2>
                            <p className="text-sm font-mono text-gray-500 dark:text-gray-400">{device.serialNumber}</p>
                        </div>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    <div className="flex-shrink-0 mb-4 p-3 bg-gray-50 dark:bg-gray-800 border-y dark:border-gray-700 flex items-center gap-4">
                        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300">Device Actions:</h3>
                        <button
                            onClick={handleReboot}
                            disabled={isRebooting || !device.isOnline}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors shadow-sm disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                            title={!device.isOnline ? 'Device is offline' : 'Reboot the device'}
                        >
                            {isRebooting ? (
                                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 -ml-1 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5a1 1 0 11-2 0V4a1 1 0 011-1zM5.293 5.293a1 1 0 011.414 0l.707.707A5.003 5.003 0 007 10a5 5 0 108.536-3.536l.707-.707a1 1 0 111.414 1.414l-.707.707A7.002 7.002 0 115.293 5.293z" clipRule="evenodd" />
                                </svg>
                            )}
                            {isRebooting ? 'Rebooting...' : 'Reboot Device'}
                        </button>
                    </div>
                    
                    <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                        {isLoading && <p className="text-center p-8 text-gray-500 dark:text-gray-400">Loading device details...</p>}
                        {error && !isRebooting && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
                        
                        {details && (
                            <>
                                <AccordionSection title="General Information" defaultOpen>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                                        <DetailRow label="Model" value={details.general?.model} />
                                        <DetailRow label="Firmware" value={details.general?.firmware} />
                                        <DetailRow label="Hardware" value={details.general?.hardwareVersion} />
                                        <DetailRow label="Uptime" value={uptimeValue} />
                                    </dl>
                                </AccordionSection>
                                
                                <AccordionSection title="WAN Connections">
                                    {details.wan?.length > 0 ? details.wan.map((conn, index) => (
                                        <div key={index} className="mb-2 p-3 border-b last:border-b-0 dark:border-gray-600">
                                            {editingWanIndex === index ? (
                                                <div className="space-y-3">
                                                    <div className="flex justify-between items-center">
                                                        <p className="font-semibold">Editing {conn.type} Connection #{index + 1}</p>
                                                        <button onClick={() => setEditingWanIndex(null)} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium">Username</label>
                                                        <input type="text" value={wanFormData.username} onChange={(e) => setWanFormData(p => ({...p, username: e.target.value}))} className="w-full mt-1 p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600"/>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium">New Password</label>
                                                        <input type="password" value={wanFormData.password} onChange={(e) => setWanFormData(p => ({...p, password: e.target.value}))} className="w-full mt-1 p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600" placeholder="Leave blank to keep unchanged"/>
                                                    </div>
                                                    {wanError && <p className="text-xs text-red-500">{wanError}</p>}
                                                    <button onClick={() => handleSaveWan(conn)} disabled={isSavingWan} className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400">
                                                        {isSavingWan ? 'Saving...' : 'Save Changes'}
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex justify-between items-center mb-2">
                                                        <p className="font-semibold">{conn.type} Connection #{index + 1}</p>
                                                        {conn.type?.toUpperCase() === 'PPPOE' && (
                                                            <button onClick={() => { setEditingWanIndex(index); setWanFormData({ username: conn.username || '', password: '' }); setWanError(null); }} className="text-xs font-medium text-blue-600 hover:underline">Edit</button>
                                                        )}
                                                    </div>
                                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                                                        <DetailRow label="Status" value={conn.status} />
                                                        <DetailRow label="Username" value={conn.username} />
                                                        <DetailRow label="External IP" value={<span className="font-mono">{conn.ip}</span>} />
                                                        <DetailRow label="DNS Servers" value={<span className="font-mono">{conn.dns}</span>} />
                                                        {conn.rxPower && conn.rxPower !== 'N/A' && (
                                                            <DetailRow label="RX Power" value={<RxPowerDisplay rxPower={conn.rxPower} />} />
                                                        )}
                                                    </dl>
                                                </>
                                            )}
                                        </div>
                                    )) : <p className="text-gray-500 dark:text-gray-400">No WAN connection data found.</p>}
                                </AccordionSection>
                                
                                <AccordionSection title="WLAN Configuration">
                                    {wlanError && <p className="text-xs text-red-500 p-3">{wlanError}</p>}
                                    {displayWlanList.length > 0 ? displayWlanList.map((wifi, index) => (
                                        <div key={index} className="p-3 border-b last:border-b-0 dark:border-gray-600">
                                            {editingWlanIndex === index ? (
                                                <div className="space-y-3">
                                                    <div className="flex justify-between items-center">
                                                        <p className="font-semibold">Editing {wifi.name}</p>
                                                        <button onClick={() => setEditingWlanIndex(null)} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium">New SSID</label>
                                                        <input type="text" value={wlanEditData.ssid} onChange={(e) => setWlanEditData(prev => ({...prev, ssid: e.target.value}))} className="w-full mt-1 p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600"/>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium">New Wi-Fi Key</label>
                                                        <input type="text" value={wlanEditData.key} onChange={(e) => setWlanEditData(prev => ({...prev, key: e.target.value}))} className="w-full mt-1 p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600" placeholder="Leave blank to keep unchanged"/>
                                                    </div>
                                                    <button onClick={() => handleSaveWlan(wifi, index)} disabled={isSavingWlan} className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400">
                                                        {isSavingWlan ? 'Saving...' : `Save ${wifi.name}`}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div className="flex justify-between items-center mb-2">
                                                        <p className="font-semibold">{wifi.name} - <strong>{wifi.ssid}</strong></p>
                                                        <button onClick={() => { setEditingWlanIndex(index); setWlanEditData({ ssid: wifi.ssid || '', key: '' }); setWlanError(null); }} className="text-xs font-medium text-blue-600 hover:underline">Edit</button>
                                                    </div>
                                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                                                        <DetailRow label="Enabled" value={String(wifi.enabled)} />
                                                        <DetailRow label="Status" value={wifi.status} />
                                                        <DetailRow label="Security" value={wifi.security} />
                                                        <DetailRow label="Wi-Fi Key" value={<span className="font-mono break-all text-sm">{wifi.key || <span className="text-xs text-gray-500 dark:text-gray-400">Password Tdk ditampilkan</span>}</span>} />
                                                    </dl>
                                                    {/* Connected clients for this SSID */}
                                                    <details className="mt-3">
                                                        <summary className="text-xs font-semibold text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                                                            Connected Clients ({wifi.associatedDevices?.length || 0})
                                                        </summary>
                                                        <div className="mt-2">
                                                            {wifi.associatedDevices && wifi.associatedDevices.length > 0 ? (
                                                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                                                    {wifi.associatedDevices.map((dev: any, idx: number) => {
                                                                        const mac = formatMacAddress(dev.mac);
                                                                        const key = mac !== 'N/A' ? mac : `dev-${idx}`;
                                                                        return (
                                                                            <div key={key} className="p-2 bg-gray-50 dark:bg-gray-800/60 rounded border border-gray-200 dark:border-gray-700 flex justify-between items-center text-xs">
                                                                                <div className="flex-1">
                                                                                    <p className="font-semibold text-gray-800 dark:text-gray-200">{dev.hostname || 'Unknown Device'}</p>
                                                                                    <p className="font-mono text-gray-600 dark:text-gray-400">MAC: {mac}</p>
                                                                                </div>
                                                                                <div className="text-right">
                                                                                    <p className="font-mono text-gray-600 dark:text-gray-400">IP: {dev.ip || 'N/A'}</p>
                                                                                    <p className="text-gray-600 dark:text-gray-400">Signal: {dev.signal || 'N/A'}</p>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            ) : (
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">No clients connected.</p>
                                                            )}
                                                        </div>
                                                    </details>
                                                </div>
                                            )}
                                        </div>
                                    )) : <p className="text-gray-500 dark:text-gray-400">No WLAN configuration data found.</p>}
                                </AccordionSection>

                                <AccordionSection title="LAN Interface">
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                                        <DetailRow label="IP Address" value={<span className="font-mono">{details.lan?.ip}</span>} />
                                        <DetailRow label="Subnet Mask" value={<span className="font-mono">{details.lan?.subnet}</span>} />
                                    </dl>
                                </AccordionSection>

                                <AccordionSection title={`Connected LAN Devices (${details.lan?.connectedHosts?.length || 0})`}>
                                    {details.lan?.connectedHosts && details.lan.connectedHosts.length > 0 ? (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left">
                                                <thead className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                                                    <tr><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Hostname</th><th className="py-2 pr-4">IP Address</th><th className="py-2 pr-4">MAC Address</th></tr>
                                                </thead>
                                                <tbody className="divide-y dark:divide-gray-700">
                                                    {details.lan.connectedHosts.map((host, index) => (
                                                        <tr key={host.mac || index}>
                                                            <td className="py-2 pr-4 whitespace-nowrap"><div className="flex items-center"><span className={`h-2.5 w-2.5 rounded-full mr-2 ${host.active ? 'bg-green-500' : 'bg-gray-400'}`}></span>{host.active ? 'Active' : 'Inactive'}</div></td>
                                                            <td className="py-2 pr-4 truncate" title={host.hostname}>{host.hostname}</td>
                                                            <td className="py-2 pr-4 font-mono">{host.ip}</td>
                                                            <td className="py-2 pr-4 font-mono">{host.mac}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 dark:text-gray-400">No connected devices found or data is not available from this device.</p>
                                    )}
                                </AccordionSection>

                                <AccordionSection title="Raw Parameters">
                                    <pre className="text-xs bg-gray-200 dark:bg-gray-800 p-2 rounded-md max-h-80 overflow-auto"><code>{rawJson}</code></pre>
                                </AccordionSection>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AcsDeviceDetailModal;
