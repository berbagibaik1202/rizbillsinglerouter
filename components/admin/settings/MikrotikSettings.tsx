import React, { useState } from 'react';
import { ApiSettings } from '../../../types';
import Card from '../../common/Card';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

interface MikrotikSettingsProps {
    settings: ApiSettings['mikrotik'];
    appSettings: ApiSettings['app'];
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    handleTestConnection: () => void;
    testStatus: TestStatus;
    testMessage: string;
}

const MikrotikSettings: React.FC<MikrotikSettingsProps> = ({ settings, appSettings, handleInputChange, handleTestConnection, testStatus, testMessage }) => {
    
    const [copied, setCopied] = useState<'login' | 'logout' | null>(null);

    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400";
    
    const webhookUrl = appSettings.baseUrl ? `${appSettings.baseUrl.replace(/\/$/, '')}/api/hotspot/webhook` : 'http://<YOUR_BACKEND_IP>:<PORT>/api/hotspot/webhook';
    const apiKey = appSettings.apiKey;

    // Construct the header string for the API key
    const apiKeyHeader = apiKey ? `http-header-field="X-API-Key: ${apiKey}"` : '';

    const onLoginScript = `/tool fetch url="${webhookUrl}" http-method=post http-data="{\\"event\\":\\"login\\",\\"username\\":\\"$(user)\\",\\"ip\\":\\"$(address)\\",\\"mac\\":\\"$(mac-address)\\"}" http-header-field="Content-Type: application/json" ${apiKeyHeader}`;

    const onLogoutScript = `/tool fetch url="${webhookUrl}" http-method=post http-data="{\\"event\\":\\"logout\\",\\"username\\":\\"$(user)\\",\\"ip\\":\\"$(address)\\",\\"mac\\":\\"$(mac-address)\\"}" http-header-field="Content-Type: application/json" ${apiKeyHeader}`;


    const handleCopy = (scriptText: string, type: 'login' | 'logout') => {
        if (!apiKey) {
            alert('Please generate an API Key in the "API Key" tab first.');
            return;
        }
        navigator.clipboard.writeText(scriptText);
        setCopied(type);
        setTimeout(() => setCopied(null), 2000);
    };

    const CopyIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>;
    const CheckIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;

    return (
        <Card title="MikroTik Router API Settings">
            <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Enter the connection details for your MikroTik router. Ensure the API service is enabled on the router (IP &gt; Services) and that you have a dedicated API user with `api`, `read`, and `write` permissions.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input type="text" name="mikrotik.host" placeholder="Router Host / IP Address" value={settings.host || ''} onChange={handleInputChange} className={inputClasses} />
                    <input type="number" name="mikrotik.port" placeholder="API Port (default: 8728)" value={settings.port || ''} onChange={handleInputChange} className={inputClasses} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input type="text" name="mikrotik.user" placeholder="API Username" value={settings.user || ''} onChange={handleInputChange} className={inputClasses} />
                    <input type="password" name="mikrotik.password" placeholder="API Password" value={settings.password || ''} onChange={handleInputChange} className={inputClasses} autoComplete="new-password" />
                </div>
                <div className="pt-2">
                    <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={testStatus === 'testing'}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 font-semibold shadow-sm transition-colors flex items-center disabled:bg-indigo-400"
                    >
                         {testStatus === 'testing' && <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                        {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                    </button>
                </div>
                {testStatus !== 'idle' && testMessage && (
                    <div className={`mt-4 p-3 rounded-md text-sm ${testStatus === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'}`}>
                        <strong>{testStatus === 'success' ? 'Success:' : 'Error:'}</strong> {testMessage}
                    </div>
                )}
            </div>

             <div className="mt-6 pt-6 border-t dark:border-gray-700 space-y-4">
                <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200">Remote ONT Access</h3>
                <div>
                    <label htmlFor="remoteAccessUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Remote Access URL</label>
                    <input
                        type="text"
                        id="remoteAccessUrl"
                        name="mikrotik.remoteAccessUrl"
                        value={settings.remoteAccessUrl || ''}
                        onChange={handleInputChange}
                        className={`mt-1 ${inputClasses}`}
                        placeholder="e.g., http://public.myisp.com:8080"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">URL publik yang akan dimuat di iframe. Jika menggunakan NAT dinamis, ini adalah alamat publik Anda.</p>
                </div>

                <div className="mt-6 pt-4 border-t dark:border-gray-600 space-y-4">
                     <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200">Dynamic Remote ONT NAT</h4>
                      <div className="flex items-center">
                        <input type="checkbox" id="enableDynamicNat" name="mikrotik.enableDynamicNat" checked={settings.enableDynamicNat || false} onChange={handleInputChange} className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500" />
                        <label htmlFor="enableDynamicNat" className="ml-2 block text-sm font-medium text-gray-900 dark:text-gray-200">
                           Enable Dynamic NAT Rule
                        </label>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">Otomatis membuat dan memperbarui aturan NAT di MikroTik untuk akses remote. Ini membutuhkan izin `tulis` untuk API user Anda.</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <input type="text" name="mikrotik.natInInterface" placeholder="In-Interface (e.g., ether1)" value={settings.natInInterface || ''} onChange={handleInputChange} className={inputClasses} />
                        <input type="number" name="mikrotik.natPublicPort" placeholder="Public Port (e.g., 8080)" value={settings.natPublicPort || ''} onChange={handleInputChange} className={inputClasses} />
                        <input type="number" name="mikrotik.natOntPort" placeholder="ONT Port (e.g., 80)" value={settings.natOntPort || ''} onChange={handleInputChange} className={inputClasses} />
                    </div>
                </div>
            </div>

            <div className="mt-6 pt-6 border-t dark:border-gray-700 space-y-4">
                <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200">Hotspot Webhook Scripts</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Untuk aktivasi voucher hotspot secara real-time, salin skrip ini dan tempelkan ke `IP &gt; Hotspot &gt; User Profiles &gt; (profil voucher Anda) &gt; Tab Scripts`. Ini akan mengirim notifikasi ke backend Anda saat pengguna login atau logout.
                </p>

                {!apiKey && (
                    <div className="p-3 bg-yellow-100 text-yellow-800 dark:bg-yellow-800/30 dark:text-yellow-300 rounded-md text-sm">
                        <strong>Warning:</strong> No API Key found. Please go to the "API Key" tab to generate one. The scripts below will not work without it.
                    </div>
                )}

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">On Login Script</label>
                        <div className="mt-1 flex rounded-md shadow-sm">
                            <textarea
                                readOnly
                                value={onLoginScript}
                                rows={4}
                                className={`font-mono text-xs p-2 block w-full rounded-none rounded-l-md ${inputClasses}`}
                            />
                            <button
                                type="button"
                                onClick={() => handleCopy(onLoginScript, 'login')}
                                className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-500"
                            >
                                {copied === 'login' ? <CheckIcon /> : <CopyIcon />}
                                <span className="ml-2">{copied === 'login' ? 'Copied' : 'Copy'}</span>
                            </button>
                        </div>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">On Logout Script</label>
                        <div className="mt-1 flex rounded-md shadow-sm">
                            <textarea
                                readOnly
                                value={onLogoutScript}
                                rows={4}
                                className={`font-mono text-xs p-2 block w-full rounded-none rounded-l-md ${inputClasses}`}
                            />
                            <button
                                type="button"
                                onClick={() => handleCopy(onLogoutScript, 'logout')}
                                className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-500"
                            >
                                {copied === 'logout' ? <CheckIcon /> : <CopyIcon />}
                                <span className="ml-2">{copied === 'logout' ? 'Copied' : 'Copy'}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default MikrotikSettings;