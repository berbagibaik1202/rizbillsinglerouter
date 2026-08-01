
import React, { useState, useEffect, useMemo, useCallback } from 'react';
// Fix: Import all necessary types and functions from types.ts
import { Customer, Invoice, Package, PaymentStatus, formatRupiah, ApiSettings, Complaint, ComplaintStatus, formatDateDisplay, formatBillingPeriod, formatDateTimeDisplay, AcsDeviceDetails } from '../types';
import Card from '../components/common/Card';
import Tag from '../components/common/Tag';
import ComplaintModal from '../components/customer/ComplaintModal';

const API_URL = '/api';

// Extend the window interface to include jspdf for TypeScript
declare global {
    interface Window {
        jspdf: any;
    }
}

interface CustomerPortalProps {
  customer: Customer;
}

const PaymentStatusTag: React.FC<{ status: PaymentStatus }> = ({ status }) => {
    const colorMap: { [key in PaymentStatus]: 'green' | 'red' | 'yellow' } = {
      [PaymentStatus.Paid]: 'green',
      [PaymentStatus.Overdue]: 'red',
      [PaymentStatus.Unpaid]: 'yellow',
    };
    return <Tag color={colorMap[status]}>{status}</Tag>;
};

const ComplaintStatusTag: React.FC<{ status: ComplaintStatus }> = ({ status }) => {
    const colorMap: { [key in ComplaintStatus]: 'blue' | 'yellow' | 'green' } = {
      [ComplaintStatus.Pending]: 'blue',
      [ComplaintStatus.InProgress]: 'yellow',
      [ComplaintStatus.Resolved]: 'green',
    };
    return <Tag color={colorMap[status]}>{status}</Tag>;
};

const RxPowerDisplay: React.FC<{ rxPower: string }> = ({ rxPower }) => {
    if (rxPower === 'N/A') return <span className="text-gray-400">N/A</span>;
    const powerValue = parseFloat(rxPower);
    if (isNaN(powerValue)) return <span className="text-gray-400">{rxPower}</span>;
    let colorClass = 'text-gray-800 dark:text-gray-200';
    if (powerValue > -25) colorClass = 'text-green-600 dark:text-green-400';
    else if (powerValue >= -28) colorClass = 'text-yellow-600 dark:text-yellow-400';
    else colorClass = 'text-red-600 dark:text-red-400';
    return <span className={`font-semibold ${colorClass}`}>{rxPower}</span>;
};


const CustomerPortal: React.FC<CustomerPortalProps> = ({ customer }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [customerPackage, setCustomerPackage] = useState<Package | null>(null);
  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaying, setIsPaying] = useState<string | null>(null); // To track which invoice is being processed
  const [isComplaintModalOpen, setIsComplaintModalOpen] = useState(false);

  // New state for ACS device details
  const [deviceDetails, setDeviceDetails] = useState<AcsDeviceDetails | null>(null);
  const [isDeviceLoading, setIsDeviceLoading] = useState(true);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isRebooting, setIsRebooting] = useState(false);


  // New state for WLAN editing
  const [editingWlan, setEditingWlan] = useState(false);
  const [wlanFormData, setWlanFormData] = useState({ ssid: '', key: '' });
  const [isSavingWlan, setIsSavingWlan] = useState(false);
  const [isDevicesExpanded, setIsDevicesExpanded] = useState(false);


  const fetchInvoices = useCallback(async () => {
      try {
        const invoicesRes = await fetch(`${API_URL}/billing/invoices?customerId=${customer.id}`);
        const allInvoices: Invoice[] = await invoicesRes.json();
        setInvoices(allInvoices.sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()));
      } catch (error) {
        console.error("Failed to fetch invoices:", error);
      }
  }, [customer.id]);
  
  const fetchComplaints = useCallback(async () => {
    try {
        const res = await fetch(`${API_URL}/customers/complaints?customerId=${customer.id}`);
        const allComplaints: Complaint[] = await res.json();
        setComplaints(allComplaints.sort((a,b) => new Date(b.dateSubmitted).getTime() - new Date(a.dateSubmitted).getTime()));
    } catch (error) {
        console.error("Failed to fetch complaints:", error);
    }
  }, [customer.id]);
  
  const fetchDeviceDetails = useCallback(async () => {
    if (!customer.acsSerialNumber) {
      setIsDeviceLoading(false);
      return;
    }
    setIsDeviceLoading(true);
    setDeviceError(null);
    try {
      const res = await fetch(`${API_URL}/acs/customer-device?customerId=${customer.id}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Could not load device data.");
      }
      setDeviceDetails(await res.json());
    } catch (error: any) {
      setDeviceError(error.message);
    } finally {
      setIsDeviceLoading(false);
    }
  }, [customer.id, customer.acsSerialNumber]);


  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        await Promise.all([fetchInvoices(), fetchComplaints(), fetchDeviceDetails()]);

        const packagesRes = await fetch(`${API_URL}/network/packages`);
        const allPackages: Package[] = await packagesRes.json();
        const pkg = allPackages.find(p => p.id === customer.packageId);
        setCustomerPackage(pkg || null);
        
        const settingsRes = await fetch(`${API_URL}/admin/settings`);
        setSettings(await settingsRes.json());

      } catch (error) {
        console.error("Failed to fetch customer portal data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (customer) {
      fetchData();
    }
  }, [customer, fetchInvoices, fetchComplaints, fetchDeviceDetails]);

  const unpaidInvoices = useMemo(() => {
    return invoices.filter(inv => inv.status === PaymentStatus.Unpaid || inv.status === PaymentStatus.Overdue);
  }, [invoices]);

  const handlePayNow = async (invoiceId: string) => {
    setIsPaying(invoiceId);
    try {
        const res = await fetch(`${API_URL}/billing/invoices/${invoiceId}/create-payment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                returnUrl: window.location.href,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message || 'Failed to create payment link.');
        }
        window.location.href = data.paymentUrl;
    } catch (error: any) {
        alert(`Error: ${error.message}`);
        console.error("Failed to generate payment link:", error);
    } finally {
        setIsPaying(null);
    }
  };
  
  const handleSaveComplaint = async (complaintData: { type: string; description: string }) => {
    try {
        const res = await fetch(`${API_URL}/customers/complaints`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...complaintData, customerId: customer.id }),
        });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || 'Failed to submit complaint.');
        }
        await fetchComplaints(); // Refresh list
        setIsComplaintModalOpen(false);
        return { success: true };
    } catch (error: any) {
        console.error('Failed to save complaint:', error);
        return { success: false, message: error.message };
    }
  };

  const handleRebootDevice = async () => {
    if (!window.confirm('Are you sure you want to reboot your device? It will go offline for a few minutes.')) {
        return;
    }
    setIsRebooting(true);
    setDeviceError(null);
    try {
        const res = await fetch(`${API_URL}/acs/customer-device/reboot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerId: customer.id }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message || 'Failed to send reboot command.');
        }
        alert(data.message);
        // Optionally, refresh device status after a delay
        setTimeout(fetchDeviceDetails, 30000); // 30 seconds delay to allow for reboot
    } catch (error: any) {
        setDeviceError(error.message);
    } finally {
        setIsRebooting(false);
    }
  };

  const handleSaveWlan = async () => {
    if (!deviceDetails || !deviceDetails.wlanConfigs || deviceDetails.wlanConfigs.length === 0) return;

    setIsSavingWlan(true);
    setDeviceError(null);
    try {
      const wlanConfig = deviceDetails.wlanConfigs[0];
      const parameters = [
        { path: wlanConfig.ssidPath, value: wlanFormData.ssid },
        { path: wlanConfig.keyPath, value: wlanFormData.key },
      ];
      
      const res = await fetch(`${API_URL}/acs/customer-device/update-wlan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id, parameters }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save Wi-Fi settings.');
      
      alert(data.message + ' It may take a moment for the device to apply the changes.');
      setEditingWlan(false);
      setTimeout(fetchDeviceDetails, 5000);

    } catch (error: any) {
      setDeviceError(error.message);
    } finally {
      setIsSavingWlan(false);
    }
  };
  
  const handleDownloadPdf = (invoiceToDownload: Invoice) => {
      if (!customer || !settings) {
          alert('Cannot generate PDF: Customer or settings data is missing.');
          return;
      }

      const taxRate = settings?.billing?.taxRate || 0;
      const totalAmount = invoiceToDownload.amount;
      const subtotal = taxRate > 0 ? totalAmount / (1 + taxRate / 100) : totalAmount;
      const taxAmount = totalAmount - subtotal;

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 15;

      // --- Header ---
      doc.setFillColor(30, 64, 175); // blue-800
      doc.rect(0, 0, pageW, 40, 'F');
      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.setTextColor(255, 255, 255);
      doc.text("INVOICE", margin, 25);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("ISP Billing Pro", pageW - margin, 15, { align: 'right' });
      doc.text("Jl. Internet Cepat No. 1, Jakarta", pageW - margin, 21, { align: 'right' });
      doc.text("support@ispbilling.pro", pageW - margin, 27, { align: 'right' });

      // --- Billed To & Invoice Info ---
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(10);
      doc.text("BILLED TO", margin, 55);
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(customer.name, margin, 62);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(customer.address, margin, 68);
      doc.text(customer.email, margin, 74);

      const invoiceInfoY = 55;
      const invoiceInfoX = pageW - margin - 60;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(80, 80, 80);
      doc.text("Invoice Number:", invoiceInfoX, invoiceInfoY, { align: 'left' });
      doc.text("Issue Date:", invoiceInfoX, invoiceInfoY + 6, { align: 'left' });
      doc.text("Due Date:", invoiceInfoX, invoiceInfoY + 12, { align: 'left' });
      doc.text("Billing Period:", invoiceInfoX, invoiceInfoY + 18, { align: 'left' });

      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      doc.text(invoiceToDownload.id, pageW - margin, invoiceInfoY, { align: 'right' });
      doc.text(formatDateDisplay(invoiceToDownload.issueDate), pageW - margin, invoiceInfoY + 6, { align: 'right' });
      doc.text(formatDateDisplay(invoiceToDownload.dueDate), pageW - margin, invoiceInfoY + 12, { align: 'right' });
      doc.text(formatBillingPeriod(invoiceToDownload.billingPeriodStart, invoiceToDownload.billingPeriodEnd), pageW - margin, invoiceInfoY + 18, { align: 'right' });

      // --- Table ---
      const tableTopY = 95;
      doc.setFillColor(243, 244, 246); // gray-100
      doc.rect(margin, tableTopY, pageW - (margin * 2), 10, 'F');
      doc.setFont("helvetica", "bold");
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(10);
      doc.text("DESCRIPTION", margin + 2, tableTopY + 7);
      doc.text("STATUS", pageW / 2, tableTopY + 7, { align: 'center' });
      doc.text("AMOUNT", pageW - margin - 2, tableTopY + 7, { align: 'right' });

      // --- Table Content ---
      const tableContentY = tableTopY + 17;
      doc.setLineWidth(0.2);
      doc.line(margin, tableTopY + 22, pageW - margin, tableTopY + 22);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      const description = customerPackage ? `${customerPackage.name} Internet Plan (${customerPackage.speed} Mbps)` : 'Monthly Service Charge';
      doc.text(description, margin + 2, tableContentY);
      
      const status = invoiceToDownload.status;
      const statusColor = status === PaymentStatus.Paid ? [34, 197, 94] : status === PaymentStatus.Overdue ? [239, 68, 68] : [234, 179, 8];
      doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
      doc.setFont("helvetica", "bold");
      doc.text(status.toUpperCase(), pageW / 2, tableContentY, { align: 'center' });
      
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      doc.text(formatRupiah(subtotal), pageW - margin - 2, tableContentY, { align: 'right' });

      // --- Totals ---
      const totalsY = tableContentY + 20;
      doc.setFontSize(10);
      doc.text("Subtotal", pageW - margin - 40, totalsY, { align: 'left' });
      doc.text(formatRupiah(subtotal), pageW - margin - 2, totalsY, { align: 'right' });
      
      doc.text(`Tax (${taxRate}%)`, pageW - margin - 40, totalsY + 6, { align: 'left' });
      doc.text(formatRupiah(taxAmount), pageW - margin - 2, totalsY + 6, { align: 'right' });

      doc.setLineWidth(0.5);
      doc.line(pageW - margin - 50, totalsY + 10, pageW - margin, totalsY + 10);
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("TOTAL", pageW - margin - 40, totalsY + 16, { align: 'left' });
      doc.text(formatRupiah(invoiceToDownload.amount), pageW - margin - 2, totalsY + 16, { align: 'right' });

      // --- Footer ---
      const footerY = doc.internal.pageSize.getHeight() - 30;
      if (invoiceToDownload.notes) {
          doc.setFontSize(9);
          doc.setFont("helvetica", "bold");
          doc.text("Notes", margin, footerY);
          doc.setFont("helvetica", "normal");
          const splitNotes = doc.splitTextToSize(invoiceToDownload.notes, pageW - (margin * 2));
          doc.text(splitNotes, margin, footerY + 5);
      }
      
      doc.setFontSize(10);
      doc.setTextColor(150, 150, 150);
      doc.text("Thank you for choosing ISP Billing Pro.", pageW / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
      
      doc.save(`Invoice-${invoiceToDownload.id}.pdf`);
  };


  if (isLoading) {
    return (
        <div className="text-center p-10">
            <p className="text-gray-600 dark:text-gray-400">Loading your portal...</p>
        </div>
    );
  }

  return (
    <div className="space-y-6">
      <ComplaintModal 
        isOpen={isComplaintModalOpen}
        onClose={() => setIsComplaintModalOpen(false)}
        onSave={handleSaveComplaint}
      />
      <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Welcome, {customer.name}!</h2>
      
      {unpaidInvoices.length > 0 && (
         <div className="bg-yellow-100 dark:bg-yellow-900/40 border-l-4 border-yellow-500 text-yellow-700 dark:text-yellow-300 p-4 rounded-md shadow-sm" role="alert">
            <p className="font-bold">You have {unpaidInvoices.length} unpaid invoice(s).</p>
            <p>Please settle your outstanding balance to avoid service interruption.</p>
         </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-6">
            <Card title="My Profile">
                <div className="space-y-2 text-sm">
                    <p><strong>ID:</strong> {customer.id}</p>
                    <p><strong>Email:</strong> {customer.email}</p>
                    <p><strong>Phone:</strong> {customer.phone}</p>
                    <p><strong>Address:</strong> {customer.address}</p>
                </div>
            </Card>

            <Card title="My Internet Plan">
                {customerPackage ? (
                    <div className="space-y-2">
                        <h4 className="text-lg font-semibold text-blue-600 dark:text-blue-400">{customerPackage.name}</h4>
                        <p className="text-2xl font-bold">{customerPackage.speed} <span className="text-lg font-normal">Mbps</span></p>
                        <p className="text-lg font-semibold">{formatRupiah(customerPackage.price)}<span className="text-sm font-normal text-gray-500 dark:text-gray-400">/month</span></p>
                         <div className="pt-2">
                            <Tag color={customer.status === 'Active' ? 'green' : 'red'}>
                                Status: {customer.status}
                            </Tag>
                        </div>
                    </div>
                ) : (
                    <p>Package details not found.</p>
                )}
            </Card>
            
            {customer.acsSerialNumber && (
                 <Card>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">My Device</h3>
                        <button
                            onClick={fetchDeviceDetails}
                            disabled={isDeviceLoading}
                            className="p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-wait disabled:opacity-50"
                            title="Refresh device status"
                            aria-label="Refresh device status"
                        >
                            {isDeviceLoading ? (
                                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566z" clipRule="evenodd" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {isDeviceLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Refreshing device status...</p>}
                    {deviceError && <p className="text-sm text-red-500 dark:text-red-400">{deviceError}</p>}
                    {deviceDetails && (
                        <div className="space-y-4 text-sm">
                            <div className="flex items-center space-x-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${deviceDetails.isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                                <span className="font-medium">{deviceDetails.isOnline ? 'Online' : 'Offline'}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                <p className="font-semibold text-gray-600 dark:text-gray-400">Model:</p>
                                <p>{deviceDetails.model}</p>
                                <p className="font-semibold text-gray-600 dark:text-gray-400">RX Power:</p>
                                <p><RxPowerDisplay rxPower={deviceDetails.rxPower} /></p>
                            </div>
                            
                            <div className="pt-4 mt-4 border-t dark:border-gray-600 space-y-2">
                                <h4 className="font-semibold text-gray-700 dark:text-gray-300">Device Actions</h4>
                                <button
                                    onClick={handleRebootDevice}
                                    disabled={isRebooting || isDeviceLoading || !deviceDetails?.isOnline}
                                    className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors shadow-sm disabled:bg-red-400 disabled:cursor-not-allowed"
                                    title={!deviceDetails?.isOnline ? "Device must be online to reboot" : "Reboot your device"}
                                >
                                    {isRebooting ? (
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 -ml-1 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5a1 1 0 11-2 0V4a1 1 0 011-1zM5.293 5.293a1 1 0 011.414 0l.707.707A5.003 5.003 0 007 10a5 5 0 108.536-3.536l.707-.707a1 1 0 111.414 1.414l-.707.707A7.002 7.002 0 115.293 5.293z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    {isRebooting ? 'Rebooting...' : 'Reboot Device'}
                                </button>
                            </div>

                            <div className="space-y-3 pt-4 border-t dark:border-gray-600">
                                <h4 className="font-semibold text-gray-700 dark:text-gray-300">My Wi-Fi Network</h4>
                                {deviceDetails.wlanConfigs && deviceDetails.wlanConfigs.length > 0 ? (() => {
                                    const firstWlan = deviceDetails.wlanConfigs[0];
                                    const associatedDevices = firstWlan.associatedDevices || [];

                                    return (
                                    <>
                                        <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                                            {editingWlan ? (
                                                <div className="space-y-2">
                                                    <div>
                                                        <label className="text-xs font-medium">Network Name (SSID)</label>
                                                        <input type="text" value={wlanFormData.ssid} onChange={(e) => setWlanFormData(prev => ({...prev, ssid: e.target.value}))} className="w-full mt-1 p-1.5 border rounded text-sm bg-white dark:bg-gray-800 dark:border-gray-600"/>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium">Password</label>
                                                        <input type="text" value={wlanFormData.key} onChange={(e) => setWlanFormData(prev => ({...prev, key: e.target.value}))} className="w-full mt-1 p-1.5 border rounded text-sm bg-white dark:bg-gray-800 dark:border-gray-600"/>
                                                    </div>
                                                    <div className="flex items-center justify-end space-x-2 pt-1">
                                                        <button onClick={() => setEditingWlan(false)} className="text-xs px-3 py-1 rounded-md bg-gray-200 dark:bg-gray-600">Cancel</button>
                                                        <button onClick={handleSaveWlan} disabled={isSavingWlan} className="text-xs px-3 py-1 rounded-md bg-blue-600 text-white disabled:bg-blue-400">{isSavingWlan ? 'Saving...' : 'Save'}</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-[auto,1fr,auto] items-center gap-x-4">
                                                    <div className="col-span-2">
                                                        <p className="font-semibold text-gray-800 dark:text-gray-200">{firstWlan.ssid}</p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">Password: ********</p>
                                                    </div>
                                                    <button onClick={() => { setEditingWlan(true); setWlanFormData({ ssid: firstWlan.ssid, key: firstWlan.key || '' }); }} className="text-xs font-medium text-blue-600 hover:underline">Change</button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="pt-3 mt-3 border-t dark:border-gray-600">
                                            <div className="flex justify-between items-center">
                                                <h5 className="font-semibold text-gray-700 dark:text-gray-300">Connected Devices ({associatedDevices.length})</h5>
                                                <button
                                                    onClick={() => setIsDevicesExpanded(prev => !prev)}
                                                    className="p-1 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                                                    aria-expanded={isDevicesExpanded}
                                                    aria-label={isDevicesExpanded ? "Collapse device list" : "Expand device list"}
                                                >
                                                    {isDevicesExpanded ? (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                          <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                                                        </svg>
                                                      ) : (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                                        </svg>
                                                      )}
                                                </button>
                                            </div>
                                            {isDevicesExpanded && (
                                                <div className="mt-2">
                                                    {associatedDevices.length > 0 ? (
                                                        <ul className="space-y-2 max-h-48 overflow-y-auto">
                                                            {associatedDevices.map((device, i) => (
                                                                <li key={device.mac || i} className="text-xs p-2 bg-gray-100 dark:bg-gray-700 rounded">
                                                                    <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{device.hostname || 'Unknown Device'}</p>
                                                                    <p className="font-mono text-gray-500 dark:text-gray-400">{device.ip}</p>
                                                                    <p className="font-mono text-gray-500 dark:text-gray-400">{device.mac}</p>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">No devices are currently connected.</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                    );
                                })() : (
                                    <p className="text-sm text-gray-500 dark:text-gray-400">No Wi-Fi networks configured on this device.</p>
                                )}
                            </div>
                        </div>
                    )}
                    {!isDeviceLoading && !deviceDetails && !deviceError && <p className="text-sm text-gray-500 dark:text-gray-400">Device data could not be loaded.</p>}
                </Card>
            )}

            <Card title="My Complaints">
                <div className="space-y-3">
                    {complaints.length > 0 ? (
                        <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                            {complaints.slice(0, 3).map(c => (
                                <li key={c.id} className="py-2">
                                    <div className="flex justify-between items-center text-sm">
                                        <div>
                                            <p className="font-medium text-gray-800 dark:text-gray-200">{c.type}</p>
                                            {/* Fix: Use formatDateTimeDisplay to show time for complaints */}
                                            <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTimeDisplay(c.dateSubmitted)}</p>
                                        </div>
                                        <ComplaintStatusTag status={c.status} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400">You have no complaints on record.</p>
                    )}
                    <button 
                      onClick={() => setIsComplaintModalOpen(true)}
                      className="w-full bg-blue-600 text-white px-4 py-2 mt-2 rounded-md hover:bg-blue-700 text-sm font-semibold shadow-sm transition-colors">
                        Submit New Complaint
                    </button>
                </div>
            </Card>
        </div>

        <div className="md:col-span-2">
            <Card title="Billing History">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                        <tr>
                            <th scope="col" className="px-6 py-3">Invoice ID</th>
                            <th scope="col" className="px-6 py-3">Billing Period</th>
                            <th scope="col" className="px-6 py-3">Due Date</th>
                            <th scope="col" className="px-6 py-3">Amount</th>
                            <th scope="col" className="px-6 py-3">Status</th>
                            <th scope="col" className="px-6 py-3 text-right">Action</th>
                        </tr>
                        </thead>
                        <tbody>
                        {invoices.length > 0 ? invoices.map(invoice => (
                            <tr key={invoice.id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600">
                                <th scope="row" className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white">{invoice.id}</th>
                                <td className="px-6 py-4">{formatBillingPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd)}</td>
                                <td className="px-6 py-4">{formatDateDisplay(invoice.dueDate)}</td>
                                <td className="px-6 py-4 font-medium">{formatRupiah(invoice.amount)}</td>
                                <td className="px-6 py-4"><PaymentStatusTag status={invoice.status} /></td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end items-center space-x-2">
                                        {(invoice.status === PaymentStatus.Unpaid || invoice.status === PaymentStatus.Overdue) ? (
                                            <button 
                                              onClick={() => handlePayNow(invoice.id)} 
                                              disabled={isPaying === invoice.id}
                                              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-xs font-semibold shadow-sm transition-colors disabled:bg-green-400 disabled:cursor-wait">
                                                {isPaying === invoice.id ? 'Processing...' : 'Pay Now'}
                                            </button>
                                        ) : invoice.status === PaymentStatus.Paid ? (
                                             <span className="text-green-600 font-semibold">Paid</span>
                                        ) : null }
                                        <button
                                            onClick={() => handleDownloadPdf(invoice)}
                                            className="p-1.5 text-gray-500 dark:text-gray-400 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                                            title="Download PDF"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={6} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                    You have no invoices yet.
                                </td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
      </div>
    </div>
  );
};

export default CustomerPortal;