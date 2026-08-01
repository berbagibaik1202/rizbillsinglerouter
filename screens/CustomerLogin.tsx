import React, { useState } from 'react';
import Card from '../components/common/Card';
import RegistrationModal from '../components/customer/RegistrationModal';
import { ApiSettings } from '../types';

interface CustomerLoginProps {
    onLoginSuccess: (token: string) => void;
    appSettings: ApiSettings | null;
}

const CustomerLogin: React.FC<CustomerLoginProps> = ({ onLoginSuccess, appSettings }) => {
    const [customerId, setCustomerId] = useState('');
    const [otp, setOtp] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loginStep, setLoginStep] = useState<'enter-id' | 'enter-otp'>('enter-id');
    const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);

    const handleRequestOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        if (!customerId.trim()) {
            setError('Please enter your Customer ID.');
            setIsLoading(false);
            return;
        }

        try {
            // Note: fetchWithAuth is fine here, as it won't have a token yet.
            const res = await fetch(`/api/public/login/request-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId: customerId.trim() }),
            });
            
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            if (data.otpRequired) {
                setLoginStep('enter-otp');
            } else {
                onLoginSuccess(data.token);
            }

        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const res = await fetch(`/api/public/login/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId: customerId.trim(), otp }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'OTP verification failed.');
            }

            onLoginSuccess(data.token);
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <RegistrationModal 
                isOpen={isRegisterModalOpen}
                onClose={() => setIsRegisterModalOpen(false)}
            />
            <Card className="w-full max-w-md">
                {loginStep === 'enter-id' ? (
                    <>
                        <div className="flex flex-col items-center mb-6">
                            <img 
                                src={appSettings?.app?.appLogoUrl || '/logo.png'} 
                                alt="App Logo" 
                                className="h-16 w-16 object-contain mb-4" 
                            />
                            <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-gray-100">
                                {appSettings?.app?.appName || 'Customer Login'}
                            </h2>
                        </div>
                        <form onSubmit={handleRequestOtp} className="space-y-6">
                            <div>
                                <label htmlFor="customerId" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Customer ID
                                </label>
                                <input
                                    id="customerId"
                                    name="customerId"
                                    type="text"
                                    autoComplete="username"
                                    required
                                    value={customerId}
                                    onChange={(e) => setCustomerId(e.target.value)}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    placeholder="Contoh 31089012345"
                                />
                            </div>
                            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                            <div>
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-green-400 disabled:cursor-wait"
                                >
                                    {isLoading ? 'Processing...' : 'Masuk'}
                                </button>
                            </div>
                        </form>
                    </>
                ) : (
                    <>
                        <div className="flex flex-col items-center mb-4">
                            <img 
                                src={appSettings?.app?.appLogoUrl || '/logo.png'} 
                                alt="App Logo" 
                                className="h-16 w-16 object-contain mb-4" 
                            />
                            <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-gray-100">
                                {appSettings?.app?.appName || 'Customer Portal'}
                            </h2>
                            <p className="text-md text-center text-gray-500 dark:text-gray-400 mt-1">
                                Enter OTP
                            </p>
                        </div>
                        <p className="text-center text-sm text-gray-600 dark:text-gray-400 mb-6">
                            An OTP has been sent to your registered WhatsApp number for Customer ID: <strong>{customerId}</strong>.
                        </p>
                        <form onSubmit={handleVerifyOtp} className="space-y-6">
                            <div>
                                <label htmlFor="otp" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    6-Digit OTP
                                </label>
                                <input
                                    id="otp"
                                    name="otp"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    required
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                    maxLength={6}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white text-center text-lg tracking-[0.5em]"
                                    placeholder="••••••"
                                />
                            </div>

                            {error && <p className="text-sm text-red-600 text-center">{error}</p>}

                            <div className="flex items-center space-x-2">
                                <button
                                    type="button"
                                    onClick={() => { setLoginStep('enter-id'); setError(''); setOtp(''); }}
                                    className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-gray-200 dark:border-gray-500 dark:hover:bg-gray-500"
                                >
                                    Back
                                </button>
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-green-400 disabled:cursor-wait"
                                >
                                    {isLoading ? 'Verifying...' : 'Verify & Login'}
                                </button>
                            </div>
                        </form>
                    </>
                )}
                <div className="mt-6 text-center text-sm">
                    <p className="text-gray-600 dark:text-gray-400">
                        Belum punya akun?{' '}
                        <button
                            type="button"
                            onClick={() => setIsRegisterModalOpen(true)}
                            className="font-medium text-blue-600 hover:underline dark:text-blue-500 focus:outline-none"
                        >
                            Daftar di sini
                        </button>
                    </p>
                </div>
            </Card>
        </>
    );
};

export default CustomerLogin;