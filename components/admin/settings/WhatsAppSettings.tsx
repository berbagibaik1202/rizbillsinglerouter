import React, { useEffect, useState } from 'react';
import Card from '../../common/Card';
import { ApiSettings } from '../../../types';

type WhatsAppStatus = {
    status: 'disconnected' | 'connecting' | 'connected' | 'qr' | 'error' | 'standby',
    user?: { id: string, name: string },
    providerMode?: 'baileys' | 'custom' | 'fonnte' | 'wa',
};
type TestMessageStatus = 'idle' | 'sending' | 'success' | 'error';

interface WhatsAppSettingsProps {
    whatsappSettings: ApiSettings['whatsapp'];
    otpSettings: ApiSettings['otp'];
    waStatus: WhatsAppStatus;
    waQr: string | null;
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
    handleWaLogout: () => void;
    handleWaConnect: () => void;
    testPhone: string;
    setTestPhone: (value: string) => void;
    handleSendTestMessage: () => void;
    testMsgStatus: TestMessageStatus;
    testMsgResponse: string;
    isChatbotConfigured: boolean;
}

const WhatsAppSettings: React.FC<WhatsAppSettingsProps> = ({
    whatsappSettings,
    otpSettings,
    waStatus,
    waQr,
    handleInputChange,
    handleWaLogout,
    handleWaConnect,
    testPhone,
    setTestPhone,
    handleSendTestMessage,
    testMsgStatus,
    testMsgResponse,
    isChatbotConfigured,
}) => {
    const inputClasses = "w-full p-2 border rounded bg-gray-50 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 dark:text-white dark:placeholder-gray-400";
    const textAreaClasses = `mt-1 block w-full p-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 ${inputClasses}`;
    const placeholderClasses = "text-xs font-mono p-0.5 bg-gray-200 dark:bg-gray-600 rounded-sm";
    const kirimdevEnabled = Boolean(whatsappSettings?.customGateway?.apiKey);
    const fonnteEnabled = Boolean(whatsappSettings?.fonnteGateway?.apiKey);
    const normalizeProviderMode = (value: unknown): 'baileys' | 'custom' | 'fonnte' => {
        const mode = String(value || 'baileys').toLowerCase();
        if (mode === 'custom' || mode === 'fonnte') return mode;
        if (mode === 'wa') return 'fonnte';
        return 'baileys';
    };
    const initialDeliveryMode = normalizeProviderMode(whatsappSettings?.deliveryMode);
    const activeDeliveryMode = normalizeProviderMode(whatsappSettings?.deliveryMode);
    const statusProviderMode = String(waStatus.providerMode || activeDeliveryMode).toLowerCase();
    const canSendTestMessage = kirimdevEnabled || fonnteEnabled || waStatus.status === 'connected';
    const kirimdevWebhookUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/webhook/kirimdev/whatsapp`
        : '/webhook/kirimdev/whatsapp';
    const fonnteWebhookUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/webhook/fonnte/whatsapp`
        : '/webhook/fonnte/whatsapp';
    const providerTabs: Array<{ mode: 'baileys' | 'custom' | 'fonnte'; label: string; description: string }> = [
        { mode: 'baileys', label: 'Baileys', description: 'QR WhatsApp Web' },
        { mode: 'custom', label: 'Kirimdev', description: 'Webhook + API' },
        { mode: 'fonnte', label: 'Fonnte', description: 'Webhook + API' },
    ];
    const [selectedConfigMode, setSelectedConfigMode] = useState<'baileys' | 'custom' | 'fonnte'>(initialDeliveryMode);

    useEffect(() => {
        setSelectedConfigMode(initialDeliveryMode);
    }, [initialDeliveryMode]);

    const selectedConfigNormalizedMode = normalizeProviderMode(selectedConfigMode);
    const isBaileysTab = selectedConfigNormalizedMode === 'baileys';
    const isCustomMode = selectedConfigNormalizedMode === 'custom';
    const isFonnteMode = selectedConfigNormalizedMode === 'fonnte';
    const deliveryModeLabel = activeDeliveryMode === 'baileys' ? 'Baileys' : activeDeliveryMode === 'custom' ? 'Kirimdev' : 'Fonnte';
    const channelStatusLabel = activeDeliveryMode === 'baileys'
        ? (waStatus.status === 'connected'
            ? 'Connected'
            : waStatus.status === 'qr'
            ? 'QR ready'
            : waStatus.status === 'connecting'
            ? 'Connecting'
            : waStatus.status === 'error'
            ? 'Error'
            : waStatus.status === 'standby'
            ? 'Standby'
            : 'Disconnected')
        : `${deliveryModeLabel} aktif`;

    const Placeholders: React.FC<{ keys: string[] }> = ({ keys }) => (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Placeholders: {keys.map(key => <code key={key} className={placeholderClasses}>{`{{${key}}}`}</code>).reduce((prev, curr) => <>{prev}, {curr}</>)}
        </p>
    );


    const openWhatsAppPage = () => {
        window.location.hash = 'admin/whatsapp';
    };

    return (
        <div className="space-y-6">
            <Card title="WhatsApp Connection">
                <div className="flex flex-col md:flex-row items-start gap-6">
                    <div className="flex-1 space-y-3">
                        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
                            <label htmlFor="whatsappDeliveryMode" className="block text-sm font-medium text-gray-900 dark:text-gray-200">
                                Channel aktif
                            </label>
                            <select
                                id="whatsappDeliveryMode"
                                name="whatsapp.deliveryMode"
                                value={activeDeliveryMode}
                                onChange={handleInputChange}
                                className={`mt-2 block w-full max-w-sm ${inputClasses}`}
                            >
                                <option value="baileys">Baileys</option>
                                <option value="custom">Kirimdev</option>
                                <option value="fonnte">Fonnte</option>
                            </select>
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                Channel yang dipilih di sini yang aktif dipakai server. Kredensial channel lain boleh diisi, tetapi tidak akan aktif kalau tidak dipilih di dropdown.
                            </p>
                        </div>
                        {isBaileysTab && waStatus.status === 'standby' && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                                <strong>Standby</strong>
                            </div>
                        )}
                        {isBaileysTab && waStatus.status === 'error' && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                                <strong>Error:</strong> Could not connect to WhatsApp.
                            </div>
                        )}
                    </div>
                    <div className="flex-shrink-0 w-full md:w-56 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 text-center dark:border-gray-700 dark:bg-gray-800/60">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Status server
                        </div>
                        <div className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-200">
                            {channelStatusLabel}
                        </div>
                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Aktif: {deliveryModeLabel}
                        </div>
                    </div>
                </div>
                <div className="mt-6 border-t dark:border-gray-700 pt-4 space-y-4">
                    <div>
                        <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-1">Konfigurasi Channel</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Tab di bawah hanya untuk mengisi kredensial. Channel aktif tetap mengikuti dropdown di atas.
                        </p>
                    </div>
                    <div className="space-y-4">
                        <div className="inline-flex w-full flex-wrap gap-2 rounded-2xl bg-gray-100 p-2 dark:bg-gray-800">
                            {providerTabs.map((tab) => {
                                const active = selectedConfigMode === tab.mode;
                                return (
                                    <button
                                        key={tab.mode}
                                        type="button"
                                        onClick={() => setSelectedConfigMode(tab.mode)}
                                        className={`flex min-w-[120px] flex-1 flex-col items-start rounded-xl px-4 py-3 text-left transition-all ${active ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-100 dark:ring-gray-700' : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-700/70'}`}
                                    >
                                        <span className="text-sm font-semibold">{tab.label}</span>
                                        <span className="text-xs opacity-80">{tab.description}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {selectedConfigNormalizedMode === 'baileys' && (
                                <div className="lg:col-span-2 rounded-md border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-xs text-gray-600 dark:text-gray-300">
                                    <div className="font-medium text-gray-700 dark:text-gray-200">Mode Baileys</div>
                                    <p className="mt-1">
                                        Tidak ada form provider tambahan. QR WhatsApp Web ditampilkan di blok Baileys di bawah jika tab Baileys sedang dibuka.
                                    </p>
                                </div>
                            )}
                            {isCustomMode && (
                                <>
                                    <div>
                                        <label htmlFor="customGatewayApiKey" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kirimdev API Key</label>
                                        <input
                                            type="password"
                                            id="customGatewayApiKey"
                                            name="whatsapp.customGateway.apiKey"
                                            value={whatsappSettings?.customGateway?.apiKey || ''}
                                            onChange={handleInputChange}
                                            className={`mt-1 block w-full ${inputClasses}`}
                                            placeholder="kdv_live_..."
                                        />
                                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                            Kirimdev akan mengambil nomor aktif secara otomatis dari API key ini.
                                        </p>
                                    </div>
                                    <div>
                                        <label htmlFor="outsideWindowTemplateName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kirimdev Wrapper Template Name</label>
                                        <input
                                            type="text"
                                            id="outsideWindowTemplateName"
                                            name="whatsapp.customGateway.outsideWindowTemplateName"
                                            value={whatsappSettings?.customGateway?.outsideWindowTemplateName || ''}
                                            onChange={handleInputChange}
                                            className={`mt-1 block w-full ${inputClasses}`}
                                            placeholder="order_shipped_fallback"
                                        />
                                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                            Dipakai untuk broadcast via Kirimdev dan juga fallback jika jendela 24 jam tertutup. Template harus approved dan body-nya cukup satu parameter positional <code className={placeholderClasses}>{'{{1}}'}</code>.
                                        </p>
                                    </div>
                                    <div>
                                        <label htmlFor="outsideWindowTemplateLanguage" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kirimdev Template Language</label>
                                        <input
                                            type="text"
                                            id="outsideWindowTemplateLanguage"
                                            name="whatsapp.customGateway.outsideWindowTemplateLanguage"
                                            value={whatsappSettings?.customGateway?.outsideWindowTemplateLanguage || 'id'}
                                            onChange={handleInputChange}
                                            className={`mt-1 block w-full ${inputClasses}`}
                                            placeholder="id"
                                        />
                                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                            Contoh: <code className={placeholderClasses}>id</code> atau <code className={placeholderClasses}>en_US</code>.
                                        </p>
                                    </div>
                                    <div className="lg:col-span-2 rounded-md border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-xs text-gray-600 dark:text-gray-300">
                                        <div className="font-medium text-gray-700 dark:text-gray-200">Webhook Kirimdev untuk chatbot</div>
                                        <div className="mt-1 break-all font-mono">{kirimdevWebhookUrl}</div>
                                        <p className="mt-2">
                                            Arahkan webhook inbound Kirimdev ke URL ini agar chatbot tetap menerima pesan masuk saat mode Kirimdev dipilih.
                                        </p>
                                    </div>
                                </>
                            )}
                        {isFonnteMode && (
                                <>
                                    <div>
                                        <label htmlFor="fonnteApiKey" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fonnte API Token</label>
                                        <input
                                            type="password"
                                            id="fonnteApiKey"
                                            name="whatsapp.fonnteGateway.apiKey"
                                            value={whatsappSettings?.fonnteGateway?.apiKey || ''}
                                            onChange={handleInputChange}
                                            className={`mt-1 block w-full ${inputClasses}`}
                                            placeholder="TOKEN_FONNTE"
                                        />
                                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                            Gunakan token device Fonnte dari menu Device. Token ini dipakai untuk semua pesan keluar saat mode Fonnte aktif.
                                        </p>
                                    </div>
                                    <div>
                                        <label htmlFor="fonnteCountryCode" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fonnte Country Code</label>
                                        <input
                                            type="text"
                                            id="fonnteCountryCode"
                                            name="whatsapp.fonnteGateway.countryCode"
                                            value={whatsappSettings?.fonnteGateway?.countryCode || '0'}
                                            onChange={handleInputChange}
                                            className={`mt-1 block w-full ${inputClasses}`}
                                            placeholder="0"
                                        />
                                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                            Jika nomor sudah disimpan dalam format <code className={placeholderClasses}>62...</code>, biarkan <code className={placeholderClasses}>0</code>. Jika ingin Fonnte menambahkan kode negara sendiri, isi misalnya <code className={placeholderClasses}>62</code>.
                                        </p>
                                    </div>
                                    <div>
                                        <label htmlFor="fonnteTimeoutMs" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fonnte Timeout (ms)</label>
                                        <input
                                            type="number"
                                            min={1000}
                                            step={500}
                                            id="fonnteTimeoutMs"
                                            name="whatsapp.fonnteGateway.timeoutMs"
                                            value={whatsappSettings?.fonnteGateway?.timeoutMs ?? 20000}
                                            onChange={handleInputChange}
                                            className={`mt-1 block w-full ${inputClasses}`}
                                        />
                                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                            Batas waktu request ke API Fonnte.
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center">
                                            <input
                                                type="checkbox"
                                                id="fonntePreview"
                                                name="whatsapp.fonnteGateway.preview"
                                                checked={whatsappSettings?.fonnteGateway?.preview ?? false}
                                                onChange={handleInputChange}
                                                className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
                                            />
                                            <label htmlFor="fonntePreview" className="ml-2 block text-sm font-medium text-gray-900 dark:text-gray-200">
                                                Preview link Fonnte
                                            </label>
                                        </div>
                                        <div className="flex items-center">
                                            <input
                                                type="checkbox"
                                                id="fonnteTyping"
                                                name="whatsapp.fonnteGateway.typing"
                                                checked={whatsappSettings?.fonnteGateway?.typing ?? false}
                                                onChange={handleInputChange}
                                                className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
                                            />
                                            <label htmlFor="fonnteTyping" className="ml-2 block text-sm font-medium text-gray-900 dark:text-gray-200">
                                                Simulasikan typing Fonnte
                                            </label>
                                        </div>
                                    </div>
                                    <div className="lg:col-span-2 rounded-md border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs text-blue-700 dark:text-blue-200">
                                        <div className="font-medium">Fonnte mode</div>
                                        <p className="mt-1">
                                            Mode Fonnte dipakai untuk pengiriman outbound lewat API dan inbound lewat webhook.
                                        </p>
                                        <div className="mt-2 break-all font-mono">{fonnteWebhookUrl}</div>
                                        <p className="mt-2">
                                            Set URL webhook device Fonnte ke alamat ini dan aktifkan <code className={placeholderClasses}>autoread</code> di device Fonnte agar pesan masuk diteruskan ke chatbot.
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                        {isBaileysTab && (
                            <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900/40">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">QR WhatsApp Web</div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Gunakan QR ini hanya setelah menekan tombol Connect di panel Baileys.
                                        </p>
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        Status server: {statusProviderMode}
                                    </div>
                                </div>
                                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
                                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                        <div className="text-sm text-gray-700 dark:text-gray-200">
                                            {waStatus.status === 'connected' && (
                                                <span className="font-medium text-green-700 dark:text-green-300">
                                                    Connected
                                                </span>
                                            )}
                                            {waStatus.status === 'qr' && (
                                                <span className="font-medium text-blue-700 dark:text-blue-300">
                                                    QR ready
                                                </span>
                                            )}
                                            {waStatus.status === 'connecting' && (
                                                <span className="font-medium text-yellow-700 dark:text-yellow-300">
                                                    Connecting
                                                </span>
                                            )}
                                            {waStatus.status === 'standby' && (
                                                <span className="font-medium text-amber-700 dark:text-amber-300">
                                                    Standby
                                                </span>
                                            )}
                                            {waStatus.status === 'disconnected' && (
                                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                                    Disconnected
                                                </span>
                                            )}
                                            {waStatus.status === 'error' && (
                                                <span className="font-medium text-red-700 dark:text-red-300">
                                                    Error
                                                </span>
                                            )}
                                            {waStatus.user && waStatus.status === 'connected' && (
                                                <span className="block text-xs text-gray-500 dark:text-gray-400">
                                                    As: {waStatus.user.name} ({waStatus.user.id.split(':')[0]})
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {waStatus.status === 'connected' ? (
                                                <button type="button" onClick={handleWaLogout} className="inline-flex justify-center items-center px-4 py-2 border border-red-300 dark:border-red-600 shadow-sm text-sm font-medium rounded-md text-red-700 dark:text-red-300 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/50">
                                                    Disconnect
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={handleWaConnect}
                                                    className="inline-flex justify-center items-center px-4 py-2 border border-blue-300 dark:border-blue-600 shadow-sm text-sm font-medium rounded-md text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/50"
                                                >
                                                    Connect
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-4 flex min-h-[240px] items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
                                    {waQr && activeDeliveryMode === 'baileys' && waStatus.status === 'qr' ? (
                                        <img src={waQr} alt="Scan to connect WhatsApp" className="max-h-[240px] w-full object-contain p-2" />
                                    ) : (
                                        <div className="px-4 text-center text-sm text-gray-500 dark:text-gray-400 space-y-2">
                                            {waStatus.status === 'connected' && <div>Connection established.</div>}
                                            {waStatus.status === 'standby' && <div>Standby aktif. QR tidak tersedia.</div>}
                                            {waStatus.status !== 'connected' && waStatus.status !== 'standby' && (
                                                <>
                                                    <div>QR code akan muncul setelah Connect ditekan.</div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Status Kirimdev: {kirimdevEnabled ? 'siap' : 'belum dikonfigurasi'} | Status Fonnte: {fonnteEnabled ? 'siap' : 'belum dikonfigurasi'} | Mode aktif: {deliveryModeLabel}.
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={openWhatsAppPage}
                            className="inline-flex items-center px-4 py-2 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
                        >
                            Buka Halaman Chat
                        </button>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            Pilihan channel tersimpan di settings dan baru aktif penuh setelah disimpan.
                        </span>
                    </div>
                </div>
                <div className="mt-6 border-t dark:border-gray-700 pt-4">
                    <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">Send Test Message</h4>
                     <div className="flex items-start space-x-2">
                        <input
                            type="tel"
                            value={testPhone}
                            onChange={(e) => setTestPhone(e.target.value)}
                            placeholder="Enter phone number (e.g., 62812...)"
                            className={`block w-full max-w-xs ${inputClasses}`}
                        />
                        <button
                            type="button"
                            onClick={handleSendTestMessage}
                            disabled={testMsgStatus === 'sending' || !canSendTestMessage}
                            className="inline-flex justify-center items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
                        >
                            {testMsgStatus === 'sending' ? 'Sending...' : 'Send Test'}
                        </button>
                    </div>
                     {testMsgResponse && (
                        <p className={`mt-2 text-sm ${testMsgStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {testMsgResponse}
                        </p>
                    )}
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Sends a predefined test message. Backend will use the active transport and fallback to the other available transport when possible.</p>
                </div>
                <div className="mt-6 border-t dark:border-gray-700 pt-4">
                    <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">WhatsApp Chatbot</h4>
                     <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="chatbotEnabled"
                            name="whatsapp.chatbotEnabled"
                            checked={whatsappSettings?.chatbotEnabled || false}
                            onChange={handleInputChange}
                            className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="chatbotEnabled" className="ml-2 block text-sm font-medium text-gray-900 dark:text-gray-200">
                            Enable AI Chatbot
                        </label>
                    </div>
                     {whatsappSettings?.chatbotEnabled && !isChatbotConfigured && (
                        <div className="mt-3 p-3 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 rounded-md text-sm">
                            <strong>Warning:</strong> The chatbot is enabled, but the Gemini API Key is not configured on the server. The chatbot will not be active. Please see the "Gemini AI" tab for configuration instructions.
                        </div>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        When enabled, the system will use Google Gemini to automatically respond to customer messages on this WhatsApp number, allowing for self-service actions like rebooting devices or changing Wi-Fi passwords.
                    </p>
                </div>
            </Card>

            <Card title="WhatsApp Message Templates">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6">
                    <div>
                        <label htmlFor="otpWhatsappTemplate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Customer Login OTP</label>
                        <textarea id="otpWhatsappTemplate" name="otp.whatsappTemplate" value={otpSettings?.whatsappTemplate || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['otpCode']} />
                    </div>
                    <div>
                        <label htmlFor="invoiceCreated" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Invoice Created</label>
                        <textarea id="invoiceCreated" name="whatsapp.invoiceCreated" value={whatsappSettings?.invoiceCreated || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'invoiceId', 'amount', 'dueDate', 'paymentLink', 'packageName', 'billingPeriod']} />
                    </div>
                    <div>
                        <label htmlFor="invoiceReminder" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Due Date Reminder (H-1)</label>
                        <textarea id="invoiceReminder" name="whatsapp.invoiceReminder" value={whatsappSettings?.invoiceReminder || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'invoiceId', 'amount', 'paymentLink', 'packageName', 'billingPeriod', 'dueDate']} />
                    </div>
                    <div>
                        <label htmlFor="paymentSuccess" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Payment Success</label>
                        <textarea id="paymentSuccess" name="whatsapp.paymentSuccess" value={whatsappSettings?.paymentSuccess || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'invoiceId', 'amount', 'packageName', 'billingPeriod', 'paymentMethod']} />
                    </div>
                    <div>
                        <label htmlFor="affiliateTopupSuccess" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Affiliate Top-Up Success</label>
                        <textarea id="affiliateTopupSuccess" name="whatsapp.affiliateTopupSuccess" value={whatsappSettings?.affiliateTopupSuccess || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'amount', 'newBalance']} />
                    </div>
                    <div>
                        <label htmlFor="suspensionWarning" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Suspension Warning</label>
                        <textarea id="suspensionWarning" name="whatsapp.suspensionWarning" value={whatsappSettings?.suspensionWarning || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'invoiceId', 'amount', 'dueDate', 'packageName', 'billingPeriod']} />
                    </div>

                    {/* New templates for suspension and re-activation */}
                     <div>
                        <label htmlFor="accountSuspended" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Account Suspended</label>
                        <textarea id="accountSuspended" name="whatsapp.accountSuspended" value={whatsappSettings?.accountSuspended || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'packageName', 'billingPeriod']} />
                    </div>
                     <div>
                        <label htmlFor="accountReactivated" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Account Re-activated</label>
                        <textarea id="accountReactivated" name="whatsapp.accountReactivated" value={whatsappSettings?.accountReactivated || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'packageName', 'billingPeriod']} />
                    </div>
                     <div>
                        <label htmlFor="accountDeactivated" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Account Deactivated (Inactive)</label>
                        <textarea id="accountDeactivated" name="whatsapp.accountDeactivated" value={whatsappSettings?.accountDeactivated || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId']} />
                    </div>
                    <div>
                        <label htmlFor="resellerBalanceAdded" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Reseller Balance Added</label>
                        <textarea id="resellerBalanceAdded" name="whatsapp.resellerBalanceAdded" value={whatsappSettings?.resellerBalanceAdded || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['amountAdded', 'newBalance']} />
                    </div>
                    <div>
                        <label htmlFor="technicianTaskAssignment" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Technician Task Assignment</label>
                        <textarea id="technicianTaskAssignment" name="whatsapp.technicianTaskAssignment" value={whatsappSettings?.technicianTaskAssignment || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['technicianName', 'ticketId', 'customerName', 'customerAddress', 'complaintType', 'complaintDescription']} />
                    </div>
                     <div>
                        <label htmlFor="packageChanged" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Package Changed Successfully</label>
                        <textarea id="packageChanged" name="whatsapp.packageChanged" value={whatsappSettings?.packageChanged || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'newPackageName']} />
                    </div>
                    <div className="lg:col-span-2 border-t dark:border-gray-700 pt-4">
                         <h4 className="text-md font-medium text-gray-800 dark:text-gray-200 mb-2">Broadcast Templates</h4>
                    </div>
                     <div>
                        <label htmlFor="broadcastGeneral" className="block text-sm font-medium text-gray-700 dark:text-gray-300">General Broadcast Template</label>
                        <textarea id="broadcastGeneral" name="whatsapp.broadcastGeneral" value={whatsappSettings?.broadcastGeneral || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'packageName']} />
                    </div>
                    <div>
                        <label htmlFor="broadcastOutage" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Outage Notification Template</label>
                        <textarea id="broadcastOutage" name="whatsapp.broadcastOutage" value={whatsappSettings?.broadcastOutage || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'packageName']} />
                    </div>
                    <div>
                        <label htmlFor="broadcastDelayMode" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Broadcast Delay Mode</label>
                        <select
                            id="broadcastDelayMode"
                            name="whatsapp.broadcastDelayMode"
                            value={whatsappSettings?.broadcastDelayMode || 'step'}
                            onChange={handleInputChange}
                            className={`mt-1 block w-full ${inputClasses}`}
                        >
                            <option value="flat">Flat</option>
                            <option value="linear">Linear</option>
                            <option value="step">Step / Batch</option>
                            <option value="randomized">Randomized</option>
                        </select>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Flat: delay tetap. Linear: naik tiap pesan. Step: naik per beberapa pesan. Randomized: acak natural.
                        </p>
                    </div>
                    <div>
                        <label htmlFor="broadcastDelayStartMs" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Broadcast Initial Delay (ms)</label>
                        <input
                            type="number"
                            min={0}
                            step={100}
                            id="broadcastDelayStartMs"
                            name="whatsapp.broadcastDelayStartMs"
                            value={whatsappSettings?.broadcastDelayStartMs ?? 1000}
                            onChange={handleInputChange}
                            className={`mt-1 block w-full ${inputClasses}`}
                        />
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Delay awal setelah pesan pertama terkirim.
                        </p>
                    </div>
                    <div>
                        <label htmlFor="broadcastDelayIncrementMs" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Broadcast Delay Increment (ms)</label>
                        <input
                            type="number"
                            min={0}
                            step={100}
                            id="broadcastDelayIncrementMs"
                            name="whatsapp.broadcastDelayIncrementMs"
                            value={whatsappSettings?.broadcastDelayIncrementMs ?? 750}
                            onChange={handleInputChange}
                            className={`mt-1 block w-full ${inputClasses}`}
                        />
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Setiap pesan berikutnya akan menambah jeda sebesar nilai ini sampai batas maksimum.
                        </p>
                    </div>
                    <div>
                        <label htmlFor="broadcastDelayStepEvery" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Broadcast Step Every (messages)</label>
                        <input
                            type="number"
                            min={1}
                            step={1}
                            id="broadcastDelayStepEvery"
                            name="whatsapp.broadcastDelayStepEvery"
                            value={whatsappSettings?.broadcastDelayStepEvery ?? 5}
                            onChange={handleInputChange}
                            className={`mt-1 block w-full ${inputClasses}`}
                        />
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Hanya dipakai untuk mode Step. Contoh 5 berarti delay naik setiap 5 pesan.
                        </p>
                    </div>
                    <div>
                        <label htmlFor="broadcastDelayRandomJitterMs" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Broadcast Random Jitter (ms)</label>
                        <input
                            type="number"
                            min={0}
                            step={100}
                            id="broadcastDelayRandomJitterMs"
                            name="whatsapp.broadcastDelayRandomJitterMs"
                            value={whatsappSettings?.broadcastDelayRandomJitterMs ?? 1500}
                            onChange={handleInputChange}
                            className={`mt-1 block w-full ${inputClasses}`}
                        />
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Hanya dipakai untuk mode Randomized. Nilai ini menentukan seberapa jauh delay bisa diacak dari delay awal.
                        </p>
                    </div>
                    <div className="lg:col-span-2">
                        <label htmlFor="broadcastDelayMaxMs" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Broadcast Maximum Delay (ms)</label>
                        <input
                            type="number"
                            min={0}
                            step={100}
                            id="broadcastDelayMaxMs"
                            name="whatsapp.broadcastDelayMaxMs"
                            value={whatsappSettings?.broadcastDelayMaxMs ?? 7000}
                            onChange={handleInputChange}
                            className={`mt-1 block w-full max-w-xs ${inputClasses}`}
                        />
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Delay bertingkat tidak akan melebihi nilai ini.
                        </p>
                    </div>
                    <div className="lg:col-span-2 border-t dark:border-gray-700 pt-4">
                        <label htmlFor="adminPhoneNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Admin/Technician Phone Number</label>
                        <input
                            type="tel"
                            id="adminPhoneNumber"
                            name="whatsapp.adminPhoneNumber"
                            value={whatsappSettings?.adminPhoneNumber || ''}
                            onChange={handleInputChange}
                            className={`mt-1 block w-full max-w-xs ${inputClasses}`}
                            placeholder="e.g., 628123456789"
                        />
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            The number that will receive notifications for new customer complaints. Use country code format.
                        </p>
                    </div>
                    <div>
                        <label htmlFor="newComplaintNotification" className="block text-sm font-medium text-gray-700 dark:text-gray-300">New Complaint Notification (for Admin)</label>
                        <textarea id="newComplaintNotification" name="whatsapp.newComplaintNotification" value={whatsappSettings?.newComplaintNotification || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'customerPhone', 'complaintType', 'description', 'packageName']} />
                    </div>
                    <div>
                        <label htmlFor="newRegistrationNotification" className="block text-sm font-medium text-gray-700 dark:text-gray-300">New Registration Notification (for Admin)</label>
                        <textarea id="newRegistrationNotification" name="whatsapp.newRegistrationNotification" value={whatsappSettings?.newRegistrationNotification || ''} onChange={handleInputChange} rows={4} className={textAreaClasses} />
                        <Placeholders keys={['customerName', 'customerId', 'customerPhone', 'customerEmail', 'packageName', 'address']} />
                    </div>
                </div>
             </Card>
        </div>
    );
};

export default WhatsAppSettings;
