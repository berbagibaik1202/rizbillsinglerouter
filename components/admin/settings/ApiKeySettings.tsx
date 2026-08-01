import React, { useState } from 'react';
import { ApiSettings } from '../../../types';
import Card from '../../common/Card';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api/admin/settings';

interface ApiKeySettingsProps {
    settings: ApiSettings['app'];
    onKeyGenerated: () => void; // Callback to refresh settings in parent
}

const ApiKeySettings: React.FC<ApiKeySettingsProps> = ({ settings, onKeyGenerated }) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [copySuccess, setCopySuccess] = useState('');

    const handleGenerateKey = async () => {
        if (!window.confirm('Are you sure you want to generate a new API key? This will invalidate the current key immediately.')) {
            return;
        }
        setIsGenerating(true);
        setFeedback(null);
        try {
            const res = await fetchWithAuth(`${API_URL}/generate-apikey`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Failed to generate key.');
            }
            setFeedback({ type: 'success', message: 'New API key generated and saved successfully!' });
            onKeyGenerated(); // Notify parent to refetch settings
        } catch (error: any) {
            setFeedback({ type: 'error', message: error.message });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopy = () => {
        if (settings.apiKey) {
            navigator.clipboard.writeText(settings.apiKey);
            setCopySuccess('Copied!');
            setTimeout(() => setCopySuccess(''), 2000);
        }
    };

    return (
        <Card title="External API Key">
            <div className="space-y-6">
                {feedback && (
                    <div className={`p-3 rounded-md text-sm ${feedback.type === 'success' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'}`}>
                        {feedback.message}
                    </div>
                )}
                <div className="space-y-3">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Gunakan kunci ini untuk mengautentikasi permintaan ke API dari aplikasi atau layanan eksternal. Kunci ini harus disertakan dalam header `X-API-Key`.
                    </p>
                    {settings.apiKey ? (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Current API Key</label>
                            <div className="mt-1 flex rounded-md shadow-sm">
                                <input
                                    type="text"
                                    readOnly
                                    value={settings.apiKey}
                                    className="font-mono text-sm p-2 block w-full rounded-none rounded-l-md bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                                />
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-500"
                                >
                                    {copySuccess ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                    )}
                                    <span className="ml-2 text-xs">{copySuccess || 'Copy'}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <p className="p-4 text-center bg-gray-100 dark:bg-gray-700/50 rounded-md text-sm text-gray-500 dark:text-gray-400">
                            No API key has been generated yet.
                        </p>
                    )}
                </div>

                <div className="border-t border-red-400 dark:border-red-600 p-4 rounded-md bg-red-50 dark:bg-red-900/30 space-y-3">
                    <h3 className="font-semibold text-lg text-red-700 dark:text-red-400">Generate New Key</h3>
                    <p className="text-sm text-red-600 dark:text-red-300">
                        <strong className="font-bold">Warning:</strong> Generating a new key will immediately invalidate the old one. Any external services using the old key will no longer have access.
                    </p>
                    <button
                        onClick={handleGenerateKey}
                        disabled={isGenerating}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-semibold shadow-sm transition-colors flex items-center disabled:bg-red-400"
                    >
                        {isGenerating && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                        {isGenerating ? 'Generating...' : 'Generate New API Key'}
                    </button>
                </div>
            </div>
        </Card>
    );
};

export default ApiKeySettings;