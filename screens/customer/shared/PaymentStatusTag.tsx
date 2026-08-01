
import React from 'react';
import { PaymentStatus } from '../../../types';
import Tag from '../../../components/common/Tag';

export const PaymentStatusTag: React.FC<{ status: PaymentStatus }> = ({ status }) => {
    const colorMap: { [key in PaymentStatus]: 'green' | 'red' | 'yellow' } = {
      [PaymentStatus.Paid]: 'green',
      [PaymentStatus.Overdue]: 'red',
      [PaymentStatus.Unpaid]: 'yellow',
    };
    return <Tag color={colorMap[status]}>{status}</Tag>;
};
