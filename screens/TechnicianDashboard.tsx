import React, { useState } from 'react';
import { AdminUser } from '~/types';
import TaskList from './technician/TaskList';
import TaskDetail from './technician/TaskDetail';
import TechnicianCustomers from './technician/TechnicianCustomers';
import OdpListPage from './technician/OdpListPage'; // Import the new ODP List Page
import OdcListPage from './technician/OdcListPage'; // Import the new ODC List Page
import TechnicianSidebar from '~/components/TechnicianSidebar';
export type TechnicianPage = 'tasks' | 'customers' | 'odp' | 'odc'; // Add 'odp' and 'odc'

interface TechnicianDashboardProps {
    user: AdminUser;
    page: TechnicianPage;
}

const TechnicianDashboard: React.FC<TechnicianDashboardProps> = ({ user, page }) => {
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    const renderContent = () => {
        if (selectedTaskId) {
            return <TaskDetail taskId={selectedTaskId} onBack={() => setSelectedTaskId(null)} user={user} />;
        }

        switch (page) {
            case 'tasks':
                return <TaskList onSelectTask={(taskId) => setSelectedTaskId(taskId)} technicianId={user.id} />;
            case 'customers':
                return <TechnicianCustomers />;
            case 'odp': // New case for ODP List
                return <OdpListPage />;
            case 'odc': // New case for ODC List
                return <OdcListPage />;
            default:
                return <TaskList onSelectTask={(taskId) => setSelectedTaskId(taskId)} technicianId={user.id} />;
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-gray-50 dark:bg-gray-900">
            <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-20">
                {renderContent()}
            </main>
            {!selectedTaskId && <TechnicianSidebar activePage={page} />}
        </div>
    );
};

export default TechnicianDashboard;
