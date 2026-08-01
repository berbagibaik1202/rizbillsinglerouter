import React from 'react';
import type { TechnicianPage } from '~/screens/TechnicianDashboard';

interface TechnicianPortalNavProps {
  activePage: TechnicianPage;
  setPage: (page: TechnicianPage) => void;
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
const TaskIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
);

const CustomerIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21a6 6 0 00-9-5.197M15 11a4 4 0 110-5.292M12 4.354a4 4 0 010 5.292" />
    </svg>
);


const TechnicianPortalNav: React.FC<TechnicianPortalNavProps> = ({ activePage, setPage }) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex justify-around bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] dark:shadow-[0_-2px_10px_rgba(0,0,0,0.3)]">
        <NavButton 
            label="Tugas" 
            icon={<TaskIcon />} 
            isActive={activePage === 'tasks'} 
            onClick={() => setPage('tasks')}
        />
        <NavButton 
            label="Pelanggan" 
            icon={<CustomerIcon />} 
            isActive={activePage === 'customers'} 
            onClick={() => setPage('customers')}
        />
    </nav>
  );
};

export default TechnicianPortalNav;