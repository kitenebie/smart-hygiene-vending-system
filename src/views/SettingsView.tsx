import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { timeAgo, parseNumber } from '../utils/helpers';
import Switch from '../components/Switch';
import { useToast } from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import Esp32PinStatusModal from '../components/Esp32PinStatusModal';
import { loadReportedCoinBalance, requestCoinBalanceReset } from '../utils/coinBalance';

interface Slot { id: number; slot_code: string; product_name: string; capacity: number }
interface MachineSettings {
  id: number;
  unit_price: number;
  low_stock_threshold: number;
  coin_box_alert_pct: number;
  admin_sms_number: string;
  tamper_alarm_enabled: boolean;
  auto_reset_coin_count: boolean;
  enable_pin_connection_detection: boolean;
  device_api_key: string;
  wifi_ssid?: string | null;
  wifi_password_set: boolean;
}
interface Profile {
  id: string;
  full_name: string;
  username: string;
  phone: string;
  role: string;
  last_login: string | null;
}

export default function SettingsView() {
  const { admin, logout, updateAdminState } = useAuth();
  const { showToast } = useToast();

  // Products per slot
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotEdits, setSlotEdits] = useState<Record<number, { name: string; capacity: string }>>({});

  // Machine settings
  const [ms, setMs] = useState<MachineSettings | null>(null);
  const [unitPrice, setUnitPrice] = useState('');
  const [lowStock, setLowStock] = useState('');
  const [coinAlert, setCoinAlert] = useState('');
  const [smsNumber, setSmsNumber] = useState('');
  const [tamper, setTamper] = useState(true);
  const [autoReset, setAutoReset] = useState(false);
  const [pinConnectionDetection, setPinConnectionDetectionEnabled] = useState(false);
  const [deviceKey, setDeviceKey] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiPasswordSet, setWifiPasswordSet] = useState(false);
  const [coinBalance, setCoinBalance] = useState<number | null | undefined>();
  const [resettingCoinBalance, setResettingCoinBalance] = useState(false);

  // Profile
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profFullName, setProfFullName] = useState('');
  const [profUsername, setProfUsername] = useState('');
  const [profEmail, setProfEmail] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profPassword, setProfPassword] = useState('');

  // Settings must not be overwritten while an administrator is typing. This
  // page deliberately loads once and refreshes only after an explicit save.
  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => { void loadCoinBalance(); }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  async function loadAll() {
    await Promise.all([loadSlots(), loadSettings(), loadProfile(), loadCoinBalance()]);
  }

  async function loadCoinBalance() {
    try { setCoinBalance(await loadReportedCoinBalance()); }
    catch { setCoinBalance(undefined); }
  }

  async function resetCoinBalance() {
    if (!window.confirm('Reset the machine coin balance to ₱0? This clears inserted credit on the next machine poll.')) return;
    setResettingCoinBalance(true);
    try {
      await requestCoinBalanceReset();
      showToast('Reset sent. The machine will clear coin credit on its next idle settings poll.');
      void loadCoinBalance();
    } catch {
      showToast('Could not reset coin balance.', true);
    } finally {
      setResettingCoinBalance(false);
    }
  }

  async function loadSlots() {
    const { data } = await supabase.from('slots').select('id, slot_code, product_name, capacity').order('slot_code');
    setSlots(data ?? []);
    const edits: typeof slotEdits = {};
    (data ?? []).forEach(s => { edits[s.id] = { name: s.product_name, capacity: String(s.capacity) }; });
    setSlotEdits(edits);
  }

  async function loadSettings() {
    const { data, error } = await supabase.rpc('get_machine_settings_for_profile');
    if (error) { showToast('Could not load machine settings.', true); return; }
    if (data) {
      setMs(data);
      setUnitPrice('₱' + Number(data.unit_price).toFixed(2));
      setLowStock(data.low_stock_threshold + ' units');
      setCoinAlert(data.coin_box_alert_pct + '%');
      setSmsNumber(data.admin_sms_number ?? '');
      setTamper(!!data.tamper_alarm_enabled);
      setAutoReset(!!data.auto_reset_coin_count);
      setPinConnectionDetectionEnabled(!!data.enable_pin_connection_detection);
      setDeviceKey(data.device_api_key ?? '');
      setWifiSsid(data.wifi_ssid ?? '');
      setWifiPassword('');
      setWifiPasswordSet(!!data.wifi_password_set);
    }
  }

  async function loadProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', admin?.id ?? '').maybeSingle();
    if (data) {
      setProfile(data);
      setProfFullName(data.full_name ?? '');
      setProfUsername(data.username ?? '');
      setProfEmail(admin?.email ?? '');
      setProfPhone(data.phone ?? '');
    }
  }

  async function saveProduct(slotId: number) {
    const edit = slotEdits[slotId];
    if (!edit?.name.trim()) { showToast('Product name cannot be empty.', true); return; }
    const { error } = await supabase
      .from('slots')
      .update({ product_name: edit.name.trim(), capacity: parseInt(edit.capacity, 10) || 30 })
      .eq('id', slotId);
    if (error) { showToast('Could not save product.', true); return; }
    showToast('Product updated.');
    loadSlots();
  }

  async function saveMachineSettings() {
    if (!ms) return;
    if (wifiSsid.length > 32 || wifiPassword.length > 63) {
      showToast('Wi-Fi name must be 32 characters or fewer and password 63 or fewer.', true);
      return;
    }
    const updates: Record<string, unknown> = {
      unit_price: parseNumber(unitPrice),
      low_stock_threshold: parseNumber(lowStock),
      coin_box_alert_pct: parseNumber(coinAlert),
      admin_sms_number: smsNumber.trim(),
      tamper_alarm_enabled: tamper,
      auto_reset_coin_count: autoReset,
      enable_pin_connection_detection: pinConnectionDetection,
      device_api_key: deviceKey.trim() || ms.device_api_key,
      wifi_ssid: wifiSsid.trim() || null,
    };
    if (wifiPassword) updates.wifi_password = wifiPassword;
    const { error } = await supabase
      .from('machine_settings')
      .update(updates)
      .eq('id', ms.id);
    if (error) { showToast('Could not save settings.', true); return; }
    showToast('Machine settings saved.');
    loadSettings();
  }

  async function updatePinConnectionDetection(enabled: boolean) {
    if (!ms) return;

    const previous = pinConnectionDetection;
    setPinConnectionDetectionEnabled(enabled);
    const { error } = await supabase
      .from('machine_settings')
      .update({ enable_pin_connection_detection: enabled })
      .eq('id', ms.id);

    if (error) {
      setPinConnectionDetectionEnabled(previous);
      showToast('Could not update ESP32 PIN connection detection.', true);
      return;
    }

    setMs(current => current ? { ...current, enable_pin_connection_detection: enabled } : current);
  }

  async function saveProfile() {
    if (!profile) return;
    const updates = {
      full_name: profFullName.trim(),
      username: profUsername.trim(),
      phone: profPhone.trim(),
    };

    if (profPassword.trim()) {
      const { error } = await supabase.auth.updateUser({ password: profPassword.trim() });
      if (error) { showToast('Could not update password.', true); return; }
    }
    if (profEmail.trim() !== admin?.email) {
      const { error } = await supabase.auth.updateUser({ email: profEmail.trim() });
      if (error) { showToast('Could not update email.', true); return; }
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile.id);

    if (error) { showToast('Could not save profile.', true); return; }

    updateAdminState({
      ...profile,
      full_name: profFullName.trim(),
      username: profUsername.trim(),
      email: profEmail.trim(),
      phone: profPhone.trim(),
    });

    showToast('Profile updated.');
    setProfPassword('');
    loadProfile();
  }

  return (
    <div>
      {/* Products per slot */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title display">Products per slot</div>
            <div className="panel-title-sub">Rename what's loaded in each dispensing slot. Stock count still comes from the IR sensors.</div>
          </div>
        </div>
        <table className="slot-table">
          <thead><tr><th>Slot</th><th>Product name</th><th>Capacity</th><th></th></tr></thead>
          <tbody>
            {slots.map(s => (
              <tr key={s.id}>
                <td className="slot-id">{s.slot_code}</td>
                <td>
                  <input
                    className="input"
                    style={{ maxWidth: 260 }}
                    value={slotEdits[s.id]?.name ?? ''}
                    onChange={e => setSlotEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], name: e.target.value } }))}
                  />
                </td>
                <td>
                  <input
                    className="input mono"
                    style={{ maxWidth: 90 }}
                    value={slotEdits[s.id]?.capacity ?? ''}
                    onChange={e => setSlotEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], capacity: e.target.value } }))}
                  />
                </td>
                <td><button className="btn small" onClick={() => saveProduct(s.id)}>Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Admin profile */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title display">Admin profile</div>
            <div className="panel-title-sub">Your account information</div>
          </div>
          <button className="btn" onClick={saveProfile}>Save changes</button>
        </div>
        <div className="settings-grid">
          {([
            ['Full name', 'Shown across the dashboard', profFullName, setProfFullName, 'text'],
            ['Username', 'Used to log in', profUsername, setProfUsername, 'text'],
            ['Email', 'For account recovery and reports', profEmail, setProfEmail, 'email'],
            ['Phone', 'Contact number on file', profPhone, setProfPhone, 'text'],
            ['New password', 'Leave blank to keep current password', profPassword, setProfPassword, 'password'],
          ] as [string, string, string, (v: string) => void, string][]).map(([label, hint, val, setter, type]) => (
            <div className="field-row" key={label}>
              <div>
                <div className="field-label">{label}</div>
                <div className="field-hint">{hint}</div>
              </div>
              <input
                className="input"
                type={type}
                style={{ maxWidth: 280 }}
                value={val}
                onChange={e => setter(e.target.value)}
                placeholder={type === 'password' ? '••••••••' : undefined}
              />
            </div>
          ))}
          <div className="field-row">
            <div>
              <div className="field-label">Last login</div>
              <div className="field-hint">Most recent successful sign-in</div>
            </div>
            <div className="mono" style={{ color: 'var(--text-soft)', fontSize: 13 }}>
              {profile?.last_login ? timeAgo(profile.last_login) : '—'}
            </div>
          </div>
        </div>
        <div className="settings-foot">
          <div className="field-hint">Signed in as <span className="mono">{profile?.role ?? ''}</span></div>
          <button className="btn ghost logout-btn" onClick={logout}>Log out</button>
        </div>
      </div>

      {/* Machine settings */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title display">Machine settings</div>
            <div className="panel-title-sub">Configuration used by the firmware and dashboard</div>
          </div>
          <button className="btn" onClick={saveMachineSettings}>Save changes</button>
        </div>
        <div className="settings-grid">
          {([
            ['Unit price', 'Fixed price per dispense, all slots', unitPrice, setUnitPrice, 160],
            ['Low-stock threshold', 'Triggers SMS alert via SIM800L', lowStock, setLowStock, 160],
            ['Coin box alert level', 'Admin gets notified past this fill %', coinAlert, setCoinAlert, 160],
            ['Admin SMS number', 'Receives GSM alerts from the unit', smsNumber, setSmsNumber, 220],
          ] as [string, string, string, (v: string) => void, number][]).map(([label, hint, val, setter, width]) => (
            <div className="field-row" key={label}>
              <div>
                <div className="field-label">{label}</div>
                <div className="field-hint">{hint}</div>
              </div>
              <input className="input" style={{ maxWidth: width }} value={val} onChange={e => setter(e.target.value)} />
            </div>
          ))}

          <div className="field-row">
            <div>
              <div className="field-label">Tamper alarm (SW-420)</div>
              <div className="field-hint">Buzzer + SMS on vibration trigger</div>
            </div>
            <Switch on={tamper} onChange={setTamper} />
          </div>

          <div className="field-row">
            <div>
              <div className="field-label">Auto-reset coin count</div>
              <div className="field-hint">Resets running total after admin pickup</div>
            </div>
            <Switch on={autoReset} onChange={setAutoReset} />
          </div>

          {admin?.role === 'Administrator' && <div className="field-row">
            <div>
              <div className="field-label">Coin balance on the machine</div>
              <div className="field-hint">Zeros inserted coin credit for testing or a stuck coinslot. Last reported: {coinBalance === undefined ? 'unavailable' : coinBalance === null ? 'not reported yet' : `₱${coinBalance.toFixed(0)}`}</div>
            </div>
            <button className="btn reject" disabled={resettingCoinBalance} onClick={resetCoinBalance}>{resettingCoinBalance ? 'Sending…' : 'Reset to ₱0'}</button>
          </div>}

          <div className="field-row">
            <div>
              <div className="field-label">Enable ESP32 PIN Connection Detection</div>
              <div className="field-hint">Temporarily probes relay and buzzer connections only while this switch is on.</div>
            </div>
            <Switch on={pinConnectionDetection} onChange={updatePinConnectionDetection} />
          </div>

          <div className="field-row">
            <div>
              <div className="field-label">Device API key</div>
              <div className="field-hint">ESP32 sends this on gcash_verify / gcash_status</div>
            </div>
            <input className="input mono" style={{ maxWidth: 280 }} value={deviceKey} onChange={e => setDeviceKey(e.target.value)} />
          </div>

          <div className="field-row">
            <div>
              <div className="field-label">Machine Wi-Fi name (SSID)</div>
              <div className="field-hint">The ESP32 switches to this network after its default firmware Wi-Fi.</div>
            </div>
            <input className="input" style={{ maxWidth: 280 }} maxLength={32} placeholder="Wi-Fi name" autoComplete="off" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} />
          </div>

          <div className="field-row">
            <div>
              <div className="field-label">Machine Wi-Fi password</div>
              <div className="field-hint">Leave blank to keep the current password. The ESP32 stores it locally after download.</div>
            </div>
            <input className="input" type="password" style={{ maxWidth: 280 }} maxLength={63} placeholder={wifiPasswordSet ? 'Leave blank to keep current password' : 'Enter Wi-Fi password'} autoComplete="new-password" value={wifiPassword} onChange={e => setWifiPassword(e.target.value)} />
          </div>
        </div>
      </div>
      {pinConnectionDetection && <Esp32PinStatusModal onClose={() => { void updatePinConnectionDetection(false); }} />}
    </div>
  );
}
