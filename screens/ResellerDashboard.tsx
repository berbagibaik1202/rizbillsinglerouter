import React, { useState } from 'react';
import { AdminUser, ApiSettings } from '~/types';
import ResellerPortalNav from '~/components/reseller/Sidebar';
import VoucherSales from '~/screens/reseller/VoucherSales';
import MyTransactions from '~/screens/reseller/MyTransactions';
import PPOBSections from '~/screens/customer/PPOBSections';

export type ResellerPage = 'voucher_sales' | 'my_transactions' | 'ppob';

interface ResellerDashboardProps {
    user: AdminUser;
    appSettings?: ApiSettings['app'];
}

const ResellerDashboard: React.FC<ResellerDashboardProps> = ({ user, appSettings }) => {
    const [page, setPage] = useState<ResellerPage>('voucher_sales');

    const renderContent = () => {
        switch (page) {
            case 'voucher_sales':
                return <VoucherSales user={user} />;
            case 'ppob':
                return <PPOBSections accountType="reseller" appSettings={appSettings} />;
            case 'my_transactions':
                return <MyTransactions user={user} />;
            default:
                return <VoucherSales user={user} />;
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-gray-50 dark:bg-gray-900">
            <main className="flex-1 overflow-y-auto px-4 pb-20">
                {renderContent()}
            </main>
            <ResellerPortalNav activePage={page} setPage={setPage} />
        </div>
    );
};

export default ResellerDashboard;