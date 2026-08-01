import React, { useState } from 'react';
import { AdminUser } from '~/types';
import ResellerPortalNav from '~/components/reseller/Sidebar';
import VoucherSales from '~/screens/reseller/VoucherSales';
import MyTransactions from '~/screens/reseller/MyTransactions';

export type ResellerPage = 'voucher_sales' | 'my_transactions';

interface ResellerDashboardProps {
    user: AdminUser;
}

const ResellerDashboard: React.FC<ResellerDashboardProps> = ({ user }) => {
    const [page, setPage] = useState<ResellerPage>('voucher_sales');

    const renderContent = () => {
        switch (page) {
            case 'voucher_sales':
                return <VoucherSales user={user} />;
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