
// types.ts

// Enums
export enum CustomerStatus {
  Active = 'Active',
  Suspended = 'Suspended',
  Inactive = 'Inactive',
  Unregister = 'Unregister',
}

export enum PaymentStatus {
  Paid = 'Paid',
  Unpaid = 'Unpaid',
  Overdue = 'Overdue',
}

export enum ComplaintStatus {
  Pending = 'Pending',
  InProgress = 'In Progress',
  Resolved = 'Resolved',
}

export enum ComplaintType {
    SlowConnection = 'Slow Connection',
    NoConnection = 'No Connection',
    BillingIssue = 'Billing Issue',
    Other = 'Other',
}

export enum VoucherStatus {
    New = 'new',
    Active = 'active',
    Expired = 'expired',
}


// Interfaces

export interface TopupRequest {
  id: string;
  customer_id?: string | null; // Made optional
  user_id?: string | null; // Added for resellers
  amount: number;
  status: 'pending' | 'paid' | 'failed';
  created_at: string;
  paid_at?: string;
  requester_name?: string; // Helper for UI
}

export interface Commission {
  id: number;
  voucher_id: number;
  profit_amount: number;
  status: 'pending' | 'applied';
  created_at: string;
  applied_to_invoice_id?: string;
  voucher_username?: string; // Joined from hotspot_vouchers
}

export type TechnicianPage = 'dashboard' | 'complaints' | 'map' | 'tasks' | 'customers' | 'odp' | 'odc';


export interface PackageChange {
  id: number;
  customer_id: string;
  new_package_id: number;
  status: 'pending' | 'processed' | 'cancelled';
  created_at: string;
  new_package_name?: string; // Ditambahkan untuk menampilkan nama paket
}

// New interface for replies
export interface ComplaintReply {
  id: string;
  senderType: 'admin' | 'customer';
  senderName: string; // e.g., 'admin', or the customer's name
  replyText: string;
  createdAt: string;
  photos?: string[];
}

export interface Customer {
  id: string;
  name: string;
  nik?: string | null;
  address: string;
  phone: string;
  email: string;
  packageId: number;
  status: CustomerStatus;
  location?: { lat: number; lng: number };
  odpId?: string;
  pppoeUsername?: string;
  activeDate?: string;
  nextBillingStart?: string | null;
  previousPppoeProfile?: string;
  acsSerialNumber?: string; // Field baru untuk menautkan ke perangkat ACS
  voucher_balance?: number;
  billing_type?: 'postpaid' | 'fixed'; // Tipe tagihan baru
  currentMonthInvoiceStatus?: 'Paid' | 'Unpaid' | 'Overdue' | null;
}

export type UserRole = 'admin' | 'reseller' | 'technician';

export interface AdminUser {
  id: string;
  username: string;
  role: UserRole;
  balance?: number;
  phone?: string;
}

export interface AdminNotification {
  id: number;
  type: 'error' | 'warning' | 'info';
  source: string;
  message: string;
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
}


export interface Package {
  id: number;
  name: string;
  speed: number;
  price: number;
  pppoeProfile?: string;
  useTax?: boolean;
}

export interface Invoice {
  id: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  status: PaymentStatus;
  notes: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  tripayReference?: string;
  paymentUrl?: string;
  discount_amount?: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  customerId: string | null;
  date: string;
  amount: number;
  method: string;
  sold_by_user_id?: string;
}

export interface CashMutation {
  id: string;
  date: string;
  direction: 'in' | 'out';
  category: string;
  amount: number;
  method?: string | null;
  description?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  customer_id?: string | null;
  user_id?: string | null;
  created_by?: string | null;
  source: 'system' | 'manual';
  created_at?: string | null;
  customer_name?: string | null;
  user_name?: string | null;
  created_by_name?: string | null;
}

export interface CashSummary {
  totalIn: number;
  totalOut: number;
  balance: number;
  currentMonthIn: number;
  currentMonthOut: number;
  previousMonthIn: number;
  previousMonthOut: number;
}

export interface Complaint {
  id: string;
  customerId: string;
  customerName: string;
  dateSubmitted: string;
  type: ComplaintType;
  description: string;
  status: ComplaintStatus;
  replies?: ComplaintReply[];
  assignedTo?: string; // Technician user ID
  technicianNotes?: string; // Notes from the technician
  photos?: string[]; // Array of photo URLs/filenames
}

export interface Odp {
    id: string;
    name: string;
    address: string;
    location: { lat: number; lng: number };
    parentId?: string;
    lineColor?: string;
    powerInput?: number;
    powerOutput?: number;
    totalPorts?: number;
}

export interface Odc {
    id: string;
    name: string;
    address: string;
    location: { lat: number; lng: number };
    parentId?: string;
    lineColor?: string;
    powerInput?: number;
    powerOutput?: number;
    totalPorts?: number;
}

export interface WhatsappLog {
    id: number;
    recipient_number: string;
    customer_id: string | null;
    message_body: string;
    status: 'queued' | 'sent' | 'delivered' | 'failed';
    type: string;
    error_message: string | null;
    transport?: 'baileys' | 'custom' | string | null;
    provider_message_id?: string | null;
    sent_at?: string | null;
    delivered_at?: string | null;
    created_at: string;
}

// ACS-related types
export interface AcsDevice {
  id: string; // The device's unique ID from ACS (usually Serial Number)
  serialNumber: string;
  productClass: string;
  ipAddress: string;
  pppoeUsername: string;
  rxPower: string;
  lastInform: string;
  isOnline: boolean;
  ssid1?: string;
  ssid5?: string;
  ssid1Connected?: number;
  ssid5Connected?: number;
  customerId: string | null;
  customerName: string | null;
}

export interface AcsSyncJob {
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    processed_count: number;
    total_count: number;
    progress_percent: number;
    message: string | null;
    error_message: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface AcsLiveRefreshState {
    id: string | null;
    active: boolean;
    processed_count: number;
    message: string | null;
    error_message: string | null;
    started_at: string | null;
    finished_at: string | null;
    updated_at: string | null;
}

// New types for customer-facing ACS device details
export interface AcsWlanConfig {
    ssid: string;
    ssidPath: string;
    key: string;
    keyPath: string;
    band?: '2.4' | '5' | string | null;
    associatedDevices?: {
        mac: string;
        ip: string;
        hostname: string;
        signal: string;
    }[];
}

export interface AcsDeviceDetails {
    isOnline: boolean;
    model: string;
    rxPower: string;
    wlanConfigs: AcsWlanConfig[];
}

export interface AcsDeviceFullDetails {
    general: {
        firmware: string | null;
        uptime: string | null;
        model: string | null;
        hardwareVersion: string | null;
    };
    wan: {
        type: string;
        status: string | null;
        username?: string | null;
        usernamePath?: string;
        passwordPath?: string;
        ip: string | null;
        dns: string | null;
        rxPower?: string;
    }[];
    wlan: {
        name: string;
        status: string | null;
        enabled: boolean | null;
        ssid: string | null;
        ssidPath: string;
        security: string | null;
        key: string | null;
        keyPath: string;
        associatedDevices: {
            mac: string;
            ip: string;
            hostname: string;
            signal: string;
        }[];
    }[];
    lan: {
        ip: string | null;
        subnet: string | null;
        connectedHosts: {
            ip: string;
            mac: string;
            hostname: string;
            active: boolean;
        }[];
    };
    raw?: any; // For the raw JSON view
}


// Mikrotik-related types
export interface PppoeUser {
    id: string;
    name: string;
    password?: string;
    service: string;
    profile: string;
    comment: string;
    disabled: boolean;
    active: boolean;
}

export interface PppoeProfile {
    id: string;
    name: string;
    localAddress: string;
    remoteAddressPool: string;
    rateLimit: string;
    userCount?: number;
}

export interface PppoeActiveUser {
    id: string;
    name: string;
    service: string;
    callerId: string;
    address: string;
    uptime: string;
}

export interface PppoeSyncJob {
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    processed_count: number;
    progress_percent: number;
    message: string | null;
    error_message: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface HotspotUser {
    id: string;
    name: string;
    password?: string;
    profile: string;
    comment: string;
    disabled: boolean;
    active?: boolean;
    totalUptime?: string;
}

export interface HotspotProfile {
    id: string;
    name: string;
    rateLimit: string;
    sharedUsers: number;
    userCount?: number;
    price?: number;
    sellingPrice?: number;
    duration_minutes?: number;
}

export interface HotspotVoucher {
    id: number;
    username: string;
    password: string;
    profile: string;
    duration_minutes: number;
    status: VoucherStatus;
    created_at: string;
    mikrotik_id: string;
    first_used_at: string | null;
    expires_at: string | null;
    active: boolean;
    sold_by_user_id?: string | null;
    // Fix: Add optional `uptime` and `totalUptime` properties to hold live data from the source data.
    uptime?: string | null; // Session uptime from active connection
    totalUptime?: string | null; // Total accumulated uptime from user details
    sold_by_customer_id?: string | null;
}

export interface HotspotActiveUser {
    id: string;
    user: string;
    address: string;
    uptime: string;
    bytesIn: number;
    bytesOut: number;
}

// Settings
export interface ApiSettings {
  mikrotik: {
    host: string;
    user: string;
    password?: string;
    port: number;
    remoteAccessUrl?: string;
    enableDynamicNat?: boolean;
    natInInterface?: string;
    natPublicPort?: number;
    natOntPort?: number;
  };
  tripay: {
    apiKey: string;
    privateKey: string;
    merchantCode: string;
    sandboxMode: boolean;
    enabledMethods: string[];
  };
  gemini?: {
    apiKey?: string;
    enabled?: boolean;
    model?: string;
  };
  digiflazz?: {
    username: string;
    apiKey: string;
    sandboxMode?: boolean;
  };
  billing: {
    taxRate: number;
  dueDays: number;
  fixedBillDueDays: number; // New setting for Fixed Date billing grace period
  fixedInvoiceLeadDays?: number; // Days before due to auto-generate fixed invoices
  generationDay: number;
  suspensionDays: number;
    suspensionProfileName: string;
    whatsappNotificationsEnabled: boolean;
    reminderDaysBeforeDue?: number;
    sendInvoiceOnCreate?: boolean;
    bonusVoucherProfile?: string;
    bonusVoucherPrefix?: string;
    bonusVoucherPackageIds?: number[];
  };
  app: {
    baseUrl: string;
    appName: string;
    appLogoUrl?: string;
    odpLineColor?: string;
    companyPhone?: string;
    companyAddress?: string;
    // Fix: Add missing customerIdPrefix property to the app settings type.
    customerIdPrefix?: string;
    apiKey?: string;
    timezone?: string; // New Timezone setting
  };
  video?: {
    enabled: boolean;
    title?: string;
    playlistUrl?: string;
    playlistText?: string;
    posterUrl?: string;
    description?: string;
    autoplay?: boolean;
    loop?: boolean;
    controls?: boolean;
  };
  otp: {
    enabled: boolean;
    whatsappTemplate: string;
  };
  whatsapp: {
    invoiceCreated: string;
    invoiceReminder: string;
    paymentSuccess: string;
    suspensionWarning: string;
    adminPhoneNumber: string;
    newComplaintNotification: string;
    newRegistrationNotification?: string;
    accountSuspended: string;
    accountReactivated: string;
    accountDeactivated: string;
    resellerBalanceAdded: string;
    technicianTaskAssignment: string;
    packageChanged: string;
    chatbotEnabled?: boolean;
    affiliateTopupSuccess?: string;
    broadcastGeneral?: string;
    broadcastOutage?: string;
    broadcastDelayMode?: 'flat' | 'linear' | 'step' | 'randomized';
    broadcastDelayStartMs?: number;
    broadcastDelayIncrementMs?: number;
    broadcastDelayMaxMs?: number;
    broadcastDelayStepEvery?: number;
    broadcastDelayRandomJitterMs?: number;
    standbyEnabled?: boolean;
    deliveryMode?: 'baileys' | 'custom' | 'fonnte' | 'wa';
    customGateway?: {
      apiKey?: string;
      timeoutMs?: number;
      outsideWindowTemplateName?: string;
      outsideWindowTemplateLanguage?: string;
    };
    fonnteGateway?: {
      apiKey?: string;
      countryCode?: string;
      timeoutMs?: number;
      preview?: boolean;
      typing?: boolean;
    };
  };
  email?: {
    enabled?: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
    smtpUser?: string;
    smtpPass?: string;
    fromName?: string;
    fromEmail?: string;
    createdSubject?: string;
    createdBody?: string;
    dueSubject?: string;
    dueBody?: string;
    paidSubject?: string;
    paidBody?: string;
  };
  acs: {
    apiUrl: string;
    username?: string;
    password?: string;
  };
  olt?: {
    devices: {
      id?: string;
      name: string;
      host: string;
      port?: number;
      username: string;
      password?: string;
      model?: string;
      connectionType?: 'ssh' | 'telnet' | 'snmp';
      snmpEnabled?: boolean;
      snmpHost?: string;
      snmpPort?: number;
      snmpVersion?: '1' | '2c' | '3';
      snmpCommunity?: string;
      snmpProfile?: 'auto' | 'hioso-c' | 'hioso-b' | 'hioso-gpon' | 'hioso-ha73' | 'zte-c300-c320';
      snmpTimeoutMs?: number;
      snmpRetries?: number;
      snmpV3User?: string;
      snmpV3AuthProtocol?: 'md5' | 'sha';
      snmpV3AuthKey?: string;
      snmpV3PrivProtocol?: 'des' | 'aes';
      snmpV3PrivKey?: string;
      snmpOids?: {
        name?: string;
        sn?: string;
        status?: string;
        tx?: string;
        rx?: string;
        divider?: number;
      };
      description?: string;
      location?: { lat: number; lng: number };
    }[];
  };
}

// Helper Functions

export const formatRupiah = (amount: number): string => {
    if (isNaN(amount)) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
};

/**
 * Parses a date string (expected to be a full ISO 8601 UTC string from the backend)
 * into a JavaScript Date object.
 * @param dateString The ISO datetime string from the backend.
 * @returns A Date object.
 */
const parseDbUtcString = (dateString: string): Date => {
    // The backend now sends a proper ISO string (e.g., "2024-10-28T17:00:00.000Z"),
    // which can be parsed directly by the Date constructor.
    return new Date(dateString);
};


export const formatDateDisplay = (dateString?: string | null): string => {
    if (!dateString) return 'N/A';
    try {
        const date = parseDbUtcString(dateString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
        return 'Invalid Date';
    }
};

export const formatTimeDisplay = (dateString?: string | null): string => {
    if (!dateString) return '';
    try {
        const date = parseDbUtcString(dateString);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '';
    }
};

export const formatDateTimeDisplay = (dateString?: string | null): string => {
    if (!dateString) return 'N/A';
    try {
        const date = parseDbUtcString(dateString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (e) {
        return 'Invalid Date';
    }
};

/**
 * Formats a date string by treating its components as local time, ignoring browser's timezone conversion.
 * It uses UTC getters on the date object which effectively reads the raw date/time values from the string.
 * @param dateString The ISO-like string from the database.
 * @returns A formatted local date and time string.
 */
export const formatDateTimeDisplayFixed = (dateString?: string | null): string => {
    // This function now correctly inherits the timezone fix from formatDateTimeDisplay.
    return formatDateTimeDisplay(dateString);
};


export const formatBillingPeriod = (start?: string | null, end?: string | null): string => {
    if (!start || !end) return 'N/A';
    return `${formatDateDisplay(start)} - ${formatDateDisplay(end)}`;
};

export const formatDuration = (minutes: number): string => {
    if (isNaN(minutes) || minutes < 0) return 'N/A';
    if (minutes === 0) return '0 minutes';

    const MINS_IN_DAY = 24 * 60;
    const MINS_IN_HOUR = 60;

    const days = Math.floor(minutes / MINS_IN_DAY);
    const remainingMinutesAfterDays = minutes % MINS_IN_DAY;
    const hours = Math.floor(remainingMinutesAfterDays / MINS_IN_HOUR);
    const remainingMinutes = remainingMinutesAfterDays % MINS_IN_HOUR;

    const parts = [];
    if (days > 0) {
        parts.push(`${days} day${days > 1 ? 's' : ''}`);
    }
    if (hours > 0) {
        parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    }
    if (remainingMinutes > 0) {
        parts.push(`${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`);
    }

    if (parts.length === 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }

    return parts.join(' ');
};

export const formatBytes = (bytes: number, decimals = 2): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// --- PPOB Types ---
export interface PPOBProduct {
  id: number;
  product_name: string;
  product_code: string;
  category: string;
  brand: string;
  price: number;
  selling_price: number;
  description: string;
  is_active: boolean;
  // optional metadata, digunakan untuk pemisahan prabayar/pascabayar
  product_type?: string;
  created_at: string;
  updated_at: string;
}

export interface VideoItem {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  thumbnail?: string;
  url?: string;
  raw?: any;
}

export interface VideoSectionResponse {
    section: string;
    title: string;
    items: VideoItem[];
    pagination?: {
        page?: number | null;
        totalPages?: number | null;
        pageSize?: number | null;
        totalItems?: number | null;
        hasMore?: boolean | null;
    } | null;
    raw?: any;
}

export interface VideoVipResponse {
  title: string;
  columns: VideoSectionResponse[];
  raw?: any;
}

export interface VideoDetailResponse {
  item: VideoItem | null;
  episodes: VideoItem[];
  provider?: string;
  raw?: any;
}
