import React, { useState, useEffect } from 'react';
import AdminDashboard from './screens/AdminDashboard';
import CustomerPortal from './screens/CustomerPortal';
import CustomerLogin from './screens/CustomerLogin';
import AdminLogin from './screens/AdminLogin';
import { Customer, AdminUser, ApiSettings } from './types';
import ResellerDashboard from './screens/ResellerDashboard';
import TechnicianDashboard, { TechnicianPage } from './screens/TechnicianDashboard';
import Chatbot from './components/common/Chatbot';
import PublicPaymentPage from './screens/PublicPaymentPage'; // Import halaman baru
import appLogo from './logo.png';
import NotificationBell from './components/admin/NotificationBell';

type Route = 'admin' | 'login' | 'portal' | 'loading' | 'pay'; // Tambahkan rute 'pay'
type Theme = 'light' | 'dark';
type AdminPage = 'dashboard' | 'customers' | 'billing' | 'transactions' | 'reports' | 'packages' | 'complaints' | 'map' | 'odp' | 'odc' | 'interface_traffic' | 'queue_traffic' | 'pppoe_users' | 'pppoe_active' | 'pppoe_profiles' | 'hotspot_users' | 'hotspot_profiles' | 'hotspot_vouchers' | 'hotspot_active' | 'users' | 'settings' | 'whatsapp' | 'acs_devices' | 'apiKey' | 'remote' | 'ppob_management';

const SESSION_KEY = 'rizkitechbill_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 hari dalam milidetik
const PWA_INSTALLED_STORAGE_KEY = 'rizkitechbill_pwa_installed';

type DeferredPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

// Helper function to decode JWT payload
function decodeJwt(token: string) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding to handle base64 strings that are not a multiple of 4, preventing 'atob' errors.
    const paddedBase64 = base64 + '=='.substring(0, (4 - base64.length % 4) % 4);
    const jsonPayload = decodeURIComponent(atob(paddedBase64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("Failed to decode JWT:", e);
    return null;
  }
}


const App: React.FC = () => {
  const [route, setRoute] = useState<Route>('loading');
  const [loggedInCustomer, setLoggedInCustomer] = useState<Customer | null>(null);
  const [loggedInAdmin, setLoggedInAdmin] = useState<AdminUser | null>(null);
  const [appSettings, setAppSettings] = useState<ApiSettings | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'light');
  const [page, setPage] = useState<AdminPage | TechnicianPage>('dashboard');
  const [invoiceIdForPayment, setInvoiceIdForPayment] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<DeferredPromptEvent | null>(null);
  const [showInstallButton, setShowInstallButton] = useState(false);
  const [showManualInstallHint, setShowManualInstallHint] = useState(false);
  const [isVideoPlayerActive, setIsVideoPlayerActive] = useState(false);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };
  
  // Menangani sinkronisasi login/logout antar tab
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
        if (event.key === SESSION_KEY) {
            // Jika sesi berubah (login/logout/update) di tab lain, muat ulang halaman ini
            // untuk menyinkronkan status. Ini adalah cara paling sederhana dan kuat.
            window.location.reload();
        }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
        window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  useEffect(() => {
    // Menangani pembaruan data dalam tab yang sama (misalnya setelah pembaruan profil)
    const handleSessionUpdate = () => {
        console.log('Session updated event received. Reloading customer data.');
        const sessionJSON = localStorage.getItem(SESSION_KEY);
        if (sessionJSON) {
            try {
                const { token } = JSON.parse(sessionJSON);
                if (token) {
                    const decoded = decodeJwt(token);
                    // Pastikan kita hanya memperbarui data pelanggan, bukan admin
                    if (decoded && !['admin', 'reseller', 'technician'].includes(decoded.role)) {
                        setLoggedInCustomer(decoded);
                    }
                }
            } catch (e) {
                console.error("Failed to parse session on update:", e);
            }
        }
    };

    window.addEventListener('sessionUpdated', handleSessionUpdate);

    return () => {
        window.removeEventListener('sessionUpdated', handleSessionUpdate);
    };
  }, []);

  useEffect(() => {
    const syncInstallVisibility = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (isStandalone) {
        localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, 'true');
      }

      if (isStandalone || localStorage.getItem(PWA_INSTALLED_STORAGE_KEY) === 'true') {
        setInstallPrompt(null);
        setShowInstallButton(false);
        setShowManualInstallHint(false);
        return true;
      }

      return false;
    };

    const ua = window.navigator.userAgent.toLowerCase();
    const isIosSafari = /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/chrome|crios|edg|opr/.test(ua);

    if (!syncInstallVisibility() && isIosSafari) {
      setShowManualInstallHint(true);
      setShowInstallButton(true);
    }

    const handleBeforeInstall = (e: Event) => {
        e.preventDefault();
        const bpEvent = e as DeferredPromptEvent;
        setInstallPrompt(bpEvent);
        setShowInstallButton(true);
        setShowManualInstallHint(false);
    };
    const handleAppInstalled = () => {
      localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, 'true');
      setInstallPrompt(null);
      setShowInstallButton(false);
      setShowManualInstallHint(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncInstallVisibility();
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) {
      return;
    }

    setShowInstallButton(false);
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, 'true');
      setShowManualInstallHint(false);
    } else {
      setTimeout(() => setShowInstallButton(true), 10000);
    }
    setInstallPrompt(null);
  };

  const handleCloseInstallPopup = () => {
    setShowInstallButton(false);
  };

  useEffect(() => {
    const fetchAppSettings = async () => {
        try {
            const res = await fetch('/api/public/settings');
            if (res.ok) {
                setAppSettings(await res.json());
            } else {
                console.error(`Failed to fetch public app settings. Status: ${res.status}. Using fallback name.`);
                setAppSettings({ app: { appName: 'RIZKITECHBILL', appLogoUrl: '' } } as ApiSettings);
            }
        } catch (e) { 
            console.error("Failed to fetch app settings.", e); 
            setAppSettings({ app: { appName: 'RIZKITECHBILL', appLogoUrl: '' } } as ApiSettings);
        }
    };
    fetchAppSettings();

    // Pulihkan sesi dari localStorage
    const sessionJSON = localStorage.getItem(SESSION_KEY);
    if (sessionJSON) {
        try {
            const { token, timestamp } = JSON.parse(sessionJSON);
            
            // Periksa kedaluwarsa sesi 7 hari
            if (Date.now() - timestamp > SESSION_DURATION) {
                localStorage.removeItem(SESSION_KEY);
                return;
            }

            const decoded = decodeJwt(token);
            // Periksa kedaluwarsa token JWT internal
            if (decoded && decoded.exp * 1000 > Date.now()) {
                if (decoded.role === 'admin' || decoded.role === 'reseller' || decoded.role === 'technician') {
                    setLoggedInAdmin(decoded);
                } else {
                    setLoggedInCustomer(decoded);
                }
            } else {
                localStorage.removeItem(SESSION_KEY);
            }
        } catch (e) {
            console.error("Failed to parse session from localStorage:", e);
            localStorage.removeItem(SESSION_KEY);
        }
    }
  }, []);

  // Logika routing utama
  useEffect(() => {
    const handleHashChange = () => {
        const hash = window.location.hash.substring(1);
        const hashParts = hash.split('/');
        const baseRoute = hashParts[0] as 'admin' | 'technician' | 'portal' | 'login' | 'pay';
        const pageName = hashParts[1] as AdminPage | TechnicianPage;

        switch (baseRoute) {
            case 'admin': case 'technician':
                setRoute('admin');
                break;
            case 'portal':
                setRoute('portal');
                break;
            case 'login':
                setRoute('login');
                break;
            case 'pay':
                setInvoiceIdForPayment(hashParts[1] || null);
                setRoute('pay');
                break;
            default:
                if (loggedInAdmin) {
                    window.location.hash = loggedInAdmin.role === 'technician' ? 'technician/tasks' : 'admin';
                } else if (loggedInCustomer) {
                    window.location.hash = 'portal';
                } else {
                    window.location.hash = 'login';
                }
                break;
        }

        // Set page state for dashboards
        const validAdminPages: AdminPage[] = ['dashboard', 'customers', 'billing', 'transactions', 'reports', 'packages', 'complaints', 'map', 'odp', 'odc', 'interface_traffic', 'queue_traffic', 'pppoe_users', 'pppoe_active', 'pppoe_profiles', 'hotspot_users', 'hotspot_profiles', 'hotspot_vouchers', 'hotspot_active', 'users', 'settings', 'whatsapp', 'acs_devices', 'apiKey', 'remote'];
        const validTechnicianPages: TechnicianPage[] = ['tasks', 'customers', 'odp', 'odc'];

        if ((baseRoute === 'admin' && validAdminPages.includes(pageName as AdminPage)) || (baseRoute === 'technician' && validTechnicianPages.includes(pageName as TechnicianPage))) {
            setPage(pageName);
        }
    };
    
    if (route !== 'loading' && route !== 'pay') {
        if (loggedInAdmin) {
            const currentBaseRoute = window.location.hash.substring(1).split('/')[0];
            // Hanya redirect jika rute saat ini BUKAN 'admin' ATAU 'technician'
            if (currentBaseRoute !== 'admin' && currentBaseRoute !== 'technician') {
                window.location.hash = loggedInAdmin.role === 'technician' ? 'technician/tasks' : 'admin';
            }
        } else if (loggedInCustomer) {
            if (route !== 'portal') window.location.hash = 'portal';
        } else {
            if (route === 'portal') window.location.hash = 'login';
        }
    }

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Atur rute awal

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [loggedInAdmin, loggedInCustomer, route]);


  const handleCustomerLoginSuccess = (token: string) => {
    const sessionData = { token, timestamp: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    const decoded = decodeJwt(token);
    if(decoded) {
      setLoggedInCustomer(decoded);
    }
    window.location.hash = 'portal';
  };

  const handleAdminLoginSuccess = (token: string) => {
    const sessionData = { token, timestamp: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    const decoded = decodeJwt(token);
    if(decoded) {
      setLoggedInAdmin(decoded);
    }
    if (decoded?.role === 'technician') {
        window.location.hash = 'technician/tasks';
    } else {
        window.location.hash = 'admin';
    }
  };

  const handleLogout = () => {
    const wasAdmin = !!loggedInAdmin;
    setLoggedInCustomer(null);
    setLoggedInAdmin(null);
    localStorage.removeItem(SESSION_KEY);
    if (wasAdmin) {
        window.location.hash = 'admin'; // Admin login page
    } else {
        window.location.hash = 'login'; // Customer login page
    }
  };

  const renderContent = () => {
    switch (route) {
        case 'admin':
            if (!loggedInAdmin) {
                return <div className="flex items-center justify-center w-full h-full p-4 md:p-6 lg:p-8"><AdminLogin onLoginSuccess={handleAdminLoginSuccess} appSettings={appSettings} /></div>;
            }
            switch (loggedInAdmin.role) {
                case 'admin':
                    return <AdminDashboard user={loggedInAdmin} />;
                case 'reseller':
                    return <ResellerDashboard user={loggedInAdmin} />;
                case 'technician':
                    return <TechnicianDashboard user={loggedInAdmin} page={page as TechnicianPage} />;
                default:
                    handleLogout();
                    return <div className="text-center p-10">Peran pengguna tidak valid. Keluar...</div>;
            }
        
        case 'portal':
            if (loggedInCustomer) {
                 return <CustomerPortal customer={loggedInCustomer} onVideoPlayerModeChange={setIsVideoPlayerActive} />;
            }
            return <div className="text-center p-10">Loading...</div>;

        case 'login':
             if (loggedInCustomer) {
                return <div className="text-center p-10">Redirecting...</div>;
             }
             return <div className="flex items-center justify-center w-full h-full p-4 md:p-6 lg:p-8"><CustomerLogin onLoginSuccess={handleCustomerLoginSuccess} appSettings={appSettings} /></div>;

        case 'pay':
            if (invoiceIdForPayment) {
                return <div className="flex items-center justify-center w-full h-full p-4 md:p-6 lg:p-8"><PublicPaymentPage invoiceId={invoiceIdForPayment} /></div>;
            }
            return <div className="text-center p-10">Invalid payment link.</div>;

        case 'loading':
        default:
            return <div className="text-center p-10">Loading application...</div>;
    }
  };

  const mainClasses = (loggedInAdmin || (loggedInCustomer && route === 'portal'))
    ? 'flex-1 flex overflow-hidden'
    : 'container mx-auto flex-1';

  const currentUser = loggedInAdmin || loggedInCustomer;

  return (
    <div className="h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 flex flex-col">
      <header className="bg-white dark:bg-gray-800 shadow-md dark:shadow-none border-b border-transparent dark:border-gray-700 z-20 relative">
        <nav className="container mx-auto px-2 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-0">
            {loggedInAdmin && (
              <button
                className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 md:hidden"
                aria-label="Open sidebar"
                onClick={() => window.dispatchEvent(new CustomEvent('toggleAdminSidebar'))}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            {appSettings?.app?.appLogoUrl || appLogo ? (
              <img src={appSettings?.app?.appLogoUrl || appLogo} alt="App Logo" className="h-8 w-8 object-contain" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            )}
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{appSettings?.app?.appName || 'ISP Billing Pro'}</h1>
          </div>
          <div className="flex items-center space-x-4">
             <button
              onClick={toggleTheme}
              className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm-.707 7.072l.707-.707a1 1 0 10-1.414-1.414l-.707.707a1 1 0 101.414 1.414zM3 11a1 1 0 100-2H2a1 1 0 100 2h1z" clipRule="evenodd" /></svg>
              )}
            </button>
            {loggedInAdmin ? (
                <div className="flex items-center space-x-2">
                    <NotificationBell />
                    <span className="text-sm text-gray-600 dark:text-gray-300 hidden sm:inline">
                        Selamat Datang, <span className="font-semibold">{loggedInAdmin.username}</span> ({loggedInAdmin.role})
                    </span>
                    <button
                        onClick={handleLogout}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors shadow-sm"
                    >
                        Logout
                    </button>
                </div>
            ) : loggedInCustomer ? (
                <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-600 dark:text-gray-300 hidden sm:inline">
                        Selamat Datang, <span className="font-semibold">{loggedInCustomer.name.split(' ')[0]}</span>
                    </span>
                    <button
                        onClick={handleLogout}
                        className="px-2 py-2 rounded-md text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors shadow-sm"
                    >
                        Logout
                    </button>
                </div>
            ) : (
              (route !== 'pay') && // Jangan tampilkan tombol login jika di halaman pembayaran
              <>
                <a
                  href="#admin"
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    route === 'admin'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  Admin | Reseller
                </a>
                <a
                  href="#login"
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    route === 'login'
                      ? 'bg-green-600 text-white shadow'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  Customer
                </a>
              </>
            )}
          </div>
        </nav>
      </header>
      <main className={mainClasses}>
        {renderContent()}
      </main>
      {currentUser && (
        <Chatbot
            user={currentUser}
            role={loggedInAdmin ? 'admin' : 'customer'}
            hideFloatingButton={Boolean(loggedInCustomer && isVideoPlayerActive)}
        />
      )}
      {showInstallButton && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {installPrompt ? 'Install Aplikasi' : 'Cara Install Aplikasi'}
                </h2>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  {installPrompt
                    ? 'Install aplikasi ini agar lebih cepat diakses langsung dari layar utama atau desktop.'
                    : 'Untuk iPhone atau Safari, buka menu Share lalu pilih "Add to Home Screen".'}
                </p>
              </div>
              <button
                onClick={handleCloseInstallPopup}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                aria-label="Tutup popup install"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {showManualInstallHint && (
              <div className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-900 dark:bg-blue-900/30 dark:text-blue-100">
                <p>Buka menu browser, lalu pilih:</p>
                <p className="mt-2 font-medium">Share → Add to Home Screen</p>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={handleCloseInstallPopup}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Nanti
              </button>
              {installPrompt && (
                <button
                  onClick={handleInstallClick}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Install
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
