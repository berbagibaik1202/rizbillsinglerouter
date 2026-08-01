import React from 'react';

interface TagProps {
  children: React.ReactNode;
  color: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple' | 'indigo' | 'pink';
}

const colorClasses: Record<TagProps['color'], string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800/50 dark:text-yellow-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
  gray: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-300',
};

const Tag: React.FC<TagProps> = ({ children, color }) => {
  return (
    <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${colorClasses[color]}`}>
      {children}
    </span>
  );
};

export default Tag;