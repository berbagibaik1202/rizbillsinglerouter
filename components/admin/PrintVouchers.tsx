import React from 'react';
import { HotspotVoucher } from '../../types';

interface PrintVouchersProps {
    isOpen: boolean;
    onClose: () => void;
    vouchers: HotspotVoucher[];
    appName?: string;
}

const PrintVouchers: React.FC<PrintVouchersProps> = ({ isOpen, onClose, vouchers, appName = 'Internet Voucher' }) => {
    
    const handlePrint = () => {
        window.print();
    };

    if (!isOpen) return null;

    return (
        <div id="print-area-wrapper" className="fixed z-30 inset-0 overflow-y-auto">
            <div className="flex items-start justify-center min-h-screen p-4">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black/80" onClick={onClose}></div>
                
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg shadow-xl p-4 sm:p-6 z-30 w-full max-w-4xl my-8 transform transition-all">
                    <div className="flex justify-between items-center mb-4 no-print">
                        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Print Vouchers ({vouchers.length})</h2>
                        <div className="space-x-2">
                             <button onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-md text-sm font-medium">Close</button>
                             <button onClick={handlePrint} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v3a2 2 0 002 2h6a2 2 0 002-2v-3h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" /></svg>
                                Print
                            </button>
                        </div>
                    </div>

                    <div id="print-area" className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-white p-4 rounded-md">
                        {vouchers.map(voucher => (
                             <div key={voucher.id} className="voucher-card text-center border-2 border-dashed border-gray-300 p-2 rounded-lg break-inside-avoid">
                                <p className="font-bold text-sm text-gray-800">{appName}</p>
                                <div className="my-2 py-2 border-y border-gray-200">
                                    <p className="text-xs text-gray-500">Kode Voucher</p>
                                    <p className="font-mono font-bold text-lg text-gray-900 tracking-wider">{voucher.username}</p>
                                </div>
                                <p className="text-xs text-gray-600">{voucher.profile}</p>
                            </div>
                        ))}
                    </div>

                </div>
            </div>
        </div>
    );
};

export default PrintVouchers;