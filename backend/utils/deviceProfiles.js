// Lightweight registry of device profiles (ONT/OLT) keyed by vendor/model pattern.
// This is the first step toward model-aware operations for ACS (ONT) and SSH (OLT).

const profiles = [
  {
    id: "zte-ont-generic",
    type: "ont",
    vendor: "ZTE",
    modelPattern: /zte|zxhn|f6xx|f6\d+/i,
    paths: {
      ssid: [
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID",
        "Device.WiFi.SSID.*.SSID",
      ],
      key: [
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase",
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase",
        "Device.WiFi.AccessPoint.*.Security.KeyPassphrase",
      ],
      pppoeUsername: [
        "InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.Username",
        "Device.PPP.Interface.*.Username",
      ],
      rxPower: [
        "InternetGatewayDevice.WANDevice.*.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
        "Device.Optical.Interface.*.OpticalSignalLevel",
      ],
    },
    quirks: ["Gunakan path IGD lebih dulu; beberapa model butuh reboot setelah ganti SSID"],
  },
  {
    id: "huawei-ont-generic",
    type: "ont",
    vendor: "Huawei",
    modelPattern: /huawei|hg8|eg8|echo/i,
    paths: {
      ssid: [
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID",
        "Device.WiFi.SSID.*.SSID",
      ],
      key: [
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey",
        "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey",
        "Device.WiFi.AccessPoint.*.Security.KeyPassphrase",
      ],
      pppoeUsername: [
        "InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.Username",
        "Device.PPP.Interface.*.Username",
      ],
      rxPower: [
        'Device.PON.Interface.*.Optical.SignalLevel', 
    'Device.Optical.Interface.*.OpticalSignalLevel',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPONConnection.1.X_HW_OpticalModule.RXPower', 
    'InternetGatewayDevice.WANDevice.1.X_HW_OptModule.1.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_ZTE-COM_WANPONInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_GponInterafceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_FH_GponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_CT-COM_GponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower', 
    'InternetGatewayDevice.X_Huawei_GPON.RXPower', 
    'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower', 
    'InternetGatewayDevice.WANDevice.1.X_CU_WANEPONInterfaceConfig.OpticalTransceiver.RXPower' 
      ],
    },
    quirks: ["Beberapa firmware mengunci PreSharedKey; KeyPassphrase lebih stabil."],
  },
  {
    id: "zte-olt-c300-c320",
    type: "olt",
    vendor: "ZTE",
    modelPattern: /c300|c320/i,
    commands: {
      registerOnt: [
        "configure terminal",
        "interface gpon-olt_{frame}/{slot}",
        "onu add {port} {ontId} sn {serial} omci ont-lineprofile-id {lineProfile} ont-srvprofile-id {srvProfile}",
      ],
      bindService: [
        "service-port {svcId} vport {port}/{ontId}/1 user-vlan {userVlan} vlan {vlan}",
      ],
      // Referensi tambahan (show / konfigurasi TCONT, GEM, service-port di interface ONU)
      showInterface: [
        "show run interface gpon-onu_{frame}/{slot}/{port}:{ontId}"
      ],
      // Best effort pattern (meniru urutan umum registrasi ZTE)
      tcontGemService: [
        "interface gpon-onu_{frame}/{slot}/{port}:{ontId}",
        "name {customerName}",
        "description {description}",
        "tcont {tcontId} profile {tcontProfile}",
        "gemport {gemport} tcont {tcontId}",
        "service-port {servicePortId} vport {vport} user-vlan {userVlan} vlan {vlan}",
        "exit",
        "pon-onu-mng gpon-onu_{frame}/{slot}/{port}:{ontId}",
        "service {serviceId} gemport {gemport} vlan {vlan}",
        "exit"
      ],
      showOnuState: [
        "show gpon onu state gpon-olt_{frame}/{slot}/{port} {ontId}"
      ],
      showOnuPower: [
        "show pon power attenuation gpon-onu_{frame}/{slot}/{port}:{ontId}"
      ],
      showOnuMac: [
        "show mac gpon onu gpon-onu_{frame}/{slot}/{port}:{ontId}"
      ],
      showOnuVersion: [
        "show gpon remote-onu equip gpon-onu_{frame}/{slot}/{port}:{ontId}"
      ],
      rebootOnu: [
        "configure terminal",
        "pon-onu",
        "pon-onu-mng gpon-onu_{frame}/{slot}/{port}:{ontId}",
        "reboot"
      ],
      shutdownOnuPort1: [
        "configure terminal",
        "pon-onu",
        "pon-onu-mng gpon-onu_{frame}/{slot}/{port}:{ontId}",
        "interface eth eth_0/1 state lock"
      ],
      diagnostics: {
        systemUptime: ["show system-group"],
        processor: ["show processor"],
        temperature: ["show temperature"],
        cardSlot: ["show card slotno {slotno}"],
        findOnuBySn: ["sho gpon onu by sn {serial}"],
        onuPower: ["sho pon power attenuation gpon-onu_{frame}/{slot}/{port}:{ontId}"],
        unregisteredOnu: ["show gpon onu uncfg"]
      },
      changeSerial: [
        "configure terminal",
        "interface gpon-onu_{frame}/{slot}/{port}:{ontId}",
        "registration-method sn {serial}"
      ],
      enableWebWanRemote: [
        "configure terminal",
        "pon-onu",
        "pon-onu-mng gpon-onu_{frame}/{slot}/{port}:{ontId}",
        "security-mng 2 ingress-type wan mode permit state enable protocol web"
      ],
      disableWebWanRemote: [
        "configure terminal",
        "pon-onu",
        "pon-onu-mng gpon-onu_{frame}/{slot}/{port}:{ontId}",
        "security-mng 2 ingress-type wan mode permit state disable protocol web"
      ],
      adminOnu: {
        disable: [
          "configure terminal",
          "interface gpon-olt_{frame}/{slot}",
          "onu deactivate {port} {ontId}"
        ],
        enable: [
          "configure terminal",
          "interface gpon-olt_{frame}/{slot}",
          "onu activate {port} {ontId}"
        ],
        delete: [
          "configure terminal",
          "interface gpon-olt_{frame}/{slot}",
          "no onu {port} {ontId}"
        ]
      }
    },
    notes: ["Sesuaikan frame/slot/port sesuai topologi; isi {svcId} unik."],
  },
  {
    id: "cdata-olt-c300-c320",
    type: "olt",
    vendor: "C-DATA",
    modelPattern: /cdata|fd16|fd12|fd160|fd120/i,
    commands: {
      registerOnt: [
        "interface gpon 0/0",
        "ont add {pon} {ontId} sn-auth {serial} omci ont-lineprofile-id {lineProfile} ont-srvprofile-id {srvProfile}",
      ],
      bindService: [
        "service-port vlan {vlan} gpon 0/0/{pon} ont {ontId} gemport 1 multi-service user-vlan {userVlan} rx-cttr {cttr}",
      ],
      ipconfig: [
        "interface gpon 0/0",
        "ont ipconfig {portId} {ontId} ip-index 0 dhcp vlan {vlan} priority 0",
      ],
      diagnostics: {
        ontInfoAll: ["show ont info all"],
        ontOptical: ["show ont optical-info {pon} {ontId}"],
        ontVersion: ["show ont version {pon} {ontId}"],
        unregisteredOnu: ["show ont unauth"],
      },
      management: {
        rebootOnt: [
          "interface gpon 0/0",
          "ont reboot {pon} {ontId}"
        ],
        deleteOnt: [
          "interface gpon 0/0",
          "ont delete {pon} {ontId}"
        ]
      }
    },
    notes: ["Placeholder {pon},{ontId},{serial},{lineProfile},{srvProfile},{vlan},{userVlan},{cttr} wajib diisi."],
  },
];

export const getDeviceProfileByModel = (model = "", typeFilter = null) => {
  const normalized = String(model || "").trim().toLowerCase();
  return profiles.find((p) => {
    if (typeFilter && p.type !== typeFilter) return false;
    return p.modelPattern.test(normalized);
  }) || null;
};

export const listDeviceProfiles = (typeFilter = null) =>
  typeFilter ? profiles.filter((p) => p.type === typeFilter) : profiles;

export default {
  getDeviceProfileByModel,
  listDeviceProfiles,
};
