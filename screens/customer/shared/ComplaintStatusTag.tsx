
import React from 'react';
import { ComplaintStatus } from '../../../types';
import Tag from '../../../components/common/Tag';

export const ComplaintStatusTag: React.FC<{ status: ComplaintStatus }> = ({ status }) => {
    const colorMap: { [key in ComplaintStatus]: 'blue' | 'yellow' | 'green' } = {
      [ComplaintStatus.Pending]: 'blue',
      [ComplaintStatus.InProgress]: 'yellow',
      [ComplaintStatus.Resolved]: 'green',
    };
    return <Tag color={colorMap[status]}>{status}</Tag>;
};
