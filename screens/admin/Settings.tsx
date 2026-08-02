import React, { useState, useEffect, useCallback } from 'react';
import { ApiSettings, PppoeProfile, HotspotProfile } from '../../types';
import GeneralSettings from '../../components/admin/settings/GeneralSettings';
import MikrotikSettings from '../../components/admin/settings/MikrotikSettings';
import BillingPaymentsSettings from '../../components/admin/settings/BillingPaymentsSettings';
import WhatsAppSettings from '../../components/admin/settings/WhatsAppSettings';
import AcsSettings from '../../components/admin/settings/AcsSettings';
import GeminiSettings from '../../components/admin/settings/GeminiSettings';
import DatabaseSettings from '../../components/admin/settings/DatabaseSettings';
import ApiKeySettings from '../../components/admin/settings/ApiKeySettings';
import DigiflazzSettings from '../../components/admin/settings/DigiflazzSettings';
import OltSettings from '../../components/admin/settings/OltSettings';
import VideoApiSettings from '../../components/admin/settings/VideoApiSettings';
import EmailSettings from '../../components/admin/settings/EmailSettings';
import AppUpdateSettings from '../../components/admin/settings/AppUpdateSettings';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

const defaultSettings: ApiSettings = {
    mikrotik: { host: '', user: '', password: '', port: 8728 },
    tripay: { apiKey: '', privateKey: '', merchantCode: '', sandboxMode: true, enabledMethods: [] },
    digiflazz: { username: '', apiKey: '', sandboxMode: false },
    gemini: { apiKey: '', enabled: false },
    video: { enabled: false, title: 'TV Channel', playlistUrl: '', playlistText: '', posterUrl: '', description: '', autoplay: false, loop: false, controls: true },
    billing: { taxRate: 0, dueDays: 7, fixedBillDueDays: 3, generationDay: 1, suspensionDays: 3, suspensionProfileName: '', whatsappNotificationsEnabled: false },
    // Fix: Add missing customerIdPrefix to the default app settings.
    app: { baseUrl: '', appName: '', appLogoUrl: '', companyPhone: '', companyAddress: '', customerIdPrefix: '', apiKey: '' },
    otp: { enabled: false, whatsappTemplate: 'Your OTP code is {{otpCode}}' },
        whatsapp: {
            invoiceCreated: '',
            invoiceReminder: '',
            paymentSuccess: '',
            suspensionWarning: '',
        adminPhoneNumber: '',
        newComplaintNotification: '',
        newRegistrationNotification: '',
        accountSuspended: '',
        accountReactivated: '',
        accountDeactivated: '',
        resellerBalanceAdded: '',
        // FIX: Add missing 'technicianTaskAssignment' property.
        technicianTaskAssignment: '',
        // FIX: Add missing 'packageChanged' property to satisfy the ApiSettings type.
        packageChanged: '',
        broadcastGeneral: '',
        broadcastOutage: '',
        broadcastDelayMode: 'step',
        broadcastDelayStartMs: 1000,
        broadcastDelayIncrementMs: 750,
        broadcastDelayMaxMs: 7000,
        broadcastDelayStepEvery: 5,
        broadcastDelayRandomJitterMs: 1500,
        chatbotEnabled: false,
            standbyEnabled: false,
            deliveryMode: 'baileys',
            customGateway: {
                apiKey: '',
                timeoutMs: 20000,
                outsideWindowTemplateName: '',
                outsideWindowTemplateLanguage: 'id',
            },
            fonnteGateway: {
                apiKey: '',
                countryCode: '0',
                timeoutMs: 20000,
                preview: false,
                typing: false,
            },
        },
    email: {
        enabled: false,
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: '',
        smtpPass: '',
        fromName: '',
        fromEmail: '',
        createdSubject: 'Invoice baru #{{invoiceId}} - {{customerName}}',
        createdBody: 'Halo {{customerName}},\n\nInvoice #{{invoiceId}} sebesar {{amount}} untuk paket {{packageName}} (periode {{billingPeriod}}) telah diterbitkan pada {{issueDate}} dan jatuh tempo pada {{dueDate}}.\n\nLink pembayaran: {{paymentLink}}\n\nTerima kasih.',
        dueSubject: 'Pengingat jatuh tempo invoice #{{invoiceId}} - {{customerName}}',
        dueBody: 'Halo {{customerName}},\n\nInvoice #{{invoiceId}} sebesar {{amount}} untuk paket {{packageName}} (periode {{billingPeriod}}) jatuh tempo pada {{dueDate}}.\n\nLink pembayaran: {{paymentLink}}\n\nTerima kasih.',
        paidSubject: 'Pembayaran berhasil invoice #{{invoiceId}} - {{customerName}}',
        paidBody: 'Halo {{customerName}},\n\nPembayaran untuk invoice #{{invoiceId}} sebesar {{amount}} telah kami terima melalui {{paymentMethod}}.\n\nTerima kasih.',
    },
// FIX: Add missing 'acs' property to default settings.
    acs: { apiUrl: '', username: '', password: '' },
    olt: { devices: [] },
};

const normalizeWhatsappDeliveryMode = (value: unknown): ApiSettings['whatsapp']['deliveryMode'] => {
    const mode = String(value || '').toLowerCase();
    if (mode === 'custom' || mode === 'fonnte') return mode;
    if (mode === 'wa') return 'fonnte';
    return 'baileys';
};

type SettingsTab = 'general' | 'mikrotik' | 'billing' | 'digiflazz' | 'whatsapp' | 'email' | 'acs' | 'olt' | 'gemini' | 'video' | 'database' | 'update' | 'apiKey';
type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type WhatsAppStatus = { status: 'disconnected' | 'connecting' | 'connected' | 'qr' | 'error' | 'standby', user?: { id: string, name: string } };
type TestMessageStatus = 'idle' | 'sending' | 'success' | 'error';
type OltTestResult = {
    id: string;
    name: string;
    success: boolean;
    message: string;
    source?: string;
};

const Settings: React.FC = () => {
    const [settings, setSettings] = useState<ApiSettings>(defaultSettings as ApiSettings);
    const [pppoeProfiles, setPppoeProfiles] = useState<PppoeProfile[]>([]);
    const [hotspotProfiles, setHotspotProfiles] = useState<HotspotProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveNotification, setSaveNotification] = useState<{ message: string; type: 'success' | 'error' | 'warning'; visible: boolean }>({ message: '', type: 'success', visible: false });
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    
    // Mikrotik State
    const [testStatus, setTestStatus] = useState<TestStatus>('idle');
    const [testMessage, setTestMessage] = useState('');
    
    // WhatsApp State
    const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ status: 'disconnected' });
    const [waQr, setWaQr] = useState<string | null>(null);
    const [testPhone, setTestPhone] = useState('');
    const [testMsgStatus, setTestMsgStatus] = useState<TestMessageStatus>('idle');
    const [testMsgResponse, setTestMsgResponse] = useState('');
    const [testEmailTarget, setTestEmailTarget] = useState('');
    const [emailTestStatus, setEmailTestStatus] = useState<TestMessageStatus>('idle');
    const [emailTestResponse, setEmailTestResponse] = useState('');
    const [isChatbotConfigured, setIsChatbotConfigured] = useState(true);
    const [isTestingOlt, setIsTestingOlt] = useState(false);
    const [oltTestResults, setOltTestResults] = useState<OltTestResult[]>([]);

    const setNestedValue = (source: any, path: string[], value: any) => {
        if (path.length === 0) return value;
        const [head, ...rest] = path;
        const base = Array.isArray(source) ? [...source] : { ...(source || {}) };
        base[head] = rest.length === 0 ? value : setNestedValue(base[head], rest, value);
        return base;
    };

    const fetchSettings = useCallback(async () => {
        setIsLoading(true);
        try {
            const settingsRes = await fetchWithAuth(`${API_URL}/admin/settings`);
            if (!settingsRes.ok) throw new Error('Failed to fetch settings data from database.');
            
            const data = await settingsRes.json();
            const mergedSettings: ApiSettings = {
                mikrotik: { ...defaultSettings.mikrotik, ...(data.mikrotik || {}) },
                tripay: { ...defaultSettings.tripay, ...(data.tripay || {}) },
                billing: { ...defaultSettings.billing, ...(data.billing || {}) },
                app: { ...defaultSettings.app, ...(data.app || {}) },
                video: { ...defaultSettings.video, ...(data.video || {}) },
                otp: { ...defaultSettings.otp, ...(data.otp || {}) },
                whatsapp: {
                    ...defaultSettings.whatsapp,
                    ...(data.whatsapp || {}),
                    deliveryMode: normalizeWhatsappDeliveryMode(data.whatsapp?.deliveryMode ?? defaultSettings.whatsapp.deliveryMode),
                    customGateway: {
                        ...(defaultSettings.whatsapp.customGateway || {}),
                        apiKey: String(data.whatsapp?.customGateway?.apiKey || ''),
                        timeoutMs: Number(data.whatsapp?.customGateway?.timeoutMs ?? defaultSettings.whatsapp.customGateway?.timeoutMs ?? 20000),
                        outsideWindowTemplateName: String(data.whatsapp?.customGateway?.outsideWindowTemplateName || ''),
                        outsideWindowTemplateLanguage: String(data.whatsapp?.customGateway?.outsideWindowTemplateLanguage || defaultSettings.whatsapp.customGateway?.outsideWindowTemplateLanguage || 'id'),
                    },
                    fonnteGateway: {
                        ...(defaultSettings.whatsapp.fonnteGateway || {}),
                        apiKey: String(data.whatsapp?.fonnteGateway?.apiKey || ''),
                        countryCode: String(data.whatsapp?.fonnteGateway?.countryCode || defaultSettings.whatsapp.fonnteGateway?.countryCode || '0'),
                        timeoutMs: Number(data.whatsapp?.fonnteGateway?.timeoutMs ?? defaultSettings.whatsapp.fonnteGateway?.timeoutMs ?? 20000),
                        preview: data.whatsapp?.fonnteGateway?.preview !== undefined
                            ? Boolean(data.whatsapp?.fonnteGateway?.preview)
                            : Boolean(defaultSettings.whatsapp.fonnteGateway?.preview),
                        typing: data.whatsapp?.fonnteGateway?.typing !== undefined
                            ? Boolean(data.whatsapp?.fonnteGateway?.typing)
                            : Boolean(defaultSettings.whatsapp.fonnteGateway?.typing),
                    },
                },
                email: { ...defaultSettings.email, ...(data.email || {}) },
                gemini: { ...defaultSettings.gemini, ...(data.gemini || {}) },
    acs: { ...defaultSettings.acs, ...(data.acs || {}) },
                digiflazz: { ...defaultSettings.digiflazz, ...(data.digiflazz || {}) },
                olt: { ...defaultSettings.olt, ...(data.olt || {}) },
            };
            setSettings(mergedSettings);
        } catch (error) {
            console.error(error);
            setSettings(defaultSettings as ApiSettings);
            showSaveNotification('Could not load settings from server.', 'error');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const fetchProfiles = useCallback(async () => {
        try {
            const [pppoeRes, hotspotRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/pppoe/profiles`),
                fetchWithAuth(`${API_URL}/hotspot/profiles`),
            ]);
            if (pppoeRes.ok) setPppoeProfiles(await pppoeRes.json());
            if (hotspotRes.ok) setHotspotProfiles(await hotspotRes.json());
        } catch (error) {
            console.error("Could not fetch profiles:", error);
        }
    }, []);


    useEffect(() => {
        fetchSettings();
        fetchProfiles();

        const fetchChatbotStatus = async () => {
            try {
                const res = await fetchWithAuth(`${API_URL}/admin/chatbot-status`);
                if (res.ok) {
                    const data = await res.json();
                    setIsChatbotConfigured(data.configured);
                } else {
                    setIsChatbotConfigured(false);
                }
            } catch (e) {
                console.error("Failed to fetch chatbot config status", e);
                setIsChatbotConfigured(false);
            }
        };
        fetchChatbotStatus();

        const refreshWhatsAppStatus = async () => {
            try {
                const statusRes = await fetchWithAuth(`${API_URL}/admin/whatsapp/status`);
                const statusData: WhatsAppStatus = await statusRes.json();
                setWaStatus(statusData);

                if (statusData.status === 'qr') {
                    const qrRes = await fetchWithAuth(`${API_URL}/admin/whatsapp/qr`);
                    const qrData = await qrRes.json();
                    setWaQr(qrData.qr);
                } else {
                    setWaQr(null);
                }
            } catch (error) {
                console.error("Failed to poll WhatsApp status:", error);
                setWaStatus({ status: 'error' });
                setWaQr(null);
            }
        };

        void refreshWhatsAppStatus();
        const intervalId = setInterval(() => {
            void refreshWhatsAppStatus();
        }, 3000);

        return () => clearInterval(intervalId);
    }, [fetchSettings, fetchProfiles]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        const path = name.split('.');
    
        // Custom logic for array of numbers from checkboxes
        if ((e.target as HTMLInputElement).dataset.type === 'number-array-toggle') {
            const idToToggle = Number(value);
            const isChecked = (e.target as HTMLInputElement).checked;
            const [category, field] = path;
    
            setSettings(prev => {
                const prevCategoryState = prev[category as keyof ApiSettings] as any;
                const currentArray = prevCategoryState ? (prevCategoryState[field] || []) : [];
                // Ensure we are working with an array
                const validArray = Array.isArray(currentArray) ? currentArray : [];
                
                let newArray;
                if (isChecked) {
                    // Add the ID if it's not already in the array
                    newArray = [...new Set([...validArray, idToToggle])];
                } else {
                    // Remove the ID from the array
                    newArray = validArray.filter(id => id !== idToToggle);
                }
                
                return {
                    ...prev,
                    [category]: {
                        ...prevCategoryState,
                        [field]: newArray,
                    },
                };
            });
            return; // Stop execution for this custom type
        }
    
        const finalValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : (type === 'number' ? (value === '' ? '' : Number(value)) : value);
    
        setSettings(prev => setNestedValue(prev, path, finalValue));
    };
    
    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result as string;
            setSettings(prev => ({
                ...prev,
                app: {
                    ...prev.app,
                    appLogoUrl: base64String,
                }
            }));
        };
        reader.readAsDataURL(file);
    };

    const handleClearLogo = () => {
        setSettings(prev => ({
            ...prev,
            app: {
                ...prev.app,
                appLogoUrl: '',
            }
        }));
    };

    const handlePaymentMethodChange = (methodCode: string) => {
        setSettings(prev => {
            const currentMethods = prev.tripay.enabledMethods || [];
            const newMethods = currentMethods.includes(methodCode)
                ? currentMethods.filter(m => m !== methodCode)
                : [...currentMethods, methodCode];
            return {
                ...prev,
                tripay: {
                    ...prev.tripay,
                    enabledMethods: newMethods,
                },
            };
        });
    };

    const showSaveNotification = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
        setSaveNotification({ message, type, visible: true });
        setTimeout(() => {
            setSaveNotification({ message: '', type: 'success', visible: false });
        }, 5000);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/admin/settings`, {
                method: 'PUT',
                body: JSON.stringify(settings),
            });
            const data = await res.json();
            if (data.warning) {
                showSaveNotification(data.warning, 'warning');
            } else {
                showSaveNotification('Settings saved successfully!');
            }
        } catch (error: any) {
            showSaveNotification(error.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleTestConnection = async () => {
        setTestStatus('testing');
        setTestMessage('');
        try {
            const res = await fetchWithAuth(`${API_URL}/admin/mikrotik/test-connection`, {
                method: 'POST',
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setTestStatus('success');
                setTestMessage(data.message);
            } else {
                throw new Error(data.message);
            }
        } catch (err: any) {
            setTestStatus('error');
            setTestMessage(err.message);
        }
    };

    const handleTestOltConnection = async () => {
        setIsTestingOlt(true);
        setOltTestResults([]);
        try {
            const devRes = await fetchWithAuth('/api/olt/devices');
            const devData = devRes.ok ? await devRes.json() : [];
            if (!devRes.ok || !Array.isArray(devData) || devData.length === 0) {
                throw new Error('Belum ada OLT tersimpan untuk dites.');
            }
            const checks = await Promise.allSettled(
                devData.map(async (d: any) => {
                    const id = String(d.id || d.host || d.name || '').trim();
                    if (!id) {
                        return {
                            id: '',
                            name: String(d.name || d.host || 'OLT'),
                            success: false,
                            message: 'ID OLT tidak valid.',
                        } as OltTestResult;
                    }
                    const res = await fetchWithAuth(`/api/olt/${encodeURIComponent(id)}/test`, { method: 'POST' });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        return {
                            id,
                            name: String(d.name || d.host || id),
                            success: false,
                            message: data?.message || `HTTP ${res.status}`,
                            source: data?.source,
                        } as OltTestResult;
                    }
                    return {
                        id,
                        name: String(d.name || d.host || id),
                        success: true,
                        message: data?.message || 'Koneksi berhasil.',
                        source: data?.source,
                    } as OltTestResult;
                })
            );
            const results: OltTestResult[] = checks.map((item) => {
                if (item.status === 'fulfilled') return item.value;
                return {
                    id: '',
                    name: 'OLT',
                    success: false,
                    message: item.reason?.message || 'Gagal tes koneksi.',
                };
            });
            setOltTestResults(results);
            const successCount = results.filter((r) => r.success).length;
            const failedCount = results.length - successCount;
            if (failedCount === 0) {
                showSaveNotification(`Tes koneksi OLT selesai: ${successCount}/${results.length} berhasil.`, 'success');
            } else if (successCount > 0) {
                showSaveNotification(`Tes koneksi OLT selesai: ${successCount} berhasil, ${failedCount} gagal.`, 'warning');
            } else {
                showSaveNotification(`Tes koneksi OLT gagal: ${failedCount}/${results.length} gagal.`, 'error');
            }
        } catch (err: any) {
            showSaveNotification(err.message || 'Gagal mengetes koneksi OLT.', 'error');
            setOltTestResults([]);
            console.error('[OLT Test][UI] Error testing OLT connection:', err);
        } finally {
            setIsTestingOlt(false);
        }
    };

    const handleWaLogout = async () => {
        if (!window.confirm('Are you sure you want to disconnect from WhatsApp? You will need to scan a new QR code to reconnect.')) return;
        try {
            await fetchWithAuth(`${API_URL}/admin/whatsapp/logout`, { method: 'POST' });
        } catch (err) {
            console.error(err);
        }
    };

    const handleWaConnect = async () => {
        try {
            await fetchWithAuth(`${API_URL}/admin/whatsapp/connect`, {
                method: 'POST',
                body: JSON.stringify({
                    deliveryMode: settings.whatsapp?.deliveryMode || 'baileys',
                }),
            });
            const statusRes = await fetchWithAuth(`${API_URL}/admin/whatsapp/status`);
            const statusData: WhatsAppStatus = await statusRes.json();
            setWaStatus(statusData);

            if (statusData.status === 'qr') {
                const qrRes = await fetchWithAuth(`${API_URL}/admin/whatsapp/qr`);
                const qrData = await qrRes.json();
                setWaQr(qrData.qr);
            } else {
                setWaQr(null);
            }
        } catch (err) {
            console.error(err);
        }
    };
    
    const handleSendTestMessage = async () => {
        setTestMsgStatus('sending');
        setTestMsgResponse('');
        try {
             const res = await fetchWithAuth(`${API_URL}/admin/whatsapp/test-message`, {
                method: 'POST',
                body: JSON.stringify({ phoneNumber: testPhone, message: `This is a test message from ${settings.app.appName}.` }),
            });
             const data = await res.json();
             if (res.ok) {
                 setTestMsgStatus('success');
                 setTestMsgResponse(
                    data.transport
                        ? `${data.message} Target: ${data.recipient || testPhone}. Transport: ${data.transport}.`
                        : data.message
                 );
             } else {
                 throw new Error(data.message);
             }
        } catch (err: any) {
            setTestMsgStatus('error');
            setTestMsgResponse(err.message);
        }
    };

    const handleSendTestEmail = async () => {
        setEmailTestStatus('sending');
        setEmailTestResponse('');
        try {
            const res = await fetchWithAuth(`${API_URL}/admin/email/test`, {
                method: 'POST',
                body: JSON.stringify({ to: testEmailTarget }),
            });
            const data = await res.json();
            if (res.ok) {
                setEmailTestStatus('success');
                setEmailTestResponse(data.message || 'Test email sent.');
            } else {
                throw new Error(data.message || 'Failed to send test email.');
            }
        } catch (error: any) {
            setEmailTestStatus('error');
            setEmailTestResponse(error.message || 'Failed to send test email.');
        }
    };

    const TabButton: React.FC<{ tab: SettingsTab, label: string }> = ({ tab, label }) => (
        <button
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === tab ? 'bg-blue-600 text-white shadow' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
        >
            {label}
        </button>
    );

    return (
        <div className="space-y-4">
            <div className="sticky top-0 z-10 -mt-2 md:-mt-6 lg:-mt-2 -mx-2 md:-mx-6 lg:-mx-0 px-4 md:px-2 lg:px-4 pt-4 md:pt-6 lg:pt-4 pb-2 flex flex-wrap gap-2 bg-white dark:bg-gray-800 border-b dark:border-gray-700">
                <TabButton tab="general" label="General" />
                <TabButton tab="mikrotik" label="MikroTik" />
                <TabButton tab="billing" label="Billing & Payments" />
                <TabButton tab="digiflazz" label="Digiflazz" />
                <TabButton tab="whatsapp" label="WhatsApp" />
                <TabButton tab="email" label="Email" />
                <TabButton tab="acs" label="ACS Server" />
                <TabButton tab="olt" label="OLT / SNMP" />
                <TabButton tab="gemini" label="Gemini AI" />
                <TabButton tab="video" label="TV Playlist" />
                <TabButton tab="apiKey" label="API Key" />
                <TabButton tab="database" label="Database" />
                <TabButton tab="update" label="Update App" />
            </div>

            <div>
                {isLoading ? (
                    <p>Loading settings...</p>
                ) : (
                    <>
                        {activeTab === 'general' && <GeneralSettings settings={settings.app} otpSettings={settings.otp} handleInputChange={handleInputChange} handleLogoUpload={handleLogoUpload} handleClearLogo={handleClearLogo} />}
                        {activeTab === 'mikrotik' && <MikrotikSettings settings={settings.mikrotik} appSettings={settings.app} handleInputChange={handleInputChange} handleTestConnection={handleTestConnection} testStatus={testStatus} testMessage={testMessage} />}
                        {activeTab === 'billing' && <BillingPaymentsSettings billingSettings={settings.billing} tripaySettings={settings.tripay} pppoeProfiles={pppoeProfiles} hotspotProfiles={hotspotProfiles} handleInputChange={handleInputChange} handlePaymentMethodChange={handlePaymentMethodChange} />}
                        {activeTab === 'digiflazz' && <DigiflazzSettings settings={settings.digiflazz || defaultSettings.digiflazz!} baseUrl={settings.app.baseUrl} handleInputChange={handleInputChange} />}
                        {activeTab === 'whatsapp' && <WhatsAppSettings whatsappSettings={settings.whatsapp} otpSettings={settings.otp} waStatus={waStatus} waQr={waQr} handleInputChange={handleInputChange} handleWaLogout={handleWaLogout} handleWaConnect={handleWaConnect} testPhone={testPhone} setTestPhone={setTestPhone} handleSendTestMessage={handleSendTestMessage} testMsgStatus={testMsgStatus} testMsgResponse={testMsgResponse} isChatbotConfigured={isChatbotConfigured} />}
                        {activeTab === 'email' && <EmailSettings emailSettings={settings.email || defaultSettings.email!} handleInputChange={handleInputChange} testTargetEmail={testEmailTarget} setTestTargetEmail={setTestEmailTarget} onSendTestEmail={handleSendTestEmail} testStatus={emailTestStatus} testMessage={emailTestResponse} />}
                        {activeTab === 'acs' && <AcsSettings settings={settings.acs} handleInputChange={handleInputChange} />}
                        {activeTab === 'olt' && (
                            <div className="space-y-4">
                                <div className="flex justify-start">
                                    <button
                                        type="button"
                                        onClick={handleTestOltConnection}
                                        disabled={isTestingOlt}
                                        className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                                    >
                                        {isTestingOlt ? 'Mengetes koneksi...' : 'Tes Koneksi OLT/SNMP'}
                                    </button>
                                </div>
                                <OltSettings devices={settings.olt?.devices || []} onChange={(devices) => setSettings(prev => ({ ...prev, olt: { devices } }))} />
                                {oltTestResults.length > 0 && (
                                    <div className="rounded-md border dark:border-gray-700 overflow-hidden">
                                        <div className="px-3 py-2 text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-100">
                                            Hasil Tes Koneksi OLT
                                        </div>
                                        <div className="divide-y dark:divide-gray-700">
                                            {oltTestResults.map((row, idx) => (
                                                <div key={`${row.id}-${idx}`} className="px-3 py-2 text-sm flex items-center justify-between gap-3 bg-white dark:bg-gray-800">
                                                    <div className="min-w-0">
                                                        <div className="font-medium text-gray-800 dark:text-gray-100 truncate">{row.name}</div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{row.message}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {row.source && (
                                                            <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                                                                {String(row.source).toUpperCase()}
                                                            </span>
                                                        )}
                                                        <span className={`px-2 py-0.5 rounded text-xs ${row.success ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-200' : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200'}`}>
                                                            {row.success ? 'OK' : 'GAGAL'}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {activeTab === 'gemini' && <GeminiSettings geminiSettings={settings.gemini} handleInputChange={handleInputChange} />}
                        {activeTab === 'video' && <VideoApiSettings settings={settings.video || defaultSettings.video!} handleInputChange={handleInputChange} onUploadPlaylist={async (file) => {
                            const formData = new FormData();
                            formData.append('playlistFile', file);
                            const res = await fetchWithAuth(`${API_URL}/admin/settings/video-playlist`, {
                                method: 'POST',
                                body: formData,
                            });
                            const data = await res.json();
                            if (!res.ok) {
                                throw new Error(data.message || 'Gagal upload playlist.');
                            }
                            setSettings(prev => ({
                                ...prev,
                                video: {
                                    ...(prev.video || defaultSettings.video),
                                    enabled: Boolean(prev.video?.enabled ?? true),
                                    playlistUrl: data.playlistUrl || '',
                                    playlistText: '',
                                },
                            }));
                            showSaveNotification('Playlist berhasil diupload.', 'success');
                        }} onDeletePlaylist={async () => {
                            const res = await fetchWithAuth(`${API_URL}/admin/settings/video-playlist`, {
                                method: 'DELETE',
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) {
                                throw new Error(data.message || 'Gagal menghapus playlist.');
                            }
                            setSettings(prev => ({
                                ...prev,
                                video: {
                                    ...(prev.video || defaultSettings.video),
                                    enabled: false,
                                    playlistUrl: '',
                                    playlistText: '',
                                },
                            }));
                            showSaveNotification('Playlist berhasil dihapus.', 'success');
                        }} />}
                        {activeTab === 'database' && <DatabaseSettings />}
                        {activeTab === 'update' && <AppUpdateSettings />}
                        {activeTab === 'apiKey' && <ApiKeySettings settings={settings.app} onKeyGenerated={fetchSettings} />}
                    </>
                )}
            </div>

            {saveNotification.visible && (
                <div className={`fixed top-20 right-8 border px-4 py-3 rounded-lg shadow-lg z-50 ${saveNotification.type === 'success' ? 'bg-green-100 border-green-400 text-green-700' : saveNotification.type === 'warning' ? 'bg-yellow-100 border-yellow-400 text-yellow-700' : 'bg-red-100 border-red-400 text-red-700'}`}>
                    <strong>{saveNotification.type.charAt(0).toUpperCase() + saveNotification.type.slice(1)}!</strong>
                    <span className="block sm:inline ml-2">{saveNotification.message}</span>
                </div>
            )}

            {!isLoading && (
                <div className="fixed z-30 bottom-20 left-3 sm:left-8 sm:bottom-10">
                    <div className="flex justify-start rounded-xl border border-gray-200 bg-white/95 px-3 py-3 shadow-2xl backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/95">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="min-w-[200px] rounded-md bg-green-600 px-4 py-2 text-white font-semibold shadow-sm transition-colors hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                            {isSaving && <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                            {isSaving ? 'Saving...' : 'Save All Settings'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
