import React from 'react';

// Contoh Ikon (gantilah dengan ikon dari library Anda, misal: react-icons)
const UsersIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>;
const WifiIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.555a5.5 5.5 0 017.778 0M12 20.25a.75.75 0 100-1.5.75.75 0 000 1.5zM4.444 12.889a10 10 0 0115.112 0" /></svg>; // Ikon untuk ODP
const ServerIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>; // Ikon untuk ODC
const TaskIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;

const TechnicianSidebar: React.FC<{ activePage: string }> = ({ activePage }) => {
    const navItems = [
        { id: 'tasks', path: '#technician/tasks', label: 'My Tasks', icon: <TaskIcon /> },
        { id: 'customers', path: '#technician/customers', label: 'Customers', icon: <UsersIcon /> },
        { id: 'odp', path: '#technician/odp', label: 'ODP List', icon: <WifiIcon /> },
        { id: 'odc', path: '#technician/odc', label: 'ODC List', icon: <ServerIcon /> },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 h-16 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-50">
            <nav className="flex justify-around items-center h-full">
                {navItems.map(item => {
                    const isActive = activePage === item.id;
                    return (
                        <a
                            key={item.id}
                            href={item.path}
                            className={`flex flex-col items-center justify-center w-full h-full text-xs font-medium transition-colors ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-300'}`}
                        >
                            <div className="mb-1">{item.icon}</div>
                            <span>{item.label}</span>
                        </a>
                    );
                })}
            </nav>
        </div>
    );
};

export default TechnicianSidebar;