import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from '~/components/admin/Sidebar';
import Dashboard from '~/screens/admin/Dashboard';
import Customers from '~/screens/admin/Customers';
import Billing from '~/screens/admin/Billing';
import Packages from '~/screens/admin/Packages';
import Complaints from '~/screens/admin/Complaints';
import PppoeUsers from '~/screens/admin/PppoeUsers';
import PppoeProfiles from '~/screens/admin/PppoeProfiles';
import HotspotUsers from '~/screens/admin/HotspotUsers';
import HotspotProfiles from '~/screens/admin/HotspotProfiles';
import HotspotVouchers from '~/screens/admin/HotspotVouchers';
import HotspotActive from '~/screens/admin/HotspotActive';
import PppoeActive from './admin/PppoeActive';
import Map from '~/screens/admin/Map';
import Odp from '~/screens/admin/Odp';
import Odc from '~/screens/admin/Odc';
import Users from '~/screens/admin/Users';
import Settings from '~/screens/admin/Settings';
import Transactions from '~/screens/admin/Transactions';
import Whatsapp from '~/screens/admin/Whatsapp';
import AcsDevices from '~/screens/admin/AcsDevices';
import InterfaceTraffic from '~/screens/admin/InterfaceTraffic';
import QueueTraffic from '~/screens/admin/QueueTraffic';
import Reports from '~/screens/admin/Reports';
import Remote from '~/screens/admin/Remote';
import PPOBManagement from '~/screens/admin/PPOBManagement';
import PPOBTransactions from '~/screens/admin/PPOBTransactions';
import OltManagement from '~/screens/admin/OltManagement';
import { AdminUser, formatRupiah } from '~/types';

export type AdminPage = 'dashboard' | 'customers' | 'billing' | 'transactions' | 'reports' | 'packages' | 'complaints' | 'map' | 'odp' | 'odc' | 'interface_traffic' | 'queue_traffic' | 'pppoe_users' | 'pppoe_active' | 'pppoe_profiles' | 'hotspot_users' | 'hotspot_profiles' | 'hotspot_vouchers' | 'hotspot_active' | 'users' | 'settings' | 'whatsapp' | 'acs_devices' | 'apiKey' | 'remote' | 'ppob_management' | 'ppob_transactions' | 'olt_management';

const AdminDashboard: React.FC<{ user: AdminUser }> = ({ user }) => {
    const [page, setPage] = useState<AdminPage>('dashboard');
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [inAppNotification, setInAppNotification] = useState<{ customerName: string; amount: number; invoiceId: string } | null>(null);
    const idleTimerRef = useRef<number | null>(null);

    useEffect(() => {
        const handleToggle = () => setIsMobileSidebarOpen(prev => !prev);
        window.addEventListener('toggleAdminSidebar', handleToggle);
        return () => window.removeEventListener('toggleAdminSidebar', handleToggle);
    }, []);

    useEffect(() => {
        if (inAppNotification) {
            const timer = setTimeout(() => {
                setInAppNotification(null);
            }, 10000);
            return () => clearTimeout(timer);
        }
    }, [inAppNotification]);

    useEffect(() => {
        if (user.role !== 'admin' && user.role !== 'reseller') {
            return;
        }

        if (!("Notification" in window)) {
            console.log("This browser does not support desktop notifications.");
            return;
        }

        let eventSource: EventSource | null = null;

        const setupSseConnection = () => {
            const sessionJSON = localStorage.getItem('rizkitechbill_session');
            if (!sessionJSON) return;
            
            let token;
            try {
                token = JSON.parse(sessionJSON).token;
            } catch (e) { return; }

            if (!token) return;

            eventSource = new EventSource(`/api/admin/events?token=${token}`);

            eventSource.onopen = () => console.log("[SSE] Connection to server opened.");

            eventSource.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'payment_success') {
                        if (Notification.permission === "granted") {
                            if (document.hidden) {
                                const notification = new Notification("Pembayaran Diterima!", {
                                    body: `${data.customerName} baru saja membayar ${formatRupiah(data.amount)}.`,
                                    icon: '/icon-192.svg',
                                    tag: `payment-${data.invoiceId || Date.now()}`
                                });
                                notification.onclick = () => {
                                    window.focus();
                                    window.location.hash = 'admin/transactions';
                                };
                                setTimeout(() => notification.close(), 10000);
                            } else {
                                setInAppNotification({
                                    customerName: data.customerName,
                                    amount: data.amount,
                                    invoiceId: data.invoiceId
                                });
                            }
                        }
                        window.dispatchEvent(new CustomEvent('tripay-payment-received', { detail: data }));
                    }
                } catch (e) { /* Ignore non-json */ }
            });

            eventSource.onerror = (err) => {
                console.error("[SSE] EventSource failed:", err);
                eventSource?.close();
            };
        };

        const initializeNotifications = async () => {
            if (Notification.permission === "granted") {
                setupSseConnection();
            } else if (Notification.permission !== "denied") {
                const permission = await Notification.requestPermission();
                if (permission === "granted") {
                    setupSseConnection();
                }
            }
        };

        initializeNotifications();

        return () => eventSource?.close();
    }, [user.role]);

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth < 768) setIsSidebarCollapsed(false);
        };
        window.addEventListener('resize', handleResize);
        handleResize();
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (window.innerWidth >= 768) {
            setIsSidebarCollapsed(true);
        }
    }, []);

    const resetIdleTimer = useCallback(() => {
        if (idleTimerRef.current) {
            window.clearTimeout(idleTimerRef.current);
        }
        idleTimerRef.current = window.setTimeout(() => {
            if (window.innerWidth < 768) return;
            if (!isSidebarCollapsed && !isMobileSidebarOpen) {
                setIsSidebarCollapsed(true);
            }
        }, 12000);
    }, [isSidebarCollapsed, isMobileSidebarOpen]);

    useEffect(() => {
        const passiveOptions: AddEventListenerOptions = { passive: true };
        const events = ['mousemove', 'keydown', 'wheel', 'mousedown', 'touchstart', 'scroll'];

        resetIdleTimer();
        events.forEach(event => window.addEventListener(event, resetIdleTimer, passiveOptions));

        return () => {
            if (idleTimerRef.current) {
                window.clearTimeout(idleTimerRef.current);
            }
            events.forEach(event => window.removeEventListener(event, resetIdleTimer, passiveOptions));
        };
    }, [resetIdleTimer]);

    useEffect(() => {
        const handleHashChange = () => {
            const pageNameOnly = window.location.hash.split('?')[0];
            const potentialPage = pageNameOnly.split('/')[1] as AdminPage;
            const validPages: AdminPage[] = ['dashboard', 'customers', 'billing', 'transactions', 'reports', 'packages', 'complaints', 'map', 'odp', 'odc', 'interface_traffic', 'queue_traffic', 'pppoe_users', 'pppoe_active', 'pppoe_profiles', 'hotspot_users', 'hotspot_profiles', 'hotspot_vouchers', 'hotspot_active', 'users', 'settings', 'whatsapp', 'acs_devices', 'apiKey', 'remote', 'ppob_management', 'ppob_transactions', 'olt_management'];
            setPage(validPages.includes(potentialPage) ? potentialPage : 'dashboard');
        };
        window.addEventListener('hashchange', handleHashChange);
        handleHashChange();
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    const handleSetPage = (newPage: AdminPage) => {
        window.location.hash = `admin/${newPage}`;
        setIsMobileSidebarOpen(false);
    };

    const renderContent = () => {
        switch (page) {
            case 'dashboard': return <Dashboard setPage={handleSetPage} />;
            case 'customers': return <Customers />;
            case 'billing': return <Billing />;
            case 'transactions': return <Transactions />;
            case 'reports': return <Reports />;
            case 'packages': return <Packages />;
            case 'complaints': return <Complaints user={user} />;
            case 'map': return <Map />;
            case 'odp': return <Odp />;
            case 'odc': return <Odc />;
            case 'interface_traffic': return <InterfaceTraffic />;
            case 'queue_traffic': return <QueueTraffic />;
            case 'pppoe_users': return <PppoeUsers />;
            case 'pppoe_active': return <PppoeActive />;
            case 'pppoe_profiles': return <PppoeProfiles />;
            case 'hotspot_users': return <HotspotUsers />;
            case 'hotspot_vouchers': return <HotspotVouchers />;
            case 'hotspot_active': return <HotspotActive />;
            case 'hotspot_profiles': return <HotspotProfiles />;
            case 'users': return <Users />;
            case 'settings': return <Settings />;
            case 'whatsapp': return <Whatsapp />;
            case 'acs_devices': return <AcsDevices />;
            case 'remote': return <Remote />;
            case 'ppob_management': return <PPOBManagement />;
            case 'ppob_transactions': return <PPOBTransactions />;
            case 'olt_management': return <OltManagement />;
            default: return <Dashboard setPage={handleSetPage} />;
        }
    };

    return (
        <div className="flex h-screen w-full bg-gray-50 dark:bg-gray-900">
            {isMobileSidebarOpen && (
                <div 
                    className="fixed inset-0 bg-black/50 z-30 md:hidden"
                    onClick={() => setIsMobileSidebarOpen(false)}
                    aria-hidden="true"
                ></div>
            )}
            <div
                onMouseEnter={() => {
                    if (window.innerWidth >= 768 && isSidebarCollapsed) {
                        setIsSidebarCollapsed(false);
                    }
                }}
                onMouseLeave={() => {
                    if (window.innerWidth >= 768 && !isSidebarCollapsed) {
                        setIsSidebarCollapsed(true);
                    }
                }}
            >
                <Sidebar 
                    activePage={page} 
                    setPage={handleSetPage}
                    isCollapsed={isSidebarCollapsed}
                    setIsCollapsed={setIsSidebarCollapsed}
                    isMobileOpen={isMobileSidebarOpen}
                    onCloseMobile={() => setIsMobileSidebarOpen(false)}
                />
            </div>
            <div className="flex-1 flex flex-col h-screen overflow-hidden">
                <main 
                    className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto"
                    onClick={() => {
                        if (isMobileSidebarOpen) setIsMobileSidebarOpen(false);
                        if (window.innerWidth >= 768 && !isSidebarCollapsed) {
                            setIsSidebarCollapsed(true);
                        }
                    }}
                >
                    {renderContent()}
                </main>
            </div>
            
            {inAppNotification && (
                <div 
                    role="alert"
                    aria-live="assertive"
                    className="fixed top-20 right-4 sm:right-6 md:right-8 z-50 w-full max-w-sm p-4 bg-white dark:bg-gray-700 rounded-lg shadow-lg border-l-4 border-green-500 transform transition-all duration-300 ease-in-out animate-fade-in-right"
                >
                    <div className="flex items-start">
                        <div className="flex-shrink-0">
                            <svg className="h-6 w-6 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div className="ml-3 w-0 flex-1 cursor-pointer" onClick={() => { handleSetPage('transactions'); setInAppNotification(null); }}>
                            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Pembayaran Diterima!</p>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                                {inAppNotification.customerName} baru saja membayar {formatRupiah(inAppNotification.amount)}.
                            </p>
                        </div>
                        <div className="ml-4 flex-shrink-0 flex">
                            <button onClick={() => setInAppNotification(null)} className="inline-flex rounded-md p-1 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:text-gray-500 dark:hover:text-gray-300">
                                <span className="sr-only">Close</span>
                                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;
