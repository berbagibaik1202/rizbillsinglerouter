import React from 'react';
import Card from '../../common/Card';
import { ApiSettings } from '~/types';

type GeminiSettingsProps = {
    geminiSettings: ApiSettings['gemini'];
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
};

const GeminiSettings: React.FC<GeminiSettingsProps> = ({ geminiSettings, handleInputChange }) => {
    return (
        <Card title="Google Gemini AI">
            <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Gemini powers the AI chatbot. Provide the API key so the backend can call Google Gemini on behalf of users.
                </p>
                <div className="space-y-2">
                    <label className="flex flex-col text-sm font-medium text-gray-700 dark:text-gray-200">
                        API Key
                        <input
                            type="text"
                            name="gemini.apiKey"
                            value={geminiSettings?.apiKey || ''}
                            onChange={handleInputChange}
                            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                            placeholder="Paste your Gemini API key here"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <input
                            type="checkbox"
                            name="gemini.enabled"
                            checked={!!geminiSettings?.enabled}
                            onChange={handleInputChange}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-500"
                        />
                        Enable Gemini integration
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        The key is stored securely in the application settings; it will be included when saving all other configuration values below.
                    </p>
                </div>
                {geminiSettings?.apiKey ? (
                    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200">
                        Current value: <code className="break-all">{geminiSettings.apiKey}</code>
                    </div>
                ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">No Gemini API key has been saved yet.</p>
                )}
            </div>
        </Card>
    );
};

export default GeminiSettings;
