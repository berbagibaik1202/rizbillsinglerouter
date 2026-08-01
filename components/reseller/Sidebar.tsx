import React from 'react';
import type { ResellerPage } from '~/screens/ResellerDashboard';

interface ResellerPortalNavProps {
  activePage: ResellerPage;
  setPage: (page: ResellerPage) => void;
}

const NavButton: React.FC<{
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
}> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex-1 flex flex-col items-center justify-center pt-2 pb-1 text-xs transition-colors ${
            isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400'
        }`}
    >
        {icon}
        <span className="mt-1 font-medium">{label}</span>
    </button>
);

// --- SVG Icons ---
const VoucherIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M15 5l0 2" />
        <path d="M15 11l0 2" />
        <path d="M15 17l0 2" />
        <path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-3a2 2 0 0 0 0 -4v-3a2 2 0 0 1 2 -2" />
    </svg>
);
const TransactionIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="2" />
        <path d="M9 12l.01 0" />
        <path d="M13 12l2 0" />
        <path d="M9 16l.01 0" />
        <path d="M13 16l2 0" />
    </svg>
);


const ResellerPortalNav: React.FC<ResellerPortalNavProps> = ({ activePage, setPage }) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex justify-around bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] dark:shadow-[0_-2px_10px_rgba(0,0,0,0.3)]">
        <NavButton label="Sales" icon={<VoucherIcon isActive={activePage === 'voucher_sales'} />} isActive={activePage === 'voucher_sales'} onClick={() => setPage('voucher_sales')} />
        <NavButton label="History" icon={<TransactionIcon isActive={activePage === 'my_transactions'} />} isActive={activePage === 'my_transactions'} onClick={() => setPage('my_transactions')} />
    </nav>
  );
};

export default ResellerPortalNav;