import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import Card from '~/components/common/Card';
import { fetchWithAuth } from '~/components/api';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface MikrotikInterface {
    id: string;
    name: string;
    type: string;
    running: boolean;
}

const API_URL = '/api/network';
const MAX_DATA_POINTS = 30; // Show last 30 data points (e.g., 90 seconds if polling every 3s)
const POLLING_INTERVAL = 3000; // 3 seconds

const formatBitsPerSecond = (bps: number) => {
    if (bps < 1000) return `${bps.toFixed(0)} bps`;
    if (bps < 1000000) return `${(bps / 1000).toFixed(2)} Kbps`;
    if (bps < 1000000000) return `${(bps / 1000000).toFixed(2)} Mbps`;
    return `${(bps / 1000000000).toFixed(2)} Gbps`;
};

const ExpandIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5v4m0 0h4" />
    </svg>
);
const CompressIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l-5 5m0 0v-4m0 4h4m1-11l5-5m0 0h-4m4 0v4m-1 11l5 5m0 0v-4m0 4h-4m1-11l-5 5" />
    </svg>
);


const InterfaceTraffic: React.FC = () => {
    const [interfaces, setInterfaces] = useState<MikrotikInterface[]>([]);
    const [selectedInterface, setSelectedInterface] = useState<string>('');
    const [trafficData, setTrafficData] = useState<{ labels: string[], tx: number[], rx: number[] }>({ labels: [], tx: [], rx: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [isPolling, setIsPolling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const intervalRef = useRef<number | null>(null);
    
    // State untuk fungsionalitas pencarian
    const [searchQuery, setSearchQuery] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);


    useEffect(() => {
        const fetchInterfaces = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetchWithAuth(`${API_URL}/interfaces`);
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'Failed to fetch interfaces.');
                }
                const data: MikrotikInterface[] = await res.json();
                setInterfaces(data.sort((a, b) => a.name.localeCompare(b.name)));
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchInterfaces();
    }, []);
    
     // Efek untuk menutup dropdown saat mengklik di luar
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const pollTraffic = async () => {
            if (!selectedInterface) return;
            try {
                const res = await fetchWithAuth(`${API_URL}/interfaces/traffic/${encodeURIComponent(selectedInterface)}`);
                if (!res.ok) {
                    const errorData = await res.json();
                    // Don't set a critical error for a single failed poll, just log it.
                    console.error(`Poll failed: ${errorData.message}`);
                    return; 
                }
                const data: { tx: number; rx: number } = await res.json();
                
                setTrafficData(prev => {
                    const now = new Date();
                    const newLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
                    
                    const newLabels = [...prev.labels, newLabel];
                    const newTx = [...prev.tx, data.tx];
                    const newRx = [...prev.rx, data.rx];

                    if (newLabels.length > MAX_DATA_POINTS) {
                        newLabels.shift();
                        newTx.shift();
                        newRx.shift();
                    }

                    return { labels: newLabels, tx: newTx, rx: newRx };
                });

            } catch (err) {
                 console.error("Error during traffic poll:", err);
            }
        };

        // Clear previous interval if any
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        if (selectedInterface) {
            setIsPolling(true);
            setError(null);
            setTrafficData({ labels: [], tx: [], rx: [] }); // Reset data on new selection
            pollTraffic(); // Poll immediately on selection
            intervalRef.current = window.setInterval(pollTraffic, POLLING_INTERVAL);
        } else {
            setIsPolling(false);
        }

        // Cleanup function
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [selectedInterface]);

    const filteredInterfaces = useMemo(() => {
        const lowercasedQuery = searchQuery.toLowerCase();
        if (!lowercasedQuery && !selectedInterface) return interfaces;
        if (!lowercasedQuery && selectedInterface) return interfaces; // Tampilkan semua jika input kosong tapi sudah ada yang terpilih
        return interfaces.filter(iface => iface.name.toLowerCase().includes(lowercasedQuery));
    }, [interfaces, searchQuery, selectedInterface]);

    const handleSelectInterface = (iface: MikrotikInterface) => {
        setSelectedInterface(iface.name);
        setSearchQuery(iface.name);
        setIsDropdownOpen(false);
    };

    const chartData = {
        labels: trafficData.labels,
        datasets: [
            {
                label: 'Upload (TX)',
                data: trafficData.tx,
                borderColor: 'rgb(239, 68, 68)',
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
            },
            {
                label: 'Download (RX)',
                data: trafficData.rx,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
            },
        ],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    callback: (value: any) => formatBitsPerSecond(value),
                },
                grid: {
                    color: 'rgba(200, 200, 200, 0.2)',
                },
            },
            x: {
                grid: {
                    display: false,
                },
            },
        },
        plugins: {
            legend: {
                position: 'top' as const,
            },
            tooltip: {
                callbacks: {
                    label: (context: any) => {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null) {
                            label += formatBitsPerSecond(context.parsed.y);
                        }
                        return label;
                    }
                }
            }
        },
        animation: {
            duration: 250,
        },
    };

    const rootClasses = isFullScreen
        ? "fixed inset-0 z-[100] bg-gray-50 dark:bg-gray-900 flex flex-col p-4 gap-4"
        : "space-y-6";

    const chartCardClasses = isFullScreen ? "flex-grow flex flex-col" : "";
    const chartWrapperClasses = isFullScreen ? "flex-grow relative" : "h-96 relative";


    return (
        <div className={rootClasses}>
            <h2 className={`text-2xl font-bold text-gray-800 dark:text-gray-100 ${isFullScreen ? 'hidden' : 'block'}`}>Interface Traffic Monitor</h2>
            {error && !isFullScreen && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
            
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4 w-full sm:w-auto">
                    <label htmlFor="interface-select" className="font-semibold text-gray-700 dark:text-gray-300 flex-shrink-0">Select Interface:</label>
                    <div ref={dropdownRef} className="relative w-full sm:w-80">
                         <input
                            id="interface-select"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setIsDropdownOpen(true); }}
                            onFocus={() => setIsDropdownOpen(true)}
                            placeholder={isLoading ? 'Loading...' : '-- Search for an interface --'}
                            className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                            disabled={isLoading}
                        />
                        {isDropdownOpen && (
                            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                <ul>
                                    {filteredInterfaces.length > 0 ? (
                                        filteredInterfaces.map(iface => (
                                            <li key={iface.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectInterface(iface)}
                                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                                                >
                                                    {iface.name}
                                                </button>
                                            </li>
                                        ))
                                    ) : (
                                        <li className="px-4 py-2 text-sm text-gray-500">No interfaces found.</li>
                                    )}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
                 <button
                    onClick={() => setIsFullScreen(!isFullScreen)}
                    className="bg-white dark:bg-gray-700 p-2 border border-gray-300 dark:border-gray-500 rounded-md shadow-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors w-full sm:w-auto flex-shrink-0"
                    title={isFullScreen ? "Exit Full View" : "Full View"}
                >
                    {isFullScreen ? <CompressIcon /> : <ExpandIcon />}
                </button>
            </div>

            <Card className={chartCardClasses}>
                <div className={chartWrapperClasses}>
                    {!selectedInterface ? (
                        <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
                            <p>Please select an interface to begin monitoring.</p>
                        </div>
                    ) : (
                        <>
                            {isPolling && (
                                <div className="absolute top-2 right-2 flex items-center space-x-2 text-green-600 dark:text-green-400 text-sm z-10">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                                    </span>
                                    <span>Live</span>
                                </div>
                            )}
                            <Line options={chartOptions as any} data={chartData} />
                        </>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default InterfaceTraffic;