import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Customer, Invoice, Package, PaymentStatus, ApiSettings, Complaint, AcsDeviceDetails, ComplaintType, PackageChange, HotspotProfile, Commission, TopupRequest, HotspotUser, ComplaintReply } from '~/types';
import ComplaintModal from '~/components/customer/ComplaintModal';
import CustomerPortalNav from '~/components/customer/CustomerPortalNav';
import CustomerHome from '~/screens/customer/CustomerHome';
import CustomerBills from '~/screens/customer/CustomerBills';
import CustomerHelp from '~/screens/customer/CustomerHelp';
import CustomerProfile from '~/screens/customer/CustomerProfile';
import CustomerAffiliate from '~/screens/customer/CustomerAffiliate';
import PPOBSections from '~/screens/customer/PPOBSections';
import CustomerVideo from '~/screens/customer/CustomerVideo';
import { fetchWithAuth } from '~/components/api';

const API_URL = '/api';

declare global {
    interface Window {
        jspdf: any;
    }
}

interface CustomerPortalProps {
  customer: Customer;
  onVideoPlayerModeChange?: (isActive: boolean) => void;
}

type CustomerTab = 'home' | 'bills' | 'ppob' | 'help' | 'profile' | 'affiliate' | 'video';

interface AffiliateData {
    balance: number;
    sellableProfiles: HotspotProfile[];
    transactions: (Commission | TopupRequest)[];
}

interface ToastType {
  message: string;
  type: 'success' | 'error' | 'info';
}

// Interface untuk WLAN config
interface WlanConfig {
  ssidPath?: string;
  associatedDevices?: any[];
}

const CustomerPortal: React.FC<CustomerPortalProps> = ({ customer, onVideoPlayerModeChange }) => {
  const [activeTab, setActiveTab] = useState<CustomerTab>('home');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [complaints, setComplaints] = useState<(Complaint & { lastActivity?: Date })[]>([]);
  const [customerPackage, setCustomerPackage] = useState<Package | null>(null);
  const [allPackages, setAllPackages] = useState<Package[]>([]);
  const [pendingChange, setPendingChange] = useState<PackageChange | null>(null);
  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isComplaintModalOpen, setIsComplaintModalOpen] = useState(false);
  const [deviceDetails, setDeviceDetails] = useState<AcsDeviceDetails | null>(null);
  const [isDeviceLoading, setIsDeviceLoading] = useState(true);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isRebooting, setIsRebooting] = useState(false);
  const [isSavingWlan, setIsSavingWlan] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [affiliateData, setAffiliateData] = useState<AffiliateData | null>(null);
  const [bonusVoucher, setBonusVoucher] = useState<HotspotUser | null>(null);
  const [toast, setToast] = useState<ToastType | null>(null);

  // Toast notification system
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchData = useCallback(async () => {
    if (!customer) return;

    if (!isRefreshing) setIsLoading(true);
    setIsDeviceLoading(true);
    setPortalError(null);
    setDeviceError(null);
    
    try {
      const results = await Promise.allSettled([
          fetchWithAuth(`${API_URL}/billing/invoices?customerId=${customer.id}`).then(res => res.json()),
          fetchWithAuth(`${API_URL}/customers/complaints?customerId=${customer.id}`).then(res => res.json()),
          fetchWithAuth(`${API_URL}/network/packages`).then(res => res.json()),
          fetchWithAuth(`${API_URL}/customers/app-settings`).then(res => res.json()),
          customer.acsSerialNumber ? fetchWithAuth(`${API_URL}/acs/customer-device?customerId=${customer.id}`).then(res => res.json()) : Promise.resolve(null),
          fetchWithAuth(`${API_URL}/customers/${customer.id}/package-change`).then(res => res.json()),
          fetchWithAuth(`${API_URL}/customers/${customer.id}/affiliate-data`).then(res => res.json()),
          fetchWithAuth(`${API_URL}/customers/my-bonus-voucher`).then(res => res.json()),
      ]);
      
      const [
        invoicesResult,
        complaintsResult,
        packagesResult,
        settingsResult,
        deviceResult,
        pendingChangeResult,
        affiliateDataResult,
        bonusVoucherResult,
      ] = results;

      let errors: string[] = [];

      // Process results
      if (invoicesResult.status === 'fulfilled' && Array.isArray(invoicesResult.value)) {
          setInvoices(invoicesResult.value.sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()));
      } else { 
        errors.push('invoices'); 
        console.error('Failed to fetch invoices:', invoicesResult.status === 'rejected' && invoicesResult.reason); 
      }

      if (complaintsResult.status === 'fulfilled' && Array.isArray(complaintsResult.value)) {
          const complaintsWithLastActivity = (complaintsResult.value as Complaint[]).map(c => {
              const lastReplyDate = c.replies && c.replies.length > 0
                  ? new Date(Math.max(...c.replies.map((r: ComplaintReply) => new Date(r.createdAt).getTime())))
                  : null;
              const submittedDate = new Date(c.dateSubmitted);
              
              const lastActivity = lastReplyDate && lastReplyDate > submittedDate ? lastReplyDate : submittedDate;
              
              return { ...c, lastActivity };
          });
          
          setComplaints(complaintsWithLastActivity.sort((a,b) => b.lastActivity.getTime() - a.lastActivity.getTime()));
      } else { 
        errors.push('complaints'); 
        console.error('Failed to fetch complaints:', complaintsResult.status === 'rejected' && complaintsResult.reason); 
      }

      if (packagesResult.status === 'fulfilled' && Array.isArray(packagesResult.value)) {
          const fetchedPackages = packagesResult.value;
          setAllPackages(fetchedPackages);
          const pkg = fetchedPackages.find(p => p.id === customer.packageId);
          setCustomerPackage(pkg || null);
      } else { 
        errors.push('packages'); 
        console.error('Failed to fetch packages:', packagesResult.status === 'rejected' && packagesResult.reason); 
      }
      
      if (settingsResult.status === 'fulfilled') {
          setSettings(settingsResult.value);
      } else { 
        errors.push('settings'); 
        console.error('Failed to fetch settings:', settingsResult.status === 'rejected' && settingsResult.reason); 
      }

      if (deviceResult.status === 'fulfilled') {
          setDeviceDetails(deviceResult.value);
      } else { 
        if (deviceResult.reason instanceof Error) {
            setDeviceError(deviceResult.reason.message);
        } else {
            setDeviceError('Gagal mengambil data perangkat.');
        }
      }

      if (pendingChangeResult.status === 'fulfilled') {
          setPendingChange(pendingChangeResult.value);
      } else { 
        errors.push('package change status'); 
        console.error('Failed to fetch pending change:', pendingChangeResult.status === 'rejected' && pendingChangeResult.reason); 
      }

      if (affiliateDataResult.status === 'fulfilled') {
          setAffiliateData(affiliateDataResult.value);
      } else { 
        errors.push('affiliate data'); 
        console.error('Failed to fetch affiliate data:', affiliateDataResult.status === 'rejected' && affiliateDataResult.reason); 
      }

      if (bonusVoucherResult.status === 'fulfilled') {
          setBonusVoucher(bonusVoucherResult.value);
      } else { 
        console.error('Failed to fetch bonus voucher:', bonusVoucherResult.status === 'rejected' && bonusVoucherResult.reason); 
      }

      if (errors.length > 0) {
          setPortalError(`Gagal memuat: ${errors.join(', ')}. Silakan refresh halaman.`);
      }

    } catch (error) {
      console.error('Error in fetchData:', error);
      setPortalError('Terjadi kesalahan saat memuat data.');
    } finally {
      setIsDeviceLoading(false);
      setIsLoading(false);
    }
  }, [customer, isRefreshing]);

  useEffect(() => {
    fetchData();
  }, [customer.id, fetchData]);

  // ✅ TAMBAHKAN fungsi handleRefreshAllData yang missing
  const handleRefreshAllData = async () => {
    setIsRefreshing(true);
    await fetchData();
    setIsRefreshing(false);
    showToast('Data berhasil diperbarui', 'success');
  };
  
const handleRefreshDeviceData = useCallback(async () => {
  if (!customer?.id) {
    setDeviceError('Customer ID tidak ditemukan');
    return;
  }

  setIsRefreshing(true);
  setDeviceError(null);

  try {
    console.log('🔄 [REAL REFRESH] Starting REAL device refresh process...');
    
    // Step 1: Clear cache dulu
    setDeviceDetails(null);
    showToast('melakukan Update data perangkat...', 'info');

    // Step 2: Gunakan endpoint debug refresh yang lebih reliable
    console.log('📡 [REAL REFRESH] Sending REAL refresh command...');
    const refreshResponse = await fetchWithAuth('/api/acs/customer-device/debug-refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerId: customer.id,
        parameters: [
          "InternetGatewayDevice.LANDevice.*.WLANConfiguration",
          "InternetGatewayDevice.LANInterfaces.WLANConfiguration"
        ]
      })
    });

    if (!refreshResponse.ok) {
      throw new Error(`Refresh command failed: ${refreshResponse.status}`);
    }

    const debugResult = await refreshResponse.json();
    console.log('🔍 [REAL REFRESH] Debug result:', debugResult);

    if (!debugResult.success) {
      throw new Error(debugResult.error || 'Refresh failed');
    }

    // Step 3: Beri feedback berdasarkan hasil debug
    if (debugResult.debug.dataUpdated) {
      showToast('Perangkat berhasil di-refresh!', 'success');
    } else {
      // ✅ PERBAIKAN: Ganti 'warning' dengan 'info'
      showToast('Perangkat tidak merespons. Mungkin offline.', 'info');
    }

    // Step 4: Tunggu lebih lama untuk memastikan data ter-update
    console.log('⏳ [REAL REFRESH] Waiting 15 seconds for data stabilization...');
    showToast('Memperbaharui data perangkat...', 'info');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Step 5: Ambil data TERBARU langsung dari device, bukan dari cache customer
    console.log('📥 [REAL REFRESH] Fetching latest data directly from device...');
    if (!customer.acsSerialNumber) {
        throw new Error("Serial number not found for this customer.");
    }
    
    const detailsResponse = await fetchWithAuth(
      `/api/acs/devices/${encodeURIComponent(customer.acsSerialNumber)}/details`
    );
    
    if (!detailsResponse.ok) {
      throw new Error(`Failed to fetch direct device data: ${detailsResponse.status}`);
    }

    const latestData = await detailsResponse.json();
    console.log('✅ [REAL REFRESH] Latest data received:', {
      wlanConfigsCount: latestData.wlanConfigs?.length,
      model: latestData.model,
      isOnline: latestData.isOnline
    });

    // Step 6: Update state dengan data terbaru
    setDeviceDetails(latestData);
    
    // ✅ PERBAIKAN: Hitung jumlah connected devices dari data yang diterima dengan type annotation
    const allAssociatedDevices = latestData.wlanConfigs?.flatMap((config: WlanConfig) => 
      config.associatedDevices || []
    ) || [];
    
    const totalConnectedDevices = allAssociatedDevices.length;
    
    // ✅ PERBAIKAN: Hitung per band dengan type annotation
    const ssid1Devices = latestData.wlanConfigs?.find((config: WlanConfig) => 
      config.ssidPath?.includes('.1.SSID')
    )?.associatedDevices || [];
    
    const ssid5Devices = latestData.wlanConfigs?.find((config: WlanConfig) => 
      config.ssidPath?.includes('.5.SSID')
    )?.associatedDevices || [];
    
    const ssid1Count = ssid1Devices.length;
    const ssid5Count = ssid5Devices.length;

    // ✅ PERBAIKAN: Tampilkan toast dengan jumlah connected devices saja
    if (totalConnectedDevices === 0) {
      showToast('Tidak ada 📱 yang terhubung', 'info');
    } else {
      showToast(` ${totalConnectedDevices} 📱 terhubung (${ssid1Count} di 2.4GHz, ${ssid5Count} di 5GHz)`, 'success');
    }
    
  } catch (error: any) {
    console.error('❌ [REAL REFRESH] Error:', error);
    const errorMessage = error.message || 'Gagal melakukan refresh perangkat';
    setDeviceError(errorMessage);
    showToast(errorMessage, 'error');
    
    // Fallback: coba ambil data current saja
    try {
      console.log('🔄 [REAL REFRESH] Fallback: getting current data...');
      const fallbackResponse = await fetchWithAuth(`/api/acs/customer-device?customerId=${customer.id}`);
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        setDeviceDetails(fallbackData);
        
        // ✅ PERBAIKAN: Juga hitung untuk fallback data dengan type annotation
        const fallbackDevices = fallbackData.wlanConfigs?.flatMap((config: WlanConfig) => 
          config.associatedDevices || []
        ) || [];
        
        const fallbackCount = fallbackDevices.length;
        if (fallbackCount > 0) {
          showToast(`Menggunakan data sebelumnya: ${fallbackCount} perangkat terhubung`, 'info');
        }
      }
    } catch (fallbackError) {
      console.error('❌ [REAL REFRESH] Fallback failed:', fallbackError);
    }
  } finally {
    setIsRefreshing(false);
  }
}, [customer, showToast]);

  const unpaidInvoices = useMemo(() => {
    return invoices.filter(inv => inv.status === PaymentStatus.Unpaid || inv.status === PaymentStatus.Overdue);
  }, [invoices]);

  const handleSaveComplaint = async (complaintData: { type: ComplaintType; description: string; photo?: File | null }) => {
    try {
        const formData = new FormData();
        formData.append('customerId', customer.id);
        formData.append('type', complaintData.type);
        formData.append('description', complaintData.description);
        if (complaintData.photo) {
            formData.append('photo', complaintData.photo);
        }
        
        await fetchWithAuth(`${API_URL}/customers/complaints`, {
            method: 'POST',
            body: formData,
        });

        await fetchData();
        setIsComplaintModalOpen(false);
        showToast('Keluhan berhasil dikirim', 'success');
        return { success: true };
    } catch (error: any) {
        showToast('Gagal mengirim keluhan', 'error');
        return { success: false, message: error.message };
    }
  };

  const handleSendReply = async (complaintId: string, replyText: string, photo?: File | null) => {
    try {
        const formData = new FormData();
        formData.append('replyText', replyText || '');
        formData.append('repliedBy', customer.name);
        if (photo) {
            formData.append('photo', photo);
        }

        const res = await fetchWithAuth(`${API_URL}/customers/complaints/${complaintId}/reply`, {
            method: 'POST',
            body: formData,
        });
        
        if (!res.ok) {
            throw new Error('Gagal mengirim balasan');
        }

        const newReply = await res.json();

        setComplaints(prevComplaints => {
            const updatedComplaint = prevComplaints.find(c => c.id === complaintId);
            if (!updatedComplaint) return prevComplaints;

            const newComplaintWithReply = {
                ...updatedComplaint,
                replies: [...(updatedComplaint.replies || []), newReply],
                lastActivity: new Date(newReply.createdAt)
            };

            const otherComplaints = prevComplaints.filter(c => c.id !== complaintId);
            return [newComplaintWithReply, ...otherComplaints]
                .sort((a, b) => (b.lastActivity?.getTime() || 0) - (a.lastActivity?.getTime() || 0));
        });

        showToast('Balasan berhasil dikirim', 'success');
        return { success: true };
    } catch (error: any) {
        showToast('Gagal mengirim balasan', 'error');
        return { success: false, message: error.message };
    }
  };

  const handleRebootDevice = async () => {
    if (!deviceDetails?.isOnline) {
        showToast("Tidak dapat reboot perangkat karena status offline", 'error');
        return;
    }
    
    if (!window.confirm('Anda yakin ingin me-reboot perangkat? Perangkat akan offline selama beberapa menit.')) return;
    
    setIsRebooting(true);
    setDeviceError(null);
    
    try {
        const res = await fetchWithAuth(`${API_URL}/acs/customer-device/reboot`, {
            method: 'POST',
            body: JSON.stringify({ customerId: customer.id }),
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.message || 'Gagal melakukan reboot');
        }

        showToast('Perintah reboot terkirim', 'success');
        
        // Update status optimistically
        if (deviceDetails) {
            setDeviceDetails({
                ...deviceDetails,
                isOnline: false
            });
        }
        
        setTimeout(fetchData, 30000);
        
    } catch (error: any) {
        console.error('Reboot device error:', error);
        setDeviceError(error.message);
        showToast(error.message || 'Gagal melakukan reboot', 'error');
    } finally {
        setIsRebooting(false);
    }
  };

  const handleSaveWlan = async (wlanFormData: { ssid: string; key: string }) => {
    if (!deviceDetails?.wlanConfigs || deviceDetails.wlanConfigs.length === 0) {
        showToast('Tidak ada konfigurasi WLAN yang ditemukan', 'error');
        return { success: false, message: 'No WLAN configs found' };
    }

    if (wlanFormData.key && wlanFormData.key.length < 8) {
        const message = 'Password Wi-Fi minimal harus 8 karakter.';
        showToast(message, 'error');
        setDeviceError(message);
        return { success: false, message: 'Password must be at least 8 characters.' };
    }
    
    setIsSavingWlan(true);
    setDeviceError(null);
    
    try {
      const response = await fetchWithAuth(`${API_URL}/acs/customer-device/update-wlan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            customerId: customer.id, 
            ssid: wlanFormData.ssid,
            key: wlanFormData.key
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Gagal mengupdate pengaturan WLAN');
      }

      const data = await response.json();
      
      if (data.success) {
        showToast('Pengaturan Wi-Fi berhasil diupdate!', 'success');
        
        // Optimistic UI Update
        setDeviceDetails(prevDetails => {
          if (!prevDetails) return null;
          return {
              ...prevDetails,
              wlanConfigs: prevDetails.wlanConfigs.map(config => ({
                  ...config,
                  ssid: wlanFormData.ssid,
                  key: wlanFormData.key,
                  associatedDevices: []
              }))
          };
        });

        // Schedule refresh setelah perubahan
        setTimeout(handleRefreshDeviceData, 8000);
        return { success: true };
      } else {
        throw new Error(data.message || 'Update WLAN gagal');
      }
      
    } catch (error: any) {
      console.error('Update WLAN error:', error);
      setDeviceError(error.message);
      showToast(error.message || 'Gagal mengupdate pengaturan Wi-Fi', 'error');
      return { success: false, message: error.message };
    } finally {
      setIsSavingWlan(false);
    }
  };

  // Toast Component
  const ToastNotification = () => {
    if (!toast) return null;

    const bgColor = {
      success: 'bg-green-500',
      error: 'bg-red-500', 
      info: 'bg-blue-500'
    }[toast.type];

    return (
      <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg text-white ${bgColor} animate-fade-in`}>
        <div className="flex items-center space-x-2">
          <span>{toast.message}</span>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (isLoading) {
        return (
          <div className="flex justify-center items-center min-h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Memuat portal...</p>
            </div>
          </div>
        );
    }
    
    if (portalError) {
        return (
          <div className="text-center p-10">
            <div className="bg-red-100 dark:bg-red-900/20 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 px-4 py-3 rounded">
              <p>{portalError}</p>
              <button 
                onClick={handleRefreshAllData}
                className="mt-3 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm"
              >
                Coba Lagi
              </button>
            </div>
          </div>
        );
    }

    switch (activeTab) {
      case 'bills':
        return <CustomerBills invoices={invoices} settings={settings} customer={customer} customerPackage={customerPackage} />;
      case 'help':
        return (
            <CustomerHelp
                complaints={complaints}
                onOpenComplaintModal={() => setIsComplaintModalOpen(true)}
                onRefresh={handleRefreshAllData}
                isRefreshing={isRefreshing}
                onSendReply={handleSendReply}
            />
        );
      case 'profile':
        return <CustomerProfile 
                    customer={customer} 
                    customerPackage={customerPackage} 
                    allPackages={allPackages}
                    pendingChange={pendingChange}
                    onUpdate={fetchData}
                />;
      case 'affiliate':
        return <CustomerAffiliate
                    customer={customer}
                    affiliateData={affiliateData}
                    onRefresh={fetchData}
                />;
      case 'ppob':
        return <PPOBSections appSettings={settings?.app} />;
      case 'video':
        return (
          <CustomerVideo
            enabled={Boolean(settings?.video?.enabled)}
            title={settings?.video?.title}
            playlistUrl={settings?.video?.playlistUrl}
            playlistText={settings?.video?.playlistText}
            posterUrl={settings?.video?.posterUrl}
            description={settings?.video?.description}
            autoplay={settings?.video?.autoplay}
            loop={settings?.video?.loop}
            controls={settings?.video?.controls}
            onPlayerModeChange={onVideoPlayerModeChange}
          />
        );

      case 'home':
      default:
        return (
          <CustomerHome
            customer={customer}
            unpaidInvoices={unpaidInvoices}
            customerPackage={customerPackage}
            deviceDetails={deviceDetails}
            isDeviceLoading={isDeviceLoading || isRefreshing}
            deviceError={deviceError}
            isRebooting={isRebooting}
            isSavingWlan={isSavingWlan}
            onRebootDevice={handleRebootDevice}
            onSaveWlan={handleSaveWlan}
            onRefreshDevice={handleRefreshDeviceData}
            onNavigateToBills={() => setActiveTab('bills')}
            bonusVoucher={bonusVoucher}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 w-full">
        <ToastNotification />
        <ComplaintModal 
            isOpen={isComplaintModalOpen}
            onClose={() => setIsComplaintModalOpen(false)}
            onSave={handleSaveComplaint}
        />
        <main className="flex-1 overflow-y-auto px-4 pb-20">
            {renderContent()}
        </main>
        <CustomerPortalNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
};

export default CustomerPortal;
