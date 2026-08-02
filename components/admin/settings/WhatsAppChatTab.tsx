import React, { useEffect, useMemo, useState } from 'react';
import Card from '../../common/Card';
import { fetchWithAuth } from '~/components/api';
import { ApiSettings } from '../../../types';

type Conversation = {
    id: string;
    name: string;
    phoneNumber: string;
    lastMessage: string;
    updatedAt: string | null;
    unreadCount: number;
    status: string | null;
};

type Message = {
    id: string;
    conversationId: string;
    direction: string;
    from: string;
    to: string;
    contactPhone: string;
    text: string;
    content?: string | null;
    mediaUrl?: string | null;
    status: string;
    createdAt: string | null;
};

type InboxResponse = {
    success?: boolean;
    phoneNumberId?: string;
    conversations?: Conversation[];
    selectedConversation?: Conversation | null;
    messages?: Message[];
    meta?: {
        conversations?: { hasMore?: boolean; nextCursor?: string | null };
        messages?: { hasMore?: boolean; nextCursor?: string | null };
    };
};

interface WhatsAppChatTabProps {
    whatsappSettings?: ApiSettings['whatsapp'] | null;
}

const normalizeDigits = (value: string) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('62')) return digits;
    if (digits.startsWith('0')) return `62${digits.slice(1)}`;
    if (digits.startsWith('8')) return `62${digits}`;
    return digits;
};

const formatDateTime = (value: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(date);
};

const isOutgoingMessage = (message: Message) => {
    const direction = String(message?.direction || '').toLowerCase();
    return direction.includes('out') || direction.includes('sent');
};

const getMessageDisplayText = (message: Message) => {
    const text = String(message?.text || message?.content || '').trim();
    if (text) return text;
    if (message?.mediaUrl) return '[Pesan media]';
    return '[Pesan tanpa isi]';
};

const WhatsAppChatTab: React.FC<WhatsAppChatTabProps> = ({ whatsappSettings }) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConversationId, setSelectedConversationId] = useState<string>('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const [lastSync, setLastSync] = useState<string>('');
    const [replyText, setReplyText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [messageCursor, setMessageCursor] = useState<string | null>(null);
    const [messageHasMore, setMessageHasMore] = useState(false);

    const kirimdevEnabled = String(whatsappSettings?.customGateway?.apiKey || '').trim().length > 0;
    const isKirimdevMode = whatsappSettings?.deliveryMode === 'custom';
    const isFonnteMode = whatsappSettings?.deliveryMode === 'fonnte' || whatsappSettings?.deliveryMode === 'wa';
    const canLoadChat = kirimdevEnabled && isKirimdevMode;

    const selectedConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
        [conversations, selectedConversationId],
    );

    const mergeMessages = (currentMessages: Message[], nextMessages: Message[]) => {
        const merged = [...currentMessages];
        const seen = new Set(currentMessages.map((message) => message.id).filter(Boolean));

        for (const message of nextMessages) {
            if (message.id && seen.has(message.id)) {
                continue;
            }
            if (message.id) {
                seen.add(message.id);
            }
            merged.push(message);
        }

        merged.sort((a, b) => {
            const aTime = new Date(a.createdAt || 0).getTime();
            const bTime = new Date(b.createdAt || 0).getTime();
            return aTime - bTime;
        });

        return merged;
    };

    const loadInbox = async (
        preferredConversationId?: string,
        options: { appendMessages?: boolean; messageCursor?: string | null } = {},
    ) => {
        if (!canLoadChat) {
            setConversations([]);
            setMessages([]);
            setSelectedConversationId('');
            setMessageCursor(null);
            setMessageHasMore(false);
            return;
        }

        setError('');
        setIsLoading(true);
        try {
            const query = new URLSearchParams();
            if (preferredConversationId) query.set('conversationId', preferredConversationId);
            if (options.messageCursor) query.set('messageCursor', options.messageCursor);
            const res = await fetchWithAuth(`/api/admin/whatsapp/kirimdev/chat${query.toString() ? `?${query.toString()}` : ''}`);
            const data: InboxResponse = await res.json();
            if (!res.ok) {
                throw new Error((data as any)?.message || 'Gagal memuat chat Kirimdev.');
            }

            const nextConversations = Array.isArray(data.conversations) ? data.conversations : [];
            setConversations(nextConversations);

            const nextSelected = preferredConversationId
                || data.selectedConversation?.id
                || nextConversations[0]?.id
                || '';

            setSelectedConversationId(nextSelected);
            const nextMessages = Array.isArray(data.messages) ? data.messages : [];
            setMessages((currentMessages) => (
                options.appendMessages ? mergeMessages(currentMessages, nextMessages) : nextMessages
            ));
            setMessageCursor(data.meta?.messages?.nextCursor || null);
            setMessageHasMore(Boolean(data.meta?.messages?.hasMore));
            setLastSync(new Date().toISOString());
        } catch (err: any) {
            setError(err.message || 'Gagal memuat chat Kirimdev.');
            setConversations([]);
            setMessages([]);
            setMessageCursor(null);
            setMessageHasMore(false);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
            setIsLoadingMore(false);
        }
    };

    useEffect(() => {
        if (!canLoadChat) return;
        void loadInbox(selectedConversationId || undefined);
        const timer = setInterval(() => {
            setIsRefreshing(true);
            void loadInbox(selectedConversationId || undefined);
        }, 20000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canLoadChat]);

    useEffect(() => {
        if (!canLoadChat || !selectedConversationId) return;
        void loadInbox(selectedConversationId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedConversationId]);

    const filteredConversations = useMemo(() => {
        return [...conversations].sort((a, b) => {
            const aTime = new Date(a.updatedAt || 0).getTime();
            const bTime = new Date(b.updatedAt || 0).getTime();
            return bTime - aTime;
        });
    }, [conversations]);

    const selectedThread = useMemo(() => {
        if (!selectedConversation) return messages;
        const normalizedPhone = normalizeDigits(selectedConversation.phoneNumber);
        return messages.filter((message) => {
            if (message.conversationId && message.conversationId === selectedConversation.id) {
                return true;
            }
            const candidates = [message.from, message.to, message.contactPhone]
                .map(normalizeDigits)
                .filter(Boolean);
            return Boolean(normalizedPhone) && candidates.includes(normalizedPhone);
        });
    }, [messages, selectedConversation]);

    const handleSelectConversation = (conversationId: string) => {
        setSelectedConversationId(conversationId);
        setReplyText('');
        void loadInbox(conversationId);
    };

    const handleLoadMoreMessages = () => {
        if (!selectedConversationId || !messageHasMore || !messageCursor || isLoadingMore) {
            return;
        }

        setIsLoadingMore(true);
        void loadInbox(selectedConversationId, {
            appendMessages: true,
            messageCursor,
        });
    };

    const handleSendReply = async () => {
        if (!selectedConversation || !replyText.trim()) return;

        setIsSending(true);
        setError('');
        try {
            const res = await fetchWithAuth('/api/admin/whatsapp/kirimdev/chat/reply', {
                method: 'POST',
                body: JSON.stringify({
                    conversationId: selectedConversation.id,
                    phoneNumber: selectedConversation.phoneNumber,
                    message: replyText.trim(),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.message || 'Gagal mengirim balasan.');
            }
            setReplyText('');
            await loadInbox(selectedConversation.id);
        } catch (err: any) {
            setError(err.message || 'Gagal mengirim balasan.');
        } finally {
            setIsSending(false);
        }
    };

    if (!canLoadChat) {
        return (
            <Card title="Chat Kirimdev">
                <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-5 text-sm text-gray-600 dark:text-gray-300">
                    {isFonnteMode ? (
                        <>
                            Mode <strong>Fonnte</strong> aktif. Inbox chat di tab ini belum terhubung ke jalur Fonnte, jadi fitur percakapan tetap belum tersedia di mode Fonnte.
                        </>
                    ) : (
                        <>
                            Aktifkan mode <strong>Kirimdev</strong> dan isi <strong>API Key</strong> terlebih dahulu untuk melihat chat.
                        </>
                    )}
                </div>
            </Card>
        );
    }

    return (
        <Card title="Chat Kirimdev">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b dark:border-gray-700 pb-3 mb-4">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                    Inbox percakapan dari nomor Kirimdev aktif.
                    {lastSync && <span className="block text-xs text-gray-500 dark:text-gray-400">Sinkron terakhir: {formatDateTime(lastSync)}</span>}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setIsRefreshing(true);
                            void loadInbox(selectedConversationId || undefined);
                        }}
                        className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                        {isLoading || isRefreshing ? 'Memuat...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div className="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                    <div className="px-4 py-3 border-b dark:border-gray-700 font-medium text-gray-800 dark:text-gray-100">
                        Percakapan
                    </div>
                    <div className="max-h-[520px] overflow-y-auto divide-y dark:divide-gray-700">
                        {filteredConversations.length === 0 ? (
                            <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                                Belum ada percakapan yang terbaca dari Kirimdev.
                            </div>
                        ) : filteredConversations.map((conversation) => {
                            const active = conversation.id === selectedConversationId;
                            return (
                                <button
                                    key={conversation.id}
                                    type="button"
                                    onClick={() => handleSelectConversation(conversation.id)}
                                    className={`w-full text-left px-4 py-3 transition-colors ${active ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                                {conversation.name || conversation.phoneNumber || 'Tanpa nama'}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                {conversation.phoneNumber || '-'}
                                            </div>
                                        </div>
                                        {conversation.unreadCount > 0 && (
                                            <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                                {conversation.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                                        {conversation.lastMessage || 'Tidak ada pesan terakhir.'}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="rounded-xl border dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden flex flex-col min-h-[580px]">
                    <div className="px-4 py-3 border-b dark:border-gray-700">
                        <div className="font-medium text-gray-800 dark:text-gray-100">
                            {selectedConversation?.name || selectedConversation?.phoneNumber || 'Pilih percakapan'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            {selectedConversation?.phoneNumber || 'Belum ada percakapan dipilih'}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900/30">
                        {selectedThread.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                                Belum ada pesan untuk percakapan ini.
                            </div>
                        ) : selectedThread.map((message) => {
                            const outgoing = isOutgoingMessage(message);
                            const displayText = getMessageDisplayText(message);
                            return (
                                <div key={message.id || `${message.createdAt}-${message.text}`} className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm text-sm ${outgoing ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border dark:border-gray-700'}`}>
                                        <div className="whitespace-pre-wrap break-words">{displayText}</div>
                                        <div className={`mt-2 text-[11px] ${outgoing ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                                            {formatDateTime(message.createdAt) || 'Waktu tidak tersedia'}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {selectedConversation && messageHasMore && (
                            <div className="pt-2 flex justify-center">
                                <button
                                    type="button"
                                    onClick={handleLoadMoreMessages}
                                    disabled={isLoadingMore || !messageCursor}
                                    className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isLoadingMore ? 'Memuat...' : 'Muat 100 berikutnya'}
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="border-t dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
                        <label htmlFor="replyText" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Balas Chat
                        </label>
                        <textarea
                            id="replyText"
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            rows={3}
                            disabled={!selectedConversation}
                            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                            placeholder={selectedConversation ? 'Tulis balasan...' : 'Pilih percakapan terlebih dahulu'}
                        />
                        <div className="mt-3 flex items-center justify-between gap-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Balasan akan dikirim melalui Kirimdev.
                            </p>
                            <button
                                type="button"
                                onClick={handleSendReply}
                                disabled={!selectedConversation || !replyText.trim() || isSending}
                                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                            >
                                {isSending ? 'Mengirim...' : 'Kirim Balasan'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default WhatsAppChatTab;
