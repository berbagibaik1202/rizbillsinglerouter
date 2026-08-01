
import React from 'react';

type CustomerTab = 'home' | 'bills' | 'help' | 'profile' | 'affiliate' | 'ppob' | 'video';

interface CustomerPortalNavProps {
    activeTab: CustomerTab;
    setActiveTab: (tab: CustomerTab) => void;
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
const HomeIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <polyline points="5 12 3 12 12 3 21 12 19 12" />
        <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" />
        <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />
    </svg>
);

const BillIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
        <line x1="9" y1="9" x2="10" y2="9" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
);

const PPOBIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M4 4h6v6h-6z" />
        <path d="M14 4h6v6h-6z" />
        <path d="M4 14h6v6h-6z" />
        <path d="M14 14h6v6h-6z" />
    </svg>
);

const VideoIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <rect x="3" y="5" width="15" height="14" rx="2" />
        <path d="M18 9l3 -2v10l-3 -2" />
        <path d="M8 9l5 3l-5 3z" />
    </svg>
);


const HelpIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M8 12h.01" /><path d="M12 12h.01" /><path d="M16 12h.01" />
        <path d="M21 12c0 4.418 -4.03 8 -9 8a9.863 9.863 0 0 1 -4.255 -.949l-1.745 .582a1 1 0 0 0 -1.215 1.215l.582 -1.745a9.863 9.863 0 0 1 -.949 -4.255c0 -4.418 4.03 -8 9 -8s9 3.582 9 8z" />
    </svg>
);

const ProfileIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <circle cx="12" cy="7" r="4" />
        <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
    </svg>
);

const AffiliateIcon: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill={isActive ? 'currentColor' : 'none'} strokeLinecap="round" strokeLinejoin="round">
       <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
       <path d="M17.5 15a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0 -5z"></path>
       <path d="M6.5 15a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0 -5z"></path>
       <path d="M17.5 15l-11 0"></path>
       <path d="M17.5 17.5l-11 0"></path>
       <path d="M12 7a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0 -5z"></path>
       <path d="M12 7v-4h-5a2 2 0 0 0 -2 2v5"></path>
       <path d="M12 7v-4h5a2 2 0 0 1 2 2v5"></path>
    </svg>
 );
 

const CustomerPortalNav: React.FC<CustomerPortalNavProps> = ({ activeTab, setActiveTab }) => {
    return (
        <nav className="fixed bottom-0 left-0 right-0 z-20 flex justify-around bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] dark:shadow-[0_-2px_10px_rgba(0,0,0,0.3)]">
            <NavButton label="Beranda" icon={<HomeIcon isActive={activeTab === 'home'} />} isActive={activeTab === 'home'} onClick={() => setActiveTab('home')} />
            <NavButton label="Tagihan" icon={<BillIcon isActive={activeTab === 'bills'} />} isActive={activeTab === 'bills'} onClick={() => setActiveTab('bills')} />
            <NavButton label="Video" icon={<VideoIcon isActive={activeTab === 'video'} />} isActive={activeTab === 'video'} onClick={() => setActiveTab('video')} />
            <NavButton label="PPOB" icon={<PPOBIcon isActive={activeTab === 'ppob'} />} isActive={activeTab === 'ppob'} onClick={() => setActiveTab('ppob')} />
            <NavButton label="Afiliasi" icon={<AffiliateIcon isActive={activeTab === 'affiliate'} />} isActive={activeTab === 'affiliate'} onClick={() => setActiveTab('affiliate')} />
            <NavButton label="Bantuan" icon={<HelpIcon isActive={activeTab === 'help'} />} isActive={activeTab === 'help'} onClick={() => setActiveTab('help')} />
            <NavButton label="Profil" icon={<ProfileIcon isActive={activeTab === 'profile'} />} isActive={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
        </nav>
    );
};

export default CustomerPortalNav;
