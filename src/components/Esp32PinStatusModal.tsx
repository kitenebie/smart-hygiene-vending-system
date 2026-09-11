import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../utils/supabase';

let channelCounter = 0;

interface PinStatus {
  gpio: number;
  pin_label?: string;
  current_mode: string;
  connection_status: 'connected' | 'disconnected';
  realtime_value: string;
  updated_at: string;
}

interface PinDevice {
  id: number;
  name: string;
  image_url: string;
}

interface PinDeviceAssignment {
  gpio: number;
  device_id: number;
}

const allEsp32Pins = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39,
];

// Mirrors the active pin declarations in firmware/4peace_esp32_firmware/config.h.
const priorityPinLabels: Record<number, string> = {
  4: 'Tamper Sensor',
  13: 'S1 Relay', 14: 'S2 Relay', 18: 'S3 Relay', 19: 'S4 Relay', 23: 'S5 Relay',
  21: 'I2C SDA (LCD)', 22: 'I2C SCL (LCD)',
  25: 'Buzzer', 26: 'Coin Acceptor', 27: 'S5 Sensor',
  32: 'S3 Sensor', 33: 'S4 Sensor', 34: 'S1 Sensor', 35: 'S2 Sensor',
  36: 'Buck 1 ADC', 39: 'Buck 2 ADC',
  16: 'SIM800L RX', 17: 'SIM800L TX',
};

interface Esp32PinStatusModalProps {
  onClose: () => void;
}

export default function Esp32PinStatusModal({ onClose }: Esp32PinStatusModalProps) {
  const [rows, setRows] = useState<PinStatus[]>([]);
  const [devices, setDevices] = useState<PinDevice[]>([]);
  const [assignments, setAssignments] = useState<PinDeviceAssignment[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [openPickerGpio, setOpenPickerGpio] = useState<number | null>(null);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [createForGpio, setCreateForGpio] = useState<number | null>(null);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceImageUrl, setNewDeviceImageUrl] = useState('');
  const [formError, setFormError] = useState('');
  const [savingDevice, setSavingDevice] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [statusResult, deviceResult, assignmentResult] = await Promise.all([
        supabase.from('esp32_pin_status').select('gpio,pin_label,current_mode,connection_status,realtime_value,updated_at').eq('machine_id', 'VM001').order('gpio'),
        supabase.from('esp32_pin_devices').select('id,name,image_url').order('name'),
        supabase.from('esp32_pin_device_assignments').select('gpio,device_id').eq('machine_id', 'VM001'),
      ]);

      if (!mounted) return;
      if (!statusResult.error) setRows((statusResult.data ?? []) as PinStatus[]);
      if (!deviceResult.error) setDevices((deviceResult.data ?? []) as PinDevice[]);
      if (!assignmentResult.error) setAssignments((assignmentResult.data ?? []) as PinDeviceAssignment[]);
    };

    void load();
    channelCounter += 1;
    const channel = supabase
      .channel(`esp32-pin-status:${channelCounter}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'esp32_pin_status', filter: 'machine_id=eq.VM001' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'esp32_pin_device_assignments', filter: 'machine_id=eq.VM001' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'esp32_pin_devices' }, () => { void load(); })
      .subscribe();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      mounted = false;
      window.clearInterval(clock);
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const deviceById = useMemo(() => new Map(devices.map(device => [device.id, device])), [devices]);
  const assignmentByGpio = useMemo(() => new Map(assignments.map(assignment => [assignment.gpio, assignment.device_id])), [assignments]);
  const filteredDevices = useMemo(() => {
    const query = deviceSearch.trim().toLowerCase();
    return query ? devices.filter(device => device.name.toLowerCase().includes(query)) : devices;
  }, [deviceSearch, devices]);
  const renderedRows = useMemo(() => allEsp32Pins
    .map(gpio => {
      const status = rows.find(row => row.gpio === gpio) ?? { gpio, pin_label: '', current_mode: 'Waiting for ESP32', connection_status: 'disconnected' as const, realtime_value: '—', updated_at: '' };
      const connected = status.connection_status === 'connected' && Boolean(status.updated_at) && now - new Date(status.updated_at).getTime() < 15000;
      const priorityLabel = priorityPinLabels[gpio];
      return {
        ...status,
        connected,
        priorityLabel,
        displayLabel: status.pin_label?.trim() || priorityLabel,
        device: deviceById.get(assignmentByGpio.get(gpio) ?? -1),
      };
    })
    .sort((left, right) => Number(Boolean(right.priorityLabel)) - Number(Boolean(left.priorityLabel)) || Number(right.connected) - Number(left.connected) || left.gpio - right.gpio), [assignmentByGpio, deviceById, now, rows]);

  const selectDevice = async (gpio: number, deviceId: number) => {
    const previousAssignments = assignments;
    setAssignments(current => [...current.filter(assignment => assignment.gpio !== gpio), { gpio, device_id: deviceId }]);
    setOpenPickerGpio(null);
    const { data, error } = await supabase.rpc('assign_esp32_pin_device', { p_machine_id: 'VM001', p_gpio: gpio, p_device_id: deviceId });
    const result = data as { success?: boolean; message?: string } | null;
    if (error || !result?.success) {
      setAssignments(previousAssignments);
      setFormError(error?.message ?? result?.message ?? 'Unable to save the device assignment.');
    }
  };

  const openCreateDeviceForm = (gpio: number) => {
    setOpenPickerGpio(null);
    setCreateForGpio(gpio);
    setNewDeviceName('');
    setNewDeviceImageUrl('');
    setFormError('');
  };

  const createDevice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createForGpio === null) return;
    setSavingDevice(true);
    setFormError('');
    const { data, error } = await supabase.rpc('create_esp32_pin_device', { p_name: newDeviceName, p_image_url: newDeviceImageUrl });
    const result = data as PinDevice | PinDevice[] | null;
    const createdDevice = Array.isArray(result) ? result[0] : result;
    setSavingDevice(false);
    if (error || !createdDevice) {
      setFormError(error?.message ?? 'Unable to create the device.');
      return;
    }
    setDevices(current => [...current, createdDevice].sort((left, right) => left.name.localeCompare(right.name)));
    const gpio = createForGpio;
    setCreateForGpio(null);
    await selectDevice(gpio, createdDevice.id);
  };

  return (
    <div className="pin-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="pin-modal" role="dialog" aria-modal="true" aria-labelledby="pin-status-title" onMouseDown={event => event.stopPropagation()}>
        <header className="pin-modal-head">
          <div><h2 id="pin-status-title" className="display">ESP32 Real-Time Hardware PIN Status</h2><p>Connection probing runs only while this panel is enabled.</p></div>
          <button className="pin-modal-close" type="button" onClick={onClose} aria-label="Close ESP32 PIN status">×</button>
        </header>
        <div className="pin-table-wrap">
          <table className="pin-status-table">
            <thead><tr><th>PIN Number</th><th>Device</th><th>Current Mode</th><th>Connection Status</th><th>Real-Time Value</th><th>Actions</th></tr></thead>
            <tbody>{renderedRows.map(row => (
              <tr key={row.gpio}>
                <td><span className={`pin-number${row.priorityLabel ? ' priority' : ''}`}>D{row.gpio}{row.displayLabel ? ` - ${row.displayLabel}` : ''}</span></td>
                <td><div className="pin-device-display"><span className="pin-device-image" aria-hidden="true">{row.device?.image_url ? <img src={row.device.image_url} alt="" /> : row.device?.name.slice(0, 1).toUpperCase() ?? '—'}</span><span>{row.device?.name ?? 'No device selected'}</span></div></td>
                <td><span className="pin-mode">{row.current_mode}</span></td>
                <td>{row.connected ? <span className="pin-badge connected"><span className="pin-pulse" />Device Connected</span> : <span className="pin-badge disconnected">No Device Connected</span>}</td>
                <td className="pin-value">{row.connected ? row.realtime_value : '—'}</td>
                <td className="pin-action-cell"><div className="pin-device-picker">
                  <button className="pin-device-select" type="button" aria-expanded={openPickerGpio === row.gpio} onClick={() => { setOpenPickerGpio(openPickerGpio === row.gpio ? null : row.gpio); setDeviceSearch(''); }}>{row.device ? 'Change device' : 'Select device'} <span aria-hidden="true">⌄</span></button>
                  {openPickerGpio === row.gpio && <div className="pin-device-menu" role="dialog" aria-label={`Choose device for D${row.gpio}`}>
                    <input className="pin-device-search" type="search" autoFocus value={deviceSearch} onChange={event => setDeviceSearch(event.target.value)} placeholder="Search devices" aria-label="Search devices" />
                    <div className="pin-device-options">
                      {filteredDevices.map(device => <button key={device.id} type="button" className="pin-device-option" onClick={() => { void selectDevice(row.gpio, device.id); }}><span className="pin-device-image" aria-hidden="true">{device.image_url ? <img src={device.image_url} alt="" /> : device.name.slice(0, 1).toUpperCase()}</span>{device.name}</button>)}
                      {filteredDevices.length === 0 && <p className="pin-device-empty">No matching device.</p>}
                    </div>
                    <button type="button" className="pin-create-device" onClick={() => openCreateDeviceForm(row.gpio)}>+ Create new device</button>
                  </div>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {createForGpio !== null && <div className="pin-device-form-backdrop" role="presentation" onMouseDown={() => setCreateForGpio(null)}>
          <section className="pin-device-form-modal" role="dialog" aria-modal="true" aria-labelledby="new-device-title" onMouseDown={event => event.stopPropagation()}>
            <header><div><h3 id="new-device-title" className="display">Create device for D{createForGpio}</h3><p>Save a name and image link, then assign it to this PIN.</p></div><button type="button" className="pin-modal-close" onClick={() => setCreateForGpio(null)} aria-label="Close new device form">×</button></header>
            <form onSubmit={createDevice}>
              <label htmlFor="pin-device-name">Device name</label>
              <input id="pin-device-name" className="input" value={newDeviceName} onChange={event => setNewDeviceName(event.target.value)} maxLength={100} required />
              <label htmlFor="pin-device-image-url">Image link</label>
              <input id="pin-device-image-url" className="input" type="url" value={newDeviceImageUrl} onChange={event => setNewDeviceImageUrl(event.target.value)} placeholder="https://example.com/device.jpg" />
              {formError && <p className="pin-device-error" role="alert">{formError}</p>}
              <div className="pin-device-form-actions"><button type="button" className="btn ghost" onClick={() => setCreateForGpio(null)}>Cancel</button><button type="submit" className="btn" disabled={savingDevice}>{savingDevice ? 'Saving…' : 'Create and assign'}</button></div>
            </form>
          </section>
        </div>}
      </section>
    </div>
  );
}
