import React from 'react';
import NotificationBell from './NotificationBell';
import { AdminUser } from '~/types';

interface HeaderProps {
    user: AdminUser;
}

const Header: React.FC<HeaderProps> = ({ user }) => {
    const dispatchToggle = () => {
        window.dispatchEvent(new CustomEvent('toggleAdminSidebar'));
    };

    return (
        <header className="bg-white dark:bg-gray-800 shadow-sm p-4 flex items-center justify-between sticky top-0 z-20">
            {/* Left side: Hamburger menu for mobile */}
            <button
                onClick={dispatchToggle}
                className="md:hidden p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label="Toggle sidebar"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>
             <div className="hidden md:block">
                 {/* Can add breadcrumbs or page title here later */}
             </div>

            {/* Right side: Notifications and User */}
            <div className="flex items-center space-x-4">
                <NotificationBell />
                <div className="flex items-center">
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{user.username}</span>
                    {/* You can add a user menu dropdown here later */}
                </div>
            </div>
        </header>
    );
};

export default Header;
