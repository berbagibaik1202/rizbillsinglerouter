import React, { useState } from 'react';
import type { AdminPage } from '../../screens/AdminDashboard';

interface SidebarProps {
  activePage: AdminPage;
  setPage: (page: AdminPage) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activePage, setPage, isCollapsed, setIsCollapsed, isMobileOpen, onCloseMobile }) => {
  const floatStyle: React.CSSProperties = {
    animation: 'sidebarFloat 10s ease-in-out infinite',
    willChange: 'transform',
  };
  const sections = [
    {
      id: 'main',
      title: 'Main',
      icon: <HomeIcon />,
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: <HomeIcon /> },
        { id: 'complaints', label: 'Complaints', icon: <ComplaintIcon /> },
      ],
    },
    {
      id: 'Billing',
      title: 'Billing',
      icon: <InvoiceIcon />,
      items: [
        { id: 'customers', label: 'Customers', icon: <UsersIcon /> },
        { id: 'billing', label: 'Invoices', icon: <InvoiceIcon /> },
        { id: 'transactions', label: 'Transactions', icon: <TransactionIcon /> },
        { id: 'reports', label: 'Reports', icon: <ReportIcon /> },
        { id: 'packages', label: 'Packages', icon: <PackageIcon /> },
      ],
    },
    {
      id: 'ppob',
      title: 'PPOB',
      icon: <TransactionIcon />,
      items: [
        { id: 'ppob_management', label: 'Manajemen Produk', icon: <PackageIcon /> },
        { id: 'ppob_transactions', label: 'Transaksi PPOB', icon: <TransactionIcon /> },
      ],
    },
    {
      id: 'network',
      title: 'Network',
      icon: <MapIcon />,
      items: [
        { id: 'map', label: 'Map', icon: <MapIcon /> },
        { id: 'odc', label: 'ODC', icon: <OdcIcon /> },
        { id: 'odp', label: 'ODP', icon: <OdpIcon /> },
        { id: 'olt_management', label: 'OLT', icon: <NetworkIcon /> },
        { id: 'interface_traffic', label: 'Traffic Monitor', icon: <GraphIcon /> },
        { id: 'queue_traffic', label: 'Queue Monitor', icon: <SpeedIcon /> },
        { id: 'acs_devices', label: 'ACS Devices', icon: <AcsIcon /> },
        { id: 'remote', label: 'Remote ONT', icon: <RemoteIcon /> },
      ],
    },
    {
      id: 'pppoe',
      title: 'PPPoE',
      icon: <NetworkIcon />,
      items: [
      { id: 'pppoe_active', label: 'Active', icon: <ActivityIcon /> },
        { id: 'pppoe_users', label: 'Users', icon: <NetworkIcon /> },
        { id: 'pppoe_profiles', label: 'Profiles', icon: <SettingsIcon /> },
      ],
    },
    {
      id: 'hotspot',
      title: 'Hotspot',
      icon: <WifiIcon />,
      items: [
        { id: 'hotspot_vouchers', label: 'Vouchers', icon: <VoucherIcon /> },
        { id: 'hotspot_active', label: 'Active Users', icon: <ActivityIcon /> },
        { id: 'hotspot_users', label: 'Users', icon: <WifiIcon /> },
        { id: 'hotspot_profiles', label: 'Profiles', icon: <SettingsIcon /> },
      ],
    },
    {
      id: 'administration',
      title: 'Administration',
      icon: <UsersAdminIcon />,
      items: [
        { id: 'users', label: 'Users', icon: <UsersAdminIcon /> },
        { id: 'whatsapp', label: 'WhatsApp', icon: <WhatsappIcon /> },
        { id: 'settings', label: 'Settings', icon: <AdminSettingsIcon /> },
      ],
    },
  ];

  type SectionId = typeof sections[number]['id'];
  const [openSection, setOpenSection] = useState<SectionId | null>('main');

  const toggleSection = (sectionId: SectionId) => {
    setOpenSection(prevOpenSection => (prevOpenSection === sectionId ? null : sectionId));
  };
  
  const NavLink: React.FC<{id: AdminPage, label: string, icon: React.ReactNode}> = ({ id, label, icon }) => (
    <li className="relative">
      {!isCollapsed && (
        <span className="absolute left-6 top-5 -translate-y-px h-px w-4 border-t border-gray-200 dark:border-gray-600 md:block hidden" aria-hidden="true"></span>
      )}
      <button
        onClick={() => setPage(id)}
        className={`w-full flex items-center py-2.5 text-sm font-medium rounded-md transition-all duration-300 transform ${
          activePage === id
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-200/60 dark:shadow-blue-900/50'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white hover:shadow-md'
        } ${isCollapsed ? 'md:px-3 md:justify-center px-4 justify-start' : 'pl-12 pr-4'} hover:-translate-y-0.5 hover:translate-x-0.5`}
        title={isCollapsed ? label : ''}
      >
        <div className={isCollapsed ? 'md:mr-0 mr-3' : 'mr-3'}>{icon}</div>
        <span className={`flex-1 text-left ${isCollapsed ? 'md:hidden' : ''}`}>{label}</span>
      </button>
    </li>
  );

  const NavGroup: React.FC<{ section: SectionId; title: string; icon: React.ReactNode; items: typeof sections[0]['items'] }> = ({ section, title, icon, items }) => {
    const isOpen = openSection === section;
    const isEffectivelyCollapsed = isCollapsed && !isMobileOpen; // On mobile, never collapse

    return (
        <div className="relative">
            {!isEffectivelyCollapsed && (
                <button
                    onClick={() => toggleSection(section)}
                    className="w-full flex items-center justify-between text-left px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none transition-all duration-300 transform hover:-translate-y-0.5 hover:translate-x-0.5"
                    aria-expanded={isOpen}
                    aria-controls={`section-${section}`}
                >
                    <div className="flex items-center">
                        <div className="mr-3 text-gray-500 dark:text-gray-400">{icon}</div>
                        <span>{title}</span>
                    </div>
                    <ChevronDownIcon className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
            )}
             <div
                id={`section-${section}`}
                className={`relative overflow-hidden transition-all duration-400 ease-in-out ${isEffectivelyCollapsed ? 'max-h-screen opacity-100' : (isOpen ? 'max-h-screen opacity-100' : 'max-h-0 opacity-0')}`}
            >
                {!isEffectivelyCollapsed && isOpen && (
                    <div className="absolute top-0 bottom-0 left-6 w-px bg-gray-200 dark:bg-gray-600" aria-hidden="true"></div>
                )}
                <ul className={`space-y-1 ${isEffectivelyCollapsed ? '' : 'pt-2'}`}>
                    {items.map(item => <NavLink key={item.id} id={item.id as AdminPage} label={item.label} icon={item.icon} />)}
                </ul>
            </div>
        </div>
    );
  };


  return (
    <>
      <aside
        className={`bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full transform fixed inset-y-0 left-0 z-40 w-64 ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 ${isCollapsed ? 'md:w-20' : 'md:w-64'} transition-all duration-500 ease-in-out`}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 md:hidden">
          <h3 className="font-semibold text-lg dark:text-white">Menu</h3>
          <button onClick={onCloseMobile} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600">
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-2" style={floatStyle}>
          {sections.map(section => (
            <NavGroup 
              key={section.id}
              section={section.id}
              title={section.title}
              icon={section.icon}
              items={section.items}
            />
          ))}
        </div>

        <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 hidden md:flex">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="w-full flex items-center justify-center p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors"
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </button>
        </div>
      </aside>
      <style>{`
        @keyframes sidebarFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </>
  );
};

// SVG Icons
const HomeIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
const UsersIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21a6 6 0 00-9-5.197M15 11a4 4 0 110-5.292M12 4.354a4 4 0 010 5.292" /></svg>;
const InvoiceIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
const PackageIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a1 1 0 011-1h5a.997.997 0 01.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>;
const ComplaintIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>;
const NetworkIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" /></svg>;
const SettingsIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066 2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
const WifiIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.555a5.5 5.5 0 017.778 0M12 20.25a.75.75 0 100-1.5.75.75 0 000 1.5zM4.444 12.889a10 10 0 0115.112 0" /></svg>;
const MapIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 16.382V5.618a1 1 0 00-.553-.894L15 2m-6 5l6-3m0 0l6 3m-6-3v10" /></svg>;
const OdpIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" /><path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" /><path d="M10 2C6.134 2 3 3.343 3 5s3.134 3 7 3 7-1.343 7-3-3.134-3-7-3z" /></svg>;
const OdcIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2z" /></svg>;
const GraphIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12 1.5a.5.5 0 01.5.5v16a.5.5 0 01-1 0v-16a.5.5 0 01.5-.5zM8 6.5a.5.5 0 01.5.5v11a.5.5 0 01-1 0v-11a.5.5 0 01.5-.5zM4 9.5a.5.5 0 01.5.5v8a.5.5 0 01-1 0v-8a.5.5 0 01.5-.5zM16 3.5a.5.5 0 01.5.5v14a.5.5 0 01-1 0v-14a.5.5 0 01.5-.5z" clipRule="evenodd" /></svg>;
const AcsIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm2-1a1 1 0 011-1h10a1 1 0 011 1v2H4V4zm14 4H2v6a1 1 0 001 1h12a1 1 0 001-1V8zM8 12a1 1 0 100-2 1 1 0 000 2z" /></svg>;
const UsersAdminIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" /></svg>;
const AdminSettingsIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.96.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379-1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>;
const VoucherIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 4a3 3 0 00-3 3v6a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H5zm-1 9v-1h5v2H5a1 1 0 01-1-1zm7 1h4a1 1 0 001-1v-1h-5v2zm0-4h5V8h-5v2zM4 8v2h5V8H4zm0-1h5V6H4v1zm7 1h5V6h-5v1z" clipRule="evenodd" /></svg>;
const ChevronLeftIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>;
const ChevronRightIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>;
const ChevronDownIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${className}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>;
const ActivityIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const TransactionIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" /><path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" /></svg>;
const ReportIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 11a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm5-6a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm5 10a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1zM2 17a1 1 0 011-1h2a1 1 0 110 2H3a1 1 0 01-1-1zm5-6a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm5-6a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1zM8 2a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" /></svg>;
const WhatsappIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 4.315 1.731 6.086l.107.192-.533 1.955 1.976-.518.188.112z" /></svg>;
const SpeedIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.415L11 9.586V6z" clipRule="evenodd" /></svg>;
const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const RemoteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;


export default Sidebar;
