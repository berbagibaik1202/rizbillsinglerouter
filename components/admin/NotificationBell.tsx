import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getNotifications, deleteNotification, clearAllNotifications } from '~/components/api';
import { AdminNotification, formatDateTimeDisplay } from '~/types';

const NotificationBell: React.FC = () => {
    const [notifications, setNotifications] = useState<AdminNotification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const fetchNotifications = useCallback(async () => {
        try {
            const data = await getNotifications();
            setNotifications(data || []);
        } catch (error) {
            console.error("Failed to fetch notifications:", error);
        }
    }, []);

    // Use polling to fetch notifications
    useEffect(() => {
        fetchNotifications(); // Fetch on initial mount
        const intervalId = setInterval(fetchNotifications, 10000); // Poll every 10 seconds

        return () => clearInterval(intervalId);
    }, [fetchNotifications]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleBellClick = () => {
        setIsOpen(prev => !prev);
    };

    const handleDelete = async (id: number) => {
        // Optimistic update
        setNotifications(prev => prev.filter(n => n.id !== id));
        try {
            await deleteNotification(id);
        } catch (error) {
            console.error("Failed to delete notification:", error);
            // Re-fetch on error to ensure consistency
            fetchNotifications();
        }
    };

    const handleClearAll = async () => {
        // Optimistic update
        setNotifications([]);
        try {
            await clearAllNotifications();
        } catch (error) {
            console.error("Failed to clear all notifications:", error);
            // Re-fetch on error
            fetchNotifications();
        }
    };

    const getIcon = (type: AdminNotification['type']) => {
        switch (type) {
            case 'error':
                return <svg className="h-5 w-5 text-red-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>;
            case 'warning':
                return <svg className="h-5 w-5 text-yellow-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.21 3.03-1.742 3.03H4.42c-1.532 0-2.492-1.696-1.742-3.03l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1-8a1 1 0 00-1 1v3a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;
            case 'info':
            default:
                return <svg className="h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>;
        }
    };
    
    const unreadCount = notifications.length;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={handleBellClick}
                className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none relative"
                aria-label="View notifications"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 w-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-white text-xs items-center justify-center">
                            {unreadCount}
                        </span>
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white dark:bg-gray-800 rounded-md shadow-lg border dark:border-gray-700 z-50">
                    <div className="p-3 flex justify-between items-center border-b dark:border-gray-700">
                        <h3 className="font-semibold text-gray-800 dark:text-gray-200">Notifications</h3>
                        {notifications.length > 0 && (
                             <button onClick={handleClearAll} className="text-sm text-blue-500 hover:underline">Clear All</button>
                        )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                        {notifications.length > 0 ? (
                            notifications.map(notif => (
                                <div key={notif.id} className="group flex items-start p-3 hover:bg-gray-100 dark:hover:bg-gray-700">
                                    <div className="flex-shrink-0 mr-3 mt-1">
                                        {getIcon(notif.type)}
                                    </div>
                                    <div className="flex-grow">
                                        <p className="text-sm text-gray-700 dark:text-gray-300">{notif.message}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDateTimeDisplay(notif.created_at)}</p>
                                    </div>
                                    <button 
                                        onClick={() => handleDelete(notif.id)}
                                        className="ml-2 p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                        aria-label="Delete notification"
                                    >
                                        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p className="p-4 text-sm text-center text-gray-500 dark:text-gray-400">No new notifications.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
