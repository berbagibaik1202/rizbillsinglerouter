import React, { useState, useRef, useEffect } from 'react';
import { AdminUser, Customer } from '../../types';
import { fetchWithAuth } from '~/components/api';

interface Message {
    sender: 'user' | 'bot';
    text: string;
}

interface ChatbotProps {
    user: AdminUser | Customer;
    role: 'admin' | 'customer';
    hideFloatingButton?: boolean;
}

// SVG Icons
const ChatIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
);

const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const SendIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
    </svg>
);


const RATE_LIMIT_REGEX = /too many requests|quota exceeded|resource_exhausted|429/i;

const appendSmile = (text: string) => {
    const trimmed = text.trim();
    return trimmed.endsWith('😊') ? trimmed : `${trimmed} 😊`;
};

const describeError = (error: any): string => {
    if (!error) return 'Terjadi kesalahan tak terduga';
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
        if (error.message) return error.message;
        if (error.error) return describeError(error.error);
    }
    return String(error);
};

const getFriendlyChatbotErrorMessage = (error: any) => {
    const message = describeError(error);
    if (RATE_LIMIT_REGEX.test(message)) {
        return 'Maaf, layanan chatbot sedang mengalami gangguan pada server kami karena kuota API habis. Silakan coba lagi nanti 😊';
    }
    const normalized = message.startsWith('Maaf') ? message : `Maaf, saya tidak dapat memproses permintaan Anda saat ini. ${message}`;
    return appendSmile(normalized);
};

const Chatbot: React.FC<ChatbotProps> = ({ user, role, hideFloatingButton = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Get user's first name
    const userName = 'name' in user ? user.name.split(' ')[0] : user.username;

    useEffect(() => {
        if (isOpen && messages.length === 0) {
            const initialMessageText = role === 'customer'
                ? `Halo ${userName}! Saya asisten AI Anda. Anda bisa meminta saya untuk me-reboot modem, memeriksa tagihan, atau mengubah pengaturan Wi-Fi Anda. Contoh: "reboot modem saya" atau "cek tagihan".`
                : `Halo ${userName}! Saya adalah asisten AI Anda. Apa yang bisa saya bantu hari ini?`;

            setMessages([
                { sender: 'bot', text: initialMessageText }
            ]);
        }
    }, [isOpen, userName, messages.length, role]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);
    
    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        const userMessage = inputValue.trim();
        if (!userMessage || isLoading) return;

        const newMessages: Message[] = [...messages, { sender: 'user', text: userMessage }];
        setMessages(newMessages);
        setInputValue('');
        setIsLoading(true);

        try {
            const res = await fetchWithAuth('/api/chatbot/chat', {
                method: 'POST',
                body: JSON.stringify({
                    message: userMessage,
                    history: newMessages.slice(-10), // Send last 10 messages for context
                    user,
                    role,
                }),
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Failed to get a response from the chatbot.');
            }

            const data = await res.json();
            setMessages(prev => [...prev, { sender: 'bot', text: data.reply }]);

        } catch (error: any) {
            const botResponse = getFriendlyChatbotErrorMessage(error);
            setMessages(prev => [...prev, { sender: 'bot', text: botResponse }]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const hasBottomNav = role === 'customer' || ((user as AdminUser).role === 'reseller');

    return (
        <>
            {/* Chat Window */}
            <div className={`fixed bottom-24 right-4 sm:right-6 md:right-8 w-[calc(100%-2rem)] sm:w-96 h-[60vh] sm:h-[70vh] max-h-[600px] bg-white dark:bg-gray-800 rounded-lg shadow-2xl flex flex-col transition-all duration-300 ease-in-out z-40 ${isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
                {/* Header */}
                <header className="flex items-center justify-between p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-t-lg">
                    <h3 className="font-bold text-gray-800 dark:text-gray-100">AI Assistant</h3>
                    <button onClick={() => setIsOpen(false)} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700">
                        <CloseIcon />
                    </button>
                </header>

                {/* Messages */}
                <div className="flex-1 p-4 overflow-y-auto space-y-4">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] px-4 py-2 rounded-xl ${msg.sender === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none'}`}>
                                <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                         <div className="flex justify-start">
                            <div className="max-w-[80%] px-4 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none">
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Form */}
                <form onSubmit={handleSend} className="p-4 border-t dark:border-gray-700">
                    <div className="flex items-center space-x-2">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder="Type your message..."
                            className="flex-1 p-2 border rounded-md bg-gray-100 dark:bg-gray-700 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !inputValue.trim()}
                            className="p-2 bg-blue-600 text-white rounded-md disabled:bg-blue-400"
                        >
                            <SendIcon />
                        </button>
                    </div>
                </form>
            </div>

            {/* Floating Action Button */}
            {!hideFloatingButton && (
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className={`fixed ${hasBottomNav ? 'bottom-20' : 'bottom-4'} right-4 sm:right-6 md:right-8 p-4 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-transform duration-300 ease-in-out z-50 ${isOpen ? 'scale-0' : 'scale-100'}`}
                    aria-label="Open chat"
                >
                    <ChatIcon />
                </button>
            )}
        </>
    );
};

// FIX: Add default export to resolve import error in App.tsx
export default Chatbot;
