import React from 'react';
import { ApiSettings } from '../../../types';
import Card from '../../common/Card';

interface AcsSettingsProps {
    settings: ApiSettings['acs'];
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const AcsSettings: React.FC<AcsSettingsProps> = ({ settings, handleInputChange }) => {
    
    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400";

    return (
        <Card title="ACS (TR-069) Server Settings">
            <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Configure the connection to your Auto Configuration Server (e.g., GenieACS). This allows the dashboard to fetch device information.
                </p>
                <div>
                    <label htmlFor="acsApiUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">ACS NBI API URL</label>
                    <input
                        type="url"
                        id="acsApiUrl"
                        name="acs.apiUrl"
                        value={settings.apiUrl || ''}
                        onChange={handleInputChange}
                        className={`mt-1 ${inputClasses}`}
                        placeholder="e.g., http://acs.yourdomain.com:7557"
                    />
                     <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Enter the full Northbound Interface (NBI) API URL for your ACS server.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="acsUsername" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username</label>
                        <input
                            type="text"
                            id="acsUsername"
                            name="acs.username"
                            value={settings.username || ''}
                            onChange={handleInputChange}
                            className={`mt-1 ${inputClasses}`}
                            placeholder="API Username (optional)"
                        />
                    </div>
                     <div>
                        <label htmlFor="acsPassword" aria-label="Password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                        <input
                            type="password"
                            id="acsPassword"
                            name="acs.password"
                            value={settings.password || ''}
                            onChange={handleInputChange}
                            className={`mt-1 ${inputClasses}`}
                            placeholder="API Password"
                            autoComplete="new-password"
                        />
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default AcsSettings;