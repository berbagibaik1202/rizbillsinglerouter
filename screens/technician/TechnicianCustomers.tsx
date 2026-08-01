import React from 'react';
import Customers from '../admin/Customers';

const TechnicianCustomers: React.FC = () => {
    // Gunakan mode teknisi untuk membatasi aksi,
    // tetapi ambil list customer dari endpoint penuh seperti halaman admin.
    return <Customers userRole="technician" customersApiBaseOverride="/api" />;
};

export default TechnicianCustomers;
