// FIX: Import `useMemo` from React to resolve 'Cannot find name' error.
import React, { useState, useEffect, useMemo } from 'react';
import { Customer, Invoice, Package, AcsDeviceDetails, formatRupiah, HotspotUser } from '../../types';
import Card from '../../components/common/Card';
import { RxPowerDisplay } from './shared/RxPowerDisplay';
import { fetchWithAuth } from '~/components/api';
// import PPOBSection from './PPOBSection';

const formatMacAddress = (mac: any): string => {
    if (mac === null || mac === undefined) return 'N/A';

    const extractRaw = (): string => {
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
            const primitiveChild = Object.values(mac).find(v => typeof v === 'string' || typeof v === 'number');
            if (primitiveChild !== undefined) return String(primitiveChild);
        }
        return '';
    };

    const raw = extractRaw();
    if (!raw) return 'N/A';

    const cleaned = raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    if (cleaned.length >= 12) {
        const trimmed = cleaned.slice(0, 12);
        const grouped = trimmed.match(/.{1,2}/g);
        return grouped ? grouped.join(':') : trimmed;
    }

    return raw;
};

const normalizeMacKey = (mac: any, fallback: string) => {
    const formatted = formatMacAddress(mac);
    if (formatted && formatted !== 'N/A') {
        return formatted.replace(/[^A-F0-9]/g, '');
    }
    if (typeof mac === 'string') return mac;
    return fallback;
};

interface CustomerHomeProps {
    customer: Customer;
    unpaidInvoices: Invoice[];
    customerPackage: Package | null;
    deviceDetails: AcsDeviceDetails | null;
    isDeviceLoading: boolean;
    deviceError: string | null;
    isRebooting: boolean;
    isSavingWlan: boolean;
    onRebootDevice: () => Promise<void>;
    onSaveWlan: (wlanFormData: { ssid: string; key: string }) => Promise<{ success: boolean; message?: string } | undefined>;
    onRefreshDevice: () => Promise<void>;
    onNavigateToBills: () => void;
    bonusVoucher: HotspotUser | null;
}

const LiveSpeedMonitor: React.FC<{ customer: Customer }> = ({ customer }) => {
    const [liveTraffic, setLiveTraffic] = useState({ rx: 0, tx: 0 });
    const [error, setError] = useState<string | null>(null);
    const lastErrorRef = React.useRef<string | null>(null);

    useEffect(() => {
        if (!customer.id || !customer.pppoeUsername) {
            return; // No user to monitor
        }

        const fetchTraffic = async () => {
            try {
                const res = await fetchWithAuth(`/api/customers/${customer.id}/live-traffic`);
                const data = await res.json();
                
                const nextError = data.error ? String(data.error) : null;
                if (nextError !== lastErrorRef.current) {
                    lastErrorRef.current = nextError;
                    setError(nextError);
                }
                setLiveTraffic({ rx: data.rx || 0, tx: data.tx || 0 });

            } catch (err: any) {
                console.error("Live traffic poll error:", err);
                const nextError = err.message || 'Could not connect to monitor.';
                if (nextError !== lastErrorRef.current) {
                    lastErrorRef.current = nextError;
                    setError(nextError);
                }
            }
        };

        fetchTraffic(); // Initial fetch
        const intervalId = setInterval(fetchTraffic, 3000); // Poll every 3 seconds

        return () => clearInterval(intervalId);
    }, [customer.id, customer.pppoeUsername]);

    const formatBits = (bits: number) => {
        if (bits < 1000) return `${bits.toFixed(0)} bps`;
        if (bits < 1000000) return `${(bits / 1000).toFixed(1)} Kbps`;
        return `${(bits / 1000000).toFixed(2)} Mbps`;
    };

    return (
        <div className="text-right flex-shrink-0">
            {error ? (
                <p className="text-xs text-red-500">{error}</p>
            ) : (
                <>
                    {/* Download (RX) */}
                    <div className="flex items-center justify-end gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                        <span className="font-semibold text-base text-blue-600 dark:text-blue-400 w-24 text-left">{formatBits(liveTraffic.tx)}</span>
                    </div>

                    {/* upload (TX) */}
                    <div className="flex items-center justify-end gap-2 mt-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                        </svg>
                        <span className="font-semibold text-base text-red-600 dark:text-red-400 w-24 text-left">{formatBits(liveTraffic.rx)}</span>
                    </div>
                </>
            )}
        </div>
    );
};


const CustomerHome: React.FC<CustomerHomeProps> = ({
    customer,
    unpaidInvoices,
    customerPackage,
    deviceDetails,
    isDeviceLoading,
    deviceError,
    isRebooting,
    isSavingWlan,
    onRebootDevice,
    onSaveWlan,
    onRefreshDevice,
    onNavigateToBills,
    bonusVoucher,
}) => {
    const totalUnpaid = unpaidInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const [isEditingWlan, setIsEditingWlan] = useState(false);
    const [wlanForm, setWlanForm] = useState({ ssid: '', key: '' });
    const [isDeviceListVisible, setIsDeviceListVisible] = useState(false);

    const CopyButton = ({ textToCopy }: { textToCopy: string }) => {
        const [copied, setCopied] = useState(false);
        const handleCopy = () => {
            navigator.clipboard.writeText(textToCopy).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            });
        };
        return (
            <button onClick={handleCopy} className="p-2 rounded-md bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
                {copied ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                )}
            </button>
        );
    };

    // Tampilkan hanya SSID1 (2.4G) dan SSID5 (5G)
    const wlanConfigs = useMemo(() => {
        if (!deviceDetails?.wlanConfigs) return [];
        const isSsid1Or5 = (cfg: any) => {
            const path = (cfg.ssidPath || cfg.keyPath || '').toLowerCase();
            return /\.1\.ssid$/.test(path) || /\.5\.ssid$/.test(path);
        };
        // Hanya ambil yang path-nya jelas SSID index 1 atau 5
        return deviceDetails.wlanConfigs.filter(cfg => isSsid1Or5(cfg));
    }, [deviceDetails]);
    
    // Combine devices from all available WLAN configs (2.4GHz and 5GHz)
    const allAssociatedDevices = useMemo(() => {
        if (!wlanConfigs || wlanConfigs.length === 0) {
            return [];
        }
        // Flatten the arrays of associated devices from all WLAN configs
        const allDevices = wlanConfigs.flatMap(config => config.associatedDevices || []);
        // Remove potential duplicates based on normalized MAC address, in case a device is reported on multiple bands
        const uniqueDevices = Array.from(new Map(allDevices.map((device, idx) => {
            const key = normalizeMacKey(device.mac, `idx-${idx}`);
            return [key, { ...device, mac: formatMacAddress(device.mac) }];
        })).values());
        return uniqueDevices;
    }, [wlanConfigs]);


    useEffect(() => {
        if (wlanConfigs.length > 0) {
            const ssid1 = wlanConfigs.find(c => c.ssidPath?.endsWith('.1.SSID'));
            const initialConfig = ssid1 || wlanConfigs[0];
            setWlanForm({
                ssid: initialConfig.ssid,
                key: initialConfig.key,
            });
        }
    }, [wlanConfigs]);


    const handleWlanSave = async () => {
        const result = await onSaveWlan(wlanForm);
        if (result?.success) {
            setIsEditingWlan(false);
        }
    };

const renderDeviceManagement = () => {
    if (!customer.acsSerialNumber) {
        return <p className="text-sm text-gray-500 dark:text-gray-400">Belum ada Perangkat yang dihubungkan ke akun kamu.</p>;
    }
    if (isDeviceLoading) {
        return (
            <div className="text-center p-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Loading device status...</p>
            </div>
        );
    }
    if (deviceError) {
        return (
            <div className="p-3 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-md text-sm">
                <p className="font-medium">Error loading device</p>
                <p>{deviceError}</p>
                <button 
                    onClick={onRefreshDevice}
                    className="mt-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                >
                    Try Again
                </button>
            </div>
        );
    }
    if (!deviceDetails) {
        return (
            <div className="text-center p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">Could not retrieve device information.</p>
                <button 
                    onClick={onRefreshDevice}
                    className="mt-2 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                >
                    Refresh Device
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Device Status Info */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                    <p className="font-medium text-gray-500 dark:text-gray-400">Device Status</p>
                    <div className="flex items-center space-x-2">
                         <span className={`h-2.5 w-2.5 rounded-full ${deviceDetails.isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                         <span className={`font-semibold ${deviceDetails.isOnline ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                             {deviceDetails.isOnline ? 'Online' : 'Offline'}
                         </span>
                    </div>
                </div>
                 <div>
                    <p className="font-medium text-gray-500 dark:text-gray-400">Model</p>
                    <p className="font-semibold text-gray-800 dark:text-gray-200">{deviceDetails.model}</p>
                </div>
                 <div>
                    <p className="font-medium text-gray-500 dark:text-gray-400">Optical Power (RX)</p>
                    <RxPowerDisplay rxPower={deviceDetails.rxPower} />
                </div>
            </div>

            {/* WLAN Settings Section */}
            {wlanConfigs.length > 0 ? (
                <div className="pt-4 border-t dark:border-gray-700">
                    {isEditingWlan ? (
                        <div className="space-y-3">
                            <h4 className="text-md font-semibold text-gray-700 dark:text-gray-300">Edit Wi-Fi Settings</h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
                                Perubahan ini akan diterapkan ke semua jaringan Wi-Fi Anda (2.4GHz & 5GHz).
                            </p>
                            <div>
                                <label className="text-xs font-medium text-gray-500">Wi-Fi Name (SSID)</label>
                                <input 
                                    type="text" 
                                    value={wlanForm.ssid} 
                                    onChange={(e) => setWlanForm({...wlanForm, ssid: e.target.value})} 
                                    className="mt-1 w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600" 
                                    placeholder="Enter Wi-Fi name"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-500">Wi-Fi Password</label>
                                <input 
                                    type="text" 
                                    value={wlanForm.key} 
                                    onChange={(e) => setWlanForm({...wlanForm, key: e.target.value})} 
                                    className="mt-1 w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600" 
                                    placeholder="Enter Wi-Fi password"
                                />
                                <p className="text-xs text-gray-500 mt-1">Min 8 karakter. Biarkan kosong jika tidak ingin ganti.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={handleWlanSave} 
                                    disabled={isSavingWlan} 
                                    className="px-3 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-400"
                                >
                                    {isSavingWlan ? 'Saving...' : 'Save Changes'}
                                </button>
                                <button 
                                    onClick={() => setIsEditingWlan(false)} 
                                    className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <h4 className="text-md font-semibold text-gray-700 dark:text-gray-300">Wi-Fi Settings</h4>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => setIsEditingWlan(true)} 
                                        className="text-xs font-medium text-blue-600 hover:underline"
                                    >
                                        Edit
                                    </button>
                                </div>
                            </div>
                            {wlanConfigs.map((config, index) => (
                                <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <div>
                                        <p className="font-medium text-gray-500 dark:text-gray-400">
                                            {config.band === '2.4' ? 'Wi-Fi 2.4GHz' :
                                             config.band === '5' ? 'Wi-Fi 5GHz' :
                                             `Wi-Fi ${index + 1}`}
                                        </p>
                                        <p className="font-semibold text-gray-800 dark:text-gray-200 text-lg mt-1">
                                            {config.ssid || 'Not Set'}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                            {config.associatedDevices?.length || 0} devices connected
                                        </p>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-500 dark:text-gray-400">Wi-Fi Password</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <p className="font-semibold text-gray-800 dark:text-gray-200 font-mono text-sm break-all">
                                                {config.key || <span className="text-xs text-gray-500 dark:text-gray-400">Password Tdk ditampilkan</span>}
                                            </p>
                                        </div>
                                    </div>
                                    
                                  
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="pt-4 border-t dark:border-gray-700">
                    <div className="text-center p-6 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                        <p className="text-sm text-yellow-700 dark:text-yellow-300">
                            No Wi-Fi configuration data available
                        </p>
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                            Try refreshing the device or check if your router supports this feature
                        </p>
                    </div>
                </div>
            )}
            
            {/* All Connected Devices Summary */}
            {allAssociatedDevices && allAssociatedDevices.length > 0 && (
                <div className="pt-4 border-t dark:border-gray-700">
                    <div className="flex justify-between items-center mb-3">
                        <h4 className="text-md font-semibold text-gray-700 dark:text-gray-300">
                            All Connected Devices ({allAssociatedDevices.length})
                        </h4>
                        <button
                            onClick={() => setIsDeviceListVisible(!isDeviceListVisible)}
                            className="text-xs font-medium text-blue-600 hover:underline"
                            aria-expanded={isDeviceListVisible}
                        >
                            {isDeviceListVisible ? 'Hide List' : 'Show List'}
                        </button>
                    </div>
                    {isDeviceListVisible && (
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                            {allAssociatedDevices.map((dev, idx) => {
                                const formattedMac = formatMacAddress(dev.mac);
                                const key = normalizeMacKey(dev.mac, `dev-${idx}`);
                                return (
                                    <div key={key} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                                        <div className="flex-1">
                                            <p className="font-semibold text-gray-800 dark:text-gray-200">
                                                {dev.hostname || 'Unknown Device'}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                                                MAC: {formattedMac}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-gray-600 dark:text-gray-300">
                                                {dev.signal ? `Signal: ${dev.signal} dBm` : 'Signal: N/A'}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                                                IP: {dev.ip || 'N/A'}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            
            {/* Action Buttons */}
            <div className="pt-4 border-t dark:border-gray-700">
                <div className="flex flex-wrap gap-3">
                    <button 
                        onClick={onRebootDevice} 
                        disabled={isRebooting || !deviceDetails.isOnline} 
                        className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isRebooting ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Rebooting...
                            </>
                        ) : (
                            'Reboot Device'
                        )}
                    </button>
                    
                    <button 
                        onClick={onRefreshDevice} 
                        disabled={isDeviceLoading} 
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isDeviceLoading ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                                Refreshing...
                            </>
                        ) : (
                            'Refresh Data'
                        )}
                    </button>
                </div>
                
             
            </div>
        </div>
    );
};

    return (
        <div className="py-6 space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Welcome, {customer.name.split(' ')[0]}!</h2>
            
            {totalUnpaid > 0 && (
                <Card className="!bg-yellow-50 dark:!bg-yellow-800/20 border-l-4 border-yellow-500">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <p className="font-semibold text-yellow-800 dark:text-yellow-300">You have unpaid bills</p>
                            <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-200">{formatRupiah(totalUnpaid)}</p>
                        </div>
                        <button onClick={onNavigateToBills} className="bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 text-sm font-semibold shadow-sm">
                            View & Pay
                        </button>
                    </div>
                </Card>
            )}

            {bonusVoucher && (
                <Card title="Bonus Hotspot Voucher">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Sebagai pelanggan aktif, Anda mendapatkan bonus voucher hotspot yang dapat digunakan di area jangkauan kami.
                    </p>
                    <div className="space-y-3">
                        <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded-md">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Voucher</p>
                            <div className="flex justify-between items-center">
                                <p className="font-mono text-lg font-semibold text-gray-800 dark:text-gray-200">{bonusVoucher.name}</p>
                                <CopyButton textToCopy={bonusVoucher.name} />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Username & Password sama</p>
                        </div>
            
                        <div className="flex justify-between items-center pt-2">
                             <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Status:</p>
                             <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${!bonusVoucher.disabled ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                                <span className={`font-semibold text-sm ${!bonusVoucher.disabled ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {!bonusVoucher.disabled ? 'Aktif' : 'Nonaktif'}
                                </span>
                             </div>
                        </div>
                    </div>
                </Card>
            )}

            <Card title="My Service & Status">
                <div className="flex justify-between items-center gap-4">
                    {/* Left Side: Package Details */}
                    <div>
                        {customerPackage ? (
                            <>
                                <p className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">{customerPackage.name}</p>
                                <p className="text-md sm:text-lg font-semibold text-gray-700 dark:text-gray-300">{customerPackage.speed} Mbps</p>
                                <p className="text-sm sm:text-md text-gray-500 dark:text-gray-400">{formatRupiah(customerPackage.price)} / month</p>
                            </>
                        ) : (
                            <p className="text-gray-500">Package details not found.</p>
                        )}
                    </div>

                    {/* Right Side: Live Speed Monitor */}
                    {customer.pppoeUsername && (
                        <LiveSpeedMonitor customer={customer} />
                    )}
                </div>
            </Card>

            {/* <Card title="Beli Pulsa & Bayar Tagihan">
                <PPOBSection />
            </Card> */}

            <Card title="Device Management">
                {renderDeviceManagement()}
            </Card>
        </div>
    );
};

export default CustomerHome;
