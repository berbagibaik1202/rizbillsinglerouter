
import React from 'react';

export const RxPowerDisplay: React.FC<{ rxPower: string }> = ({ rxPower }) => {
    if (rxPower === 'N/A') return <span className="text-gray-400">N/A</span>;
    const powerValue = parseFloat(rxPower);
    if (isNaN(powerValue)) return <span className="text-gray-400">{rxPower}</span>;
    let colorClass = 'text-gray-800 dark:text-gray-200';
    if (powerValue > -25) colorClass = 'text-green-600 dark:text-green-400';
    else if (powerValue >= -28) colorClass = 'text-yellow-600 dark:text-yellow-400';
    else colorClass = 'text-red-600 dark:text-red-400';
    return <span className={`font-semibold ${colorClass}`}>{rxPower}</span>;
};
