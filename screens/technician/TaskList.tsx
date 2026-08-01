import React, { useState, useEffect } from 'react';
import { Customer, Complaint, ComplaintStatus } from '~/types';
import Card from '~/components/common/Card';
import Tag from '~/components/common/Tag';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api/technician';

interface Task {
    id: string;
    type: 'Installation' | 'Repair';
    status: 'Unregister' | ComplaintStatus | 'Active';
    customer: Customer;
    complaint?: Complaint;
    date: string;
}

interface TaskListProps {
    onSelectTask: (taskId: string) => void;
    technicianId: string;
}

const TaskList: React.FC<TaskListProps> = ({ onSelectTask, technicianId }) => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchTasks = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetchWithAuth(`${API_URL}/tasks?technicianId=${technicianId}`);
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.message || 'Failed to fetch tasks.');
                }
                const data: Task[] = await res.json();
                setTasks(data);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTasks();
    }, [technicianId]);

    const StatusTag: React.FC<{ status: Task['status'] }> = ({ status }) => {
        const colorMap: { [key: string]: 'red' | 'yellow' | 'blue' | 'green' } = {
            'Unregister': 'red',
            [ComplaintStatus.Pending]: 'blue',
            [ComplaintStatus.InProgress]: 'yellow',
            [ComplaintStatus.Resolved]: 'green',
        };
        const color = colorMap[status] || 'gray';
        const text = status === 'Unregister' ? 'New Installation' : status;
        return <Tag color={color}>{text}</Tag>;
    };

    if (isLoading) {
        return <div className="text-center p-10 text-gray-500 dark:text-gray-400">Loading your tasks...</div>;
    }

    if (error) {
        return <div className="p-4 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-md shadow-sm">{error}</div>;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">My Tasks Today</h1>
            {tasks.length > 0 ? (
                <div className="space-y-4">
                    {tasks.map(task => (
                        <button
                            key={task.id}
                            onClick={() => onSelectTask(task.id)}
                            className="w-full text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg"
                        >
                            <Card 
                                className="!p-0 border border-transparent transition-shadow hover:shadow-lg hover:border-blue-500"
                            >
                                <div className="p-4">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-semibold text-lg text-gray-800 dark:text-gray-100">{task.customer.name}</p>
                                            <p className="text-sm text-gray-500 dark:text-gray-400">{task.customer.address}</p>
                                        </div>
                                        <StatusTag status={task.status} />
                                    </div>
                                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                                        {task.type === 'Repair' && task.complaint ? (
                                            <p><strong>Issue:</strong> {task.complaint.type}</p>
                                        ) : (
                                            <p><strong>Task:</strong> New Customer Installation</p>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        </button>
                    ))}
                </div>
            ) : (
                <Card>
                    <p className="text-center py-10 text-gray-500 dark:text-gray-400">Kamu tidak memiliki tugas saat ini</p>
                </Card>
            )}
        </div>
    );
};

export default TaskList;
