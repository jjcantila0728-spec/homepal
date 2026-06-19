'use client';

import { useState } from 'react';
import { useHousehold } from '@/store/household';
import { ds, money, nextDue } from '@/lib/format';
import { getMember, isAdmin } from '@/lib/selectors';
import {
  catColors,
  incCats,
  expCats,
  dayNames,
  debtMeta,
  devTypeMeta,
  deviceIcons,
  roomIcons,
} from '@/lib/constants';
import { defaultAutomations, runAutomations, fireAutomation } from '@/lib/automations';
import { apiDeakoControl } from '@/lib/integrations/deako/deakoClientApi';
import type {
  HouseholdState,
  Device,
  Light,
  Automation,
  AutomationAction,
  AutomationTrigger,
} from '@/lib/types';

// ---- shared modal chrome ----
function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold">{title}</h3>
        <button
          className="text-[var(--muted)] hover:text-[var(--fg)]"
          onClick={onClose}
          aria-label="Close"
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

interface DeviceType {
  value: Device['type'] | 'light';
  label: string;
}
const DEVICE_TYPES: DeviceType[] = (['light', 'lock', 'camera', 'sensor', 'media', 'appliance', 'climate'] as const).map(
  (t) => ({ value: t, label: devTypeMeta[t].label }),
);

const MEMBER_COLORS = ['#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];

export interface DiscoveredDevice {
  name: string;
  host: string;
  type?: string;
  model?: string;
  brand?: string;
  icon?: string;
}

export function useActions() {
  const { state, ui, update, toast, showModal, hideModal, activateScene, setUI, pushAlert } =
    useHousehold();

  const admin = () => isAdmin(state, ui.userId);
  const requireAdmin = () => {
    if (!admin()) {
      toast('Admin only', 'error');
      return false;
    }
    return true;
  };

  // ===================== SMART HOME: device control =====================
  // Push a light's state to its linked Deako device (best-effort). Reverts the
  // optimistic UI change if the hardware command fails.
  function deakoPush(uuid: string | undefined, on: boolean, brightness: number, revert: () => void) {
    if (!uuid) return;
    apiDeakoControl(uuid, on, on ? brightness : 0)
      .then((res) => {
        if (res?.error) {
          revert();
          toast('Deako: ' + res.error, 'error');
        }
      })
      .catch(() => {
        revert();
        toast('Deako device unreachable', 'error');
      });
  }

  function toggleLight(id: number) {
    let uuid: string | undefined;
    let nextOn = false;
    let bright = 0;
    update((d) => {
      const l = d.lights.find((x) => x.id === id);
      if (!l) return;
      l.on = !l.on;
      uuid = l.deakoUuid;
      nextOn = l.on;
      bright = l.brightness;
      d.alerts.unshift({ id: ++d.nid, type: 'light', msg: l.name + ' turned ' + (l.on ? 'on' : 'off'), time: 'Just now', sev: 'info', seen: false });
      toast(l.name + ' ' + (l.on ? 'on' : 'off'), l.on ? 'success' : 'info');
    });
    deakoPush(uuid, nextOn, bright, () =>
      update((d) => {
        const l = d.lights.find((x) => x.id === id);
        if (l) l.on = !nextOn;
      }),
    );
  }
  function setBrightness(id: number, value: number) {
    let uuid: string | undefined;
    let prev = value;
    let isOn = true;
    update((d) => {
      const l = d.lights.find((x) => x.id === id);
      if (l) {
        prev = l.brightness;
        l.brightness = value;
        uuid = l.deakoUuid;
        isOn = l.on;
      }
    });
    deakoPush(uuid, isOn, value, () =>
      update((d) => {
        const l = d.lights.find((x) => x.id === id);
        if (l) l.brightness = prev;
      }),
    );
  }
  function allLights(on: boolean) {
    const affected: { uuid: string; brightness: number }[] = [];
    update((d) => {
      const ls = ui.homeRoom === 'all' ? d.lights : d.lights.filter((l) => l.room === ui.homeRoom);
      ls.forEach((l) => {
        l.on = on;
        if (l.deakoUuid) affected.push({ uuid: l.deakoUuid, brightness: l.brightness });
      });
    });
    toast('All lights ' + (on ? 'on' : 'off'), on ? 'success' : 'info');
    affected.forEach((a) => deakoPush(a.uuid, on, a.brightness, () => {}));
  }
  // Link (or unlink) a HomePal light to a real Deako device. A Deako device maps
  // to at most one light, so clear any previous owner first.
  function linkDeako(lightId: number, uuid: string) {
    update((d) => {
      if (uuid) {
        for (const l of d.lights) {
          if (l.deakoUuid === uuid) {
            l.deakoUuid = undefined;
            l.source = 'manual';
          }
        }
      }
      const light = d.lights.find((x) => x.id === lightId);
      if (light) {
        light.deakoUuid = uuid || undefined;
        light.source = uuid ? 'deako' : 'manual';
      }
    });
    toast(uuid ? 'Light linked to Deako' : 'Light unlinked', 'success');
  }
  function adjTemp(delta: number) {
    update((d) => {
      if (!d.thermostat.on) return;
      d.thermostat.target = Math.max(55, Math.min(85, d.thermostat.target + delta));
    });
  }
  function toggleThermo() {
    update((d) => {
      d.thermostat.on = !d.thermostat.on;
      toast('Climate ' + (d.thermostat.on ? 'on' : 'off'), d.thermostat.on ? 'success' : 'info');
    });
  }
  function setThermoMode(mode: string) {
    update((d) => {
      d.thermostat.mode = mode;
      d.thermostat.on = true;
    });
  }
  function toggleArm() {
    if (!requireAdmin()) return;
    update((d) => {
      d.securityArmed = !d.securityArmed;
      d.alerts.unshift({ id: ++d.nid, type: 'system', msg: 'System ' + (d.securityArmed ? 'armed' : 'disarmed'), time: 'Just now', sev: d.securityArmed ? 'success' : 'warning', seen: false });
      runAutomations(d, { type: 'security', armed: d.securityArmed });
    });
  }
  function toggleLock(id: number) {
    if (!requireAdmin()) return;
    update((d) => {
      const dev = d.devices.find((x) => x.id === id);
      if (!dev) return;
      dev.status = dev.status === 'locked' ? 'unlocked' : 'locked';
      dev.icon = dev.status === 'locked' ? 'fa-lock' : 'fa-lock-open';
      d.alerts.unshift({ id: ++d.nid, type: 'door', msg: dev.name + ' ' + dev.status, time: 'Just now', sev: 'info', seen: false });
    });
  }
  function toggleSensor(id: number) {
    if (!requireAdmin()) return;
    update((d) => {
      const dev = d.devices.find((x) => x.id === id);
      if (!dev) return;
      dev.status = dev.status === 'active' ? 'inactive' : 'active';
    });
  }
  function toggleDevice(id: number) {
    const dev = state.devices.find((x) => x.id === id);
    if (!dev) return;
    if (dev.type === 'lock') return toggleLock(id);
    if (dev.type === 'sensor') return toggleSensor(id);
    update((d) => {
      const t = d.devices.find((x) => x.id === id);
      if (!t) return;
      t.status = t.status === 'off' ? 'on' : 'off';
      d.alerts.unshift({ id: ++d.nid, type: 'device', msg: t.name + ' turned ' + t.status, time: 'Just now', sev: 'info', seen: false });
      toast(t.name + ' ' + t.status, t.status === 'on' ? 'success' : 'info');
    });
  }
  function setRoom(r: string) {
    setUI({ homeRoom: r });
  }

  // ===================== Device / Room management =====================
  function openAddRoom() {
    showModal(<AddRoomModal />);
  }
  function saveRoom(name: string, icon: string) {
    if (!name.trim()) {
      toast('Enter a room name', 'error');
      return;
    }
    update((d) => {
      const id = 'room' + ++d.nid;
      d.rooms.push({ id, name: name.trim(), icon: icon || 'fa-house-chimney' });
    });
    hideModal();
    toast(name.trim() + ' added', 'success');
  }

  function openAddDevice() {
    if (state.rooms.length === 0) {
      toast('Add a room first', 'warning');
      openAddRoom();
      return;
    }
    showModal(<AddDeviceModal />);
  }
  function openManageDevice(kind: 'light' | 'device', id: number) {
    showModal(<ManageDeviceModal kind={kind} id={id} />);
  }
  function saveManage(kind: 'light' | 'device', id: number, name: string, room: string, icon: string) {
    update((d) => {
      const arr: (Light | Device)[] = kind === 'light' ? d.lights : d.devices;
      const dev = arr.find((x) => x.id === id);
      if (!dev) return;
      dev.name = name.trim() || dev.name;
      dev.room = room || dev.room;
      if (kind !== 'light' && icon) (dev as Device).icon = icon;
    });
    hideModal();
    toast('Device updated', 'success');
  }
  function removeDevice(kind: 'light' | 'device', id: number) {
    update((d) => {
      if (kind === 'light') d.lights = d.lights.filter((x) => x.id !== id);
      else d.devices = d.devices.filter((x) => x.id !== id);
    });
    hideModal();
    toast('Device removed', 'warning');
  }

  // ===================== Scenes =====================
  // delegate to store

  // ===================== Finance: transactions =====================
  function deleteTx(id: number) {
    update((d) => {
      d.transactions = d.transactions.filter((t) => t.id !== id);
    });
    toast('Transaction deleted', 'warning');
  }
  function openAddTransaction() {
    showModal(<AddTransactionModal />);
  }
  function saveTransaction(p: {
    type: 'income' | 'expense';
    cat: string;
    amount: number;
    date: string;
    memberId: number;
    note: string;
  }) {
    if (!p.amount || p.amount <= 0 || !p.date) {
      toast('Fill amount and date', 'error');
      return;
    }
    update((d) => {
      d.transactions.push({ id: ++d.nid, type: p.type, cat: p.cat, amount: p.amount, date: p.date, memberId: p.memberId, note: p.note || p.cat });
    });
    hideModal();
    toast((p.type === 'income' ? 'Income' : 'Expense') + ' of $' + p.amount.toLocaleString() + ' added', 'success');
  }

  // ===================== Finance: recurring =====================
  function payRecurring(id: number) {
    update((d) => {
      const r = d.recurring.find((x) => x.id === id);
      if (!r) return;
      const type = r.kind === 'income' ? 'income' : 'expense';
      d.transactions.push({ id: ++d.nid, type, cat: r.cat, amount: +r.amount, date: ds(), memberId: r.memberId || ui.userId, note: r.name + (type === 'expense' ? ' (bill)' : '') });
      r.next = nextDue(r.next, r.freq);
      d.alerts.unshift({ id: ++d.nid, type: 'budget', msg: r.name + ' ' + (type === 'income' ? 'received' : 'paid') + ' — ' + money(r.amount), time: 'Just now', sev: type === 'income' ? 'success' : 'info', seen: false });
      toast(r.name + ' ' + (type === 'income' ? 'posted' : 'paid') + ' · ' + money(r.amount), 'success');
    });
  }
  function deleteRecurring(id: number) {
    update((d) => {
      d.recurring = d.recurring.filter((x) => x.id !== id);
    });
    toast('Recurring item removed', 'warning');
  }
  function openAddRecurring() {
    showModal(<AddRecurringModal />);
  }
  function saveRecurring(p: {
    name: string;
    kind: 'bill' | 'income';
    cat: string;
    amount: number;
    freq: 'monthly' | 'weekly' | 'yearly';
    next: string;
    memberId: number;
    autopay: boolean;
  }) {
    if (!p.name.trim() || !p.amount || p.amount <= 0 || !p.next) {
      toast('Fill name, amount and date', 'error');
      return;
    }
    update((d) => {
      d.recurring.push({ id: ++d.nid, name: p.name.trim(), kind: p.kind, cat: p.cat, amount: p.amount, freq: p.freq, next: p.next, memberId: p.memberId, autopay: p.autopay });
    });
    hideModal();
    toast('Recurring "' + p.name.trim() + '" added', 'success');
  }

  // ===================== Finance: debts =====================
  function openAddDebt() {
    showModal(<AddDebtModal />);
  }
  function saveDebt(p: { name: string; kind: string; balance: number; apr: number; min: number; limit: number; due: string }) {
    if (!p.name.trim() || isNaN(p.balance)) {
      toast('Fill name and balance', 'error');
      return;
    }
    update((d) => {
      const debt = { id: ++d.nid, name: p.name.trim(), kind: p.kind, balance: p.balance, apr: p.apr || 0, minPayment: p.min || 0, due: p.due } as HouseholdState['debts'][number];
      if (p.kind === 'credit_card' && p.limit) debt.limit = p.limit;
      d.debts.push(debt);
    });
    hideModal();
    toast('"' + p.name.trim() + '" added', 'success');
  }
  function deleteDebt(id: number) {
    update((d) => {
      d.debts = d.debts.filter((x) => x.id !== id);
    });
    toast('Debt removed', 'warning');
  }
  function openPayDebt(id: number) {
    const debt = state.debts.find((x) => x.id === id);
    if (!debt) return;
    showModal(<PayDebtModal id={id} />);
  }
  function savePayDebt(id: number, rawAmt: number, mem: number) {
    if (!rawAmt || rawAmt <= 0) {
      toast('Enter a valid amount', 'error');
      return;
    }
    let paidOff = false;
    let paid = 0;
    let leftover = 0;
    let dname = '';
    update((d) => {
      const debt = d.debts.find((x) => x.id === id);
      if (!debt) return;
      const amt = Math.min(rawAmt, debt.balance);
      paid = amt;
      debt.balance = Math.round((debt.balance - amt) * 100) / 100;
      leftover = debt.balance;
      dname = debt.name;
      d.transactions.push({ id: ++d.nid, type: 'expense', cat: 'Debt Payment', amount: amt, date: ds(), memberId: mem, note: 'Payment: ' + debt.name });
      d.alerts.unshift({ id: ++d.nid, type: 'budget', msg: money(amt) + ' paid toward ' + debt.name, time: 'Just now', sev: 'info', seen: false });
      paidOff = debt.balance <= 0;
    });
    hideModal();
    if (paidOff) toast(dname + ' paid off! 🎉', 'success');
    else toast(money(paid) + ' paid · ' + money(leftover) + ' left', 'success');
  }

  // ===================== Finance: savings & budgets =====================
  function addToSavings(id: number) {
    showModal(<AddFundsModal id={id} />);
  }
  function saveSavings(id: number, amt: number) {
    if (!amt || amt <= 0) {
      toast('Enter a valid amount', 'error');
      return;
    }
    update((d) => {
      const s = d.savings.find((x) => x.id === id);
      if (s) s.current = Math.min(s.target, s.current + amt);
    });
    hideModal();
    toast('$' + amt + ' added', 'success');
  }
  function openAddBudget() {
    showModal(<AddBudgetModal />);
  }
  function saveBudget(cat: string, limit: number) {
    if (!cat.trim() || !limit) {
      toast('Fill all fields', 'error');
      return;
    }
    update((d) => {
      d.budgets.push({ cat: cat.trim(), limit, spent: 0 });
    });
    hideModal();
    toast('Budget added', 'success');
  }
  function openAddSavings() {
    showModal(<AddSavingsModal />);
  }
  function saveNewSavings(name: string, target: number) {
    if (!name.trim() || !target) {
      toast('Fill all fields', 'error');
      return;
    }
    update((d) => {
      d.savings.push({ id: ++d.nid, name: name.trim(), target, current: 0, icon: 'fa-piggy-bank', color: '#06B6D4' });
    });
    hideModal();
    toast('Savings goal created', 'success');
  }

  // ===================== Tasks: chores & shopping =====================
  function toggleChore(id: number) {
    update((d) => {
      const c = d.chores.find((x) => x.id === id);
      if (!c) return;
      c.done = !c.done;
      if (c.done) {
        d.chorePoints[c.assignee] = (d.chorePoints[c.assignee] || 0) + c.pts;
        d.alerts.unshift({ id: ++d.nid, type: 'chore', msg: (getMember(d, c.assignee)?.name || '') + ' completed "' + c.name + '" (+' + c.pts + ' pts)', time: 'Just now', sev: 'success', seen: false });
        toast('+' + c.pts + ' points!', 'success');
      } else {
        d.chorePoints[c.assignee] = Math.max(0, (d.chorePoints[c.assignee] || 0) - c.pts);
      }
    });
  }
  function toggleShop(id: number) {
    update((d) => {
      const s = d.shopping.find((x) => x.id === id);
      if (s) s.checked = !s.checked;
    });
  }
  function deleteShop(id: number) {
    update((d) => {
      d.shopping = d.shopping.filter((s) => s.id !== id);
    });
    toast('Item removed', 'warning');
  }
  function clearChecked() {
    update((d) => {
      d.shopping = d.shopping.filter((s) => !s.checked);
    });
    toast('Cleared', 'info');
  }
  function openAddChore() {
    showModal(<AddChoreModal />);
  }
  function saveChore(p: { name: string; who: number; day: number; pts: number }) {
    if (!p.name.trim()) {
      toast('Enter chore name', 'error');
      return;
    }
    update((d) => {
      d.chores.push({ id: ++d.nid, name: p.name.trim(), assignee: p.who, day: p.day, done: false, pts: p.pts || 10, icon: 'fa-circle-check' });
    });
    hideModal();
    toast('Chore added', 'success');
  }
  function openAddShop() {
    showModal(<AddShopModal />);
  }
  function saveShop(p: { name: string; qty: string; cat: string }) {
    if (!p.name.trim()) {
      toast('Enter item name', 'error');
      return;
    }
    update((d) => {
      d.shopping.push({ id: ++d.nid, name: p.name.trim(), qty: p.qty.trim() || '1', checked: false, addedBy: ui.userId, cat: p.cat });
    });
    hideModal();
    toast('Item added', 'success');
  }

  // ===================== Family =====================
  function openAddMember() {
    if (!requireAdmin()) return;
    showModal(<AddMemberModal />);
  }
  function saveMember(name: string, role: 'admin' | 'member', color: string) {
    if (!name.trim()) {
      toast('Enter a name', 'error');
      return;
    }
    const init = name.trim().split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
    update((d) => {
      d.members.push({ id: ++d.nid, name: name.trim(), role, status: 'home', color: color || '#10B981', init });
    });
    hideModal();
    toast(name.trim() + ' added', 'success');
  }
  function openEditMember(id: number) {
    const m = getMember(state, id);
    if (!m) return;
    if (!admin() && m.id !== ui.userId) {
      toast('Admin only', 'error');
      return;
    }
    showModal(<EditMemberModal id={id} />);
  }
  function updateMember(id: number, p: { name: string; status: string; role?: 'admin' | 'member'; color: string }) {
    if (!p.name.trim()) {
      toast('Enter a name', 'error');
      return;
    }
    update((d) => {
      const m = d.members.find((x) => x.id === id);
      if (!m) return;
      m.name = p.name.trim();
      m.init = p.name.trim().split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
      m.status = p.status;
      if (p.role) m.role = p.role;
      m.color = p.color || m.color;
      runAutomations(d, { type: 'presence' });
      toast(m.name + ' updated', 'success');
    });
    hideModal();
  }
  function removeMember(id: number) {
    if (!requireAdmin()) return;
    if (id === ui.userId) {
      toast("You can't remove yourself", 'error');
      return;
    }
    if (state.members.length <= 1) {
      toast('A household needs at least one member', 'error');
      return;
    }
    update((d) => {
      d.members = d.members.filter((m) => m.id !== id);
    });
    hideModal();
    toast('Member removed', 'warning');
  }
  function openEditFamilyName() {
    if (!requireAdmin()) return;
    showModal(<EditFamilyNameModal />);
  }
  function saveFamilyName(name: string) {
    if (!name.trim()) {
      toast('Enter a family name', 'error');
      return;
    }
    update((d) => {
      d.householdName = name.trim();
    });
    hideModal();
    toast('Family name updated', 'success');
  }

  // ===================== Schedule: events =====================
  function openAddEvent() {
    showModal(<AddEventModal />);
  }
  function saveEvent(p: { title: string; date: string; time: string; cat: string; memberId: number; desc: string }) {
    if (!p.title.trim() || !p.date || !p.time) {
      toast('Fill required fields', 'error');
      return;
    }
    update((d) => {
      d.events.push({ id: ++d.nid, title: p.title.trim(), date: p.date, time: p.time, memberId: p.memberId, cat: p.cat, desc: p.desc.trim() });
    });
    hideModal();
    toast('Event added', 'success');
  }
  function viewEvent(id: number) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return;
    showModal(<ViewEventModal id={id} />);
  }
  function deleteEvent(id: number) {
    update((d) => {
      d.events = d.events.filter((e) => e.id !== id);
    });
    hideModal();
    toast('Event deleted', 'warning');
  }

  // ===================== Automations =====================
  function openAddAutomation() {
    showModal(<AddAutomationModal />);
  }
  function saveAutomation(p: { name: string; trigger: AutomationTrigger; actions: AutomationAction[] }) {
    if (!p.name.trim()) {
      toast('Name the automation', 'error');
      return;
    }
    update((d) => {
      d.automations.push({ id: ++d.nid, name: p.name.trim(), icon: 'fa-wand-magic-sparkles', enabled: true, trigger: p.trigger, actions: p.actions, lastRun: null });
    });
    hideModal();
    toast('Automation added', 'success');
  }
  function toggleAutomation(id: number) {
    update((d) => {
      const a = d.automations.find((x) => x.id === id);
      if (a) a.enabled = !a.enabled;
    });
  }
  function deleteAutomation(id: number) {
    update((d) => {
      d.automations = d.automations.filter((a) => a.id !== id);
    });
    toast('Automation removed', 'warning');
  }
  function runAutomationNow(id: number) {
    update((d) => {
      const a = d.automations.find((x) => x.id === id);
      if (a) fireAutomation(d, a);
    });
    toast('Automation ran', 'success');
  }
  function seedDefaults() {
    update((d) => {
      d.automations = defaultAutomations(d);
      d.autoSeeded = true;
    });
    toast('Default automations added', 'success');
  }

  // ===================== Connect devices (discovery) =====================
  function openConnectDevices() {
    showModal(<ConnectDevicesModal />);
  }
  function openManualConnect() {
    showModal(<ManualConnectModal />);
  }
  function addDiscovered(dev: DiscoveredDevice) {
    update((d) => {
      const type = (dev.type as Device['type']) || 'appliance';
      const meta = devTypeMeta[type] || {};
      d.devices.push({
        id: ++d.nid,
        name: dev.name,
        room: (d.rooms[0] || { id: '' }).id,
        type,
        status: meta.status || 'on',
        icon: dev.icon || meta.icon || 'fa-plug',
        ip: dev.host,
        model: dev.model,
        brand: dev.brand,
        source: 'discovered',
      });
    });
    toast(dev.name + ' linked', 'success');
  }
  function addAllDiscovered(list: DiscoveredDevice[]) {
    list.forEach(addDiscovered);
    hideModal();
  }
  function saveManual(p: { name: string; host: string; type: Device['type']; stream?: string }) {
    if (!p.name.trim() || !p.host.trim()) {
      toast('Enter a name and host', 'error');
      return;
    }
    const meta = devTypeMeta[p.type] || {};
    update((d) => {
      const dev: Device = {
        id: ++d.nid,
        name: p.name.trim(),
        room: (d.rooms[0] || { id: '' }).id,
        type: p.type,
        status: meta.status || 'on',
        icon: meta.icon || 'fa-plug',
        ip: p.host.trim(),
        source: 'discovered',
      };
      if (p.stream && p.stream.trim()) dev.stream = p.stream.trim();
      d.devices.push(dev);
    });
    hideModal();
    toast(p.name.trim() + ' added', 'success');
  }

  // ===================== Modal components =====================
  function AddRoomModal() {
    const [name, setName] = useState('');
    const [icon, setIcon] = useState('fa-couch');
    return (
      <ModalShell title="Add Room" onClose={hideModal}>
        <div>
          <label>Room name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home Office" />
        </div>
        <div>
          <label>Icon</label>
          <select className="input" value={icon} onChange={(e) => setIcon(e.target.value)}>
            {roomIcons.map((i) => (
              <option key={i} value={i}>
                {i.replace('fa-', '').replace(/-/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveRoom(name, icon)}>
          Add Room
        </button>
      </ModalShell>
    );
  }

  function AddDeviceModal() {
    const [name, setName] = useState('');
    const [type, setType] = useState<Device['type'] | 'light'>('light');
    const [icon, setIcon] = useState('fa-lightbulb');
    const [room, setRoom] = useState(state.rooms[0]?.id ?? '');
    const [newRoom, setNewRoom] = useState('');
    const [newIcon, setNewIcon] = useState('fa-couch');
    const [brand, setBrand] = useState('');
    const [camType, setCamType] = useState('indoor');
    const [stream, setStream] = useState('');

    function changeType(t: Device['type'] | 'light') {
      setType(t);
      if (devTypeMeta[t]) setIcon(devTypeMeta[t].icon);
    }
    function save() {
      if (!name.trim()) {
        toast('Enter a device name', 'error');
        return;
      }
      let roomId = room;
      if (room === '__new') {
        if (!newRoom.trim()) {
          toast('Name the new room', 'error');
          return;
        }
      }
      update((d) => {
        if (room === '__new') {
          roomId = 'room' + ++d.nid;
          d.rooms.push({ id: roomId, name: newRoom.trim(), icon: newIcon || 'fa-house-chimney' });
        }
        if (!roomId) roomId = (d.rooms[0] || { id: '' }).id;
        if (type === 'light') {
          d.lights.push({ id: ++d.nid, name: name.trim(), room: roomId, on: false, brightness: 80 });
        } else {
          const meta = devTypeMeta[type] || {};
          const dv: Device = { id: ++d.nid, name: name.trim(), room: roomId, type, status: meta.status || 'off', icon: icon || meta.icon || 'fa-plug' };
          if (type === 'camera') {
            if (brand.trim()) dv.brand = brand.trim();
            dv.camType = camType || 'indoor';
            if (stream.trim()) dv.stream = stream.trim();
          }
          d.devices.push(dv);
        }
        d.alerts.unshift({ id: ++d.nid, type: 'device', msg: name.trim() + ' added to ' + (d.rooms.find((r) => r.id === roomId)?.name || ''), time: 'Just now', sev: 'success', seen: false });
      });
      hideModal();
      toast(name.trim() + ' added', 'success');
    }

    return (
      <ModalShell title="Add Device" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bedroom Lamp" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Type</label>
            <select className="input" value={type} onChange={(e) => changeType(e.target.value as Device['type'] | 'light')}>
              {DEVICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Icon</label>
            <select className="input" value={icon} onChange={(e) => setIcon(e.target.value)}>
              {deviceIcons.map((i) => (
                <option key={i} value={i}>
                  {i.replace('fa-', '').replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label>Room</label>
          <select className="input" value={room} onChange={(e) => setRoom(e.target.value)}>
            {state.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="__new">+ New room…</option>
          </select>
        </div>
        {room === '__new' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label>New room name</label>
              <input className="input" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder="e.g. Office" />
            </div>
            <div>
              <label>Room icon</label>
              <select className="input" value={newIcon} onChange={(e) => setNewIcon(e.target.value)}>
                {roomIcons.map((i) => (
                  <option key={i} value={i}>
                    {i.replace('fa-', '').replace(/-/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {type === 'camera' && (
          <>
            <div className="mb-3">
              <label>Brand</label>
              <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} list="cam-brands" placeholder="e.g. Ring, Nest, Arlo, ONVIF" />
              <datalist id="cam-brands">
                <option>Ring</option>
                <option>Google Nest</option>
                <option>Arlo</option>
                <option>Wyze</option>
                <option>Eufy</option>
                <option>Reolink</option>
                <option>Ubiquiti UniFi</option>
                <option>Hikvision</option>
                <option>Dahua</option>
                <option>TP-Link Tapo</option>
                <option>Blink</option>
                <option>Amcrest</option>
                <option>ONVIF / Generic</option>
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Camera type</label>
                <select className="input" value={camType} onChange={(e) => setCamType(e.target.value)}>
                  <option value="indoor">Indoor</option>
                  <option value="outdoor">Outdoor</option>
                  <option value="doorbell">Doorbell</option>
                  <option value="ptz">PTZ</option>
                  <option value="floodlight">Floodlight</option>
                </select>
              </div>
              <div>
                <label>
                  Stream URL <span className="font-normal text-[var(--muted)]">(optional)</span>
                </label>
                <input className="input" value={stream} onChange={(e) => setStream(e.target.value)} placeholder="RTSP / HLS / MJPEG" />
              </div>
            </div>
          </>
        )}
        <button className="btn btn-primary w-full" onClick={save}>
          Add Device
        </button>
      </ModalShell>
    );
  }

  function ManageDeviceModal({ kind, id }: { kind: 'light' | 'device'; id: number }) {
    const arr: (Light | Device)[] = kind === 'light' ? state.lights : state.devices;
    const dev = arr.find((x) => x.id === id);
    const [name, setName] = useState(dev?.name ?? '');
    const [room, setRoom] = useState(dev?.room ?? '');
    const [icon, setIcon] = useState((dev as Device | undefined)?.icon ?? 'fa-plug');
    if (!dev) return null;
    const asDev = dev as Device;
    return (
      <ModalShell title="Manage Device" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label>Room</label>
          <select className="input" value={room} onChange={(e) => setRoom(e.target.value)}>
            {state.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        {kind !== 'light' && (
          <div>
            <label>Icon</label>
            <select className="input" value={icon} onChange={(e) => setIcon(e.target.value)}>
              {deviceIcons.map((i) => (
                <option key={i} value={i}>
                  {i.replace('fa-', '').replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        )}
        {asDev.ip && (
          <div className="text-[11px] text-[var(--muted)]">
            <i className="fa-solid fa-wifi mr-1" />
            {asDev.ip}
            {asDev.model ? ' · ' + asDev.model : ''}
          </div>
        )}
        <div className="flex gap-3 mt-1">
          <button className="btn btn-primary flex-1" onClick={() => saveManage(kind, id, name, room, icon)}>
            Save
          </button>
          <button className="btn btn-danger flex-1" onClick={() => removeDevice(kind, id)}>
            <i className="fa-solid fa-trash-can" />
            Remove
          </button>
        </div>
      </ModalShell>
    );
  }

  function AddTransactionModal() {
    const [type, setType] = useState<'income' | 'expense'>('income');
    const [cat, setCat] = useState(incCats[0]);
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(ds());
    const [memberId, setMemberId] = useState(ui.userId);
    const [note, setNote] = useState('');
    const cats = type === 'income' ? incCats : expCats;
    function pick(t: 'income' | 'expense') {
      setType(t);
      setCat((t === 'income' ? incCats : expCats)[0]);
    }
    return (
      <ModalShell title="Add Transaction" onClose={hideModal}>
        <div>
          <label>Type</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="btn btn-sm"
              onClick={() => pick('income')}
              style={
                type === 'income'
                  ? { background: 'rgba(16,185,129,.15)', color: 'var(--accent)', border: '1px solid var(--accent)' }
                  : { background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)' }
              }
            >
              <i className="fa-solid fa-arrow-down" />
              Income
            </button>
            <button
              className="btn btn-sm"
              onClick={() => pick('expense')}
              style={
                type === 'expense'
                  ? { background: 'rgba(239,68,68,.15)', color: 'var(--red)', border: '1px solid var(--red)' }
                  : { background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)' }
              }
            >
              <i className="fa-solid fa-arrow-up" />
              Expense
            </button>
          </div>
        </div>
        <div>
          <label>Category</label>
          <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Amount ($)</label>
          <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label>Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label>Member</label>
          <select className="input" value={memberId} onChange={(e) => setMemberId(+e.target.value)}>
            {state.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Brief description" />
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveTransaction({ type, cat, amount: parseFloat(amount), date, memberId, note: note.trim() })}>
          Save
        </button>
      </ModalShell>
    );
  }

  function AddRecurringModal() {
    const [name, setName] = useState('');
    const [kind, setKind] = useState<'bill' | 'income'>('bill');
    const [cat, setCat] = useState(expCats[0]);
    const [amount, setAmount] = useState('');
    const [freq, setFreq] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');
    const [next, setNext] = useState(ds(7));
    const [memberId, setMemberId] = useState(ui.userId);
    const [autopay, setAutopay] = useState(false);
    const cats = kind === 'income' ? incCats : expCats;
    function pickKind(k: 'bill' | 'income') {
      setKind(k);
      setCat((k === 'income' ? incCats : expCats)[0]);
    }
    return (
      <ModalShell title="Add Recurring" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent, Spotify, Salary" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Type</label>
            <select className="input" value={kind} onChange={(e) => pickKind(e.target.value as 'bill' | 'income')}>
              <option value="bill">Bill / Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div>
            <label>Category</label>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Amount ($)</label>
            <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label>Frequency</label>
            <select className="input" value={freq} onChange={(e) => setFreq(e.target.value as 'monthly' | 'weekly' | 'yearly')}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Next due</label>
            <input className="input" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div>
            <label>Member</label>
            <select className="input" value={memberId} onChange={(e) => setMemberId(+e.target.value)}>
              {state.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: 0 }}>
          <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} style={{ width: 'auto' }} /> <span>Auto-pay enabled</span>
        </label>
        <button className="btn btn-primary w-full" onClick={() => saveRecurring({ name, kind, cat, amount: parseFloat(amount), freq, next, memberId, autopay })}>
          Add Recurring
        </button>
      </ModalShell>
    );
  }

  function AddDebtModal() {
    const [name, setName] = useState('');
    const [kind, setKind] = useState('credit_card');
    const [balance, setBalance] = useState('');
    const [apr, setApr] = useState('');
    const [min, setMin] = useState('');
    const [limit, setLimit] = useState('');
    const [due, setDue] = useState(ds(14));
    return (
      <ModalShell title="Add Debt" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Visa, Car Loan" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Type</label>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.keys(debtMeta).map((k) => (
                <option key={k} value={k}>
                  {debtMeta[k].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Balance ($)</label>
            <input className="input" type="number" min="0" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>APR (%)</label>
            <input className="input" type="number" min="0" step="0.01" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="19.99" />
          </div>
          <div>
            <label>Min payment ($)</label>
            <input className="input" type="number" min="0" step="0.01" value={min} onChange={(e) => setMin(e.target.value)} placeholder="50" />
          </div>
        </div>
        {kind === 'credit_card' && (
          <div>
            <label>Credit limit ($)</label>
            <input className="input" type="number" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="8000" />
          </div>
        )}
        <div>
          <label>Next due date</label>
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <button
          className="btn btn-primary w-full"
          onClick={() => saveDebt({ name, kind, balance: parseFloat(balance), apr: parseFloat(apr), min: parseFloat(min), limit: parseFloat(limit), due })}
        >
          Add Debt
        </button>
      </ModalShell>
    );
  }

  function PayDebtModal({ id }: { id: number }) {
    const debt = state.debts.find((x) => x.id === id);
    const [amt, setAmt] = useState(debt ? String(debt.minPayment) : '');
    const [mem, setMem] = useState(ui.userId);
    if (!debt) return null;
    return (
      <ModalShell title={'Pay ' + debt.name} onClose={hideModal}>
        <div className="flex justify-between text-sm">
          <span className="text-[var(--muted)]">Current balance</span>
          <span className="font-bold">{money(debt.balance)}</span>
        </div>
        <div>
          <label>Payment amount ($)</label>
          <input className="input" type="number" min="0" step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => setAmt(String(debt.minPayment))}>
            Min {money(debt.minPayment)}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAmt(String(debt.balance))}>
            Pay off {money(debt.balance)}
          </button>
        </div>
        <div>
          <label>From member</label>
          <select className="input" value={mem} onChange={(e) => setMem(+e.target.value)}>
            {state.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary w-full" onClick={() => savePayDebt(id, parseFloat(amt), mem)}>
          Make Payment
        </button>
      </ModalShell>
    );
  }

  function AddFundsModal({ id }: { id: number }) {
    const [amt, setAmt] = useState('');
    return (
      <ModalShell title="Add Funds" onClose={hideModal}>
        <div>
          <label>Amount ($)</label>
          <input className="input" type="number" min="1" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="100" />
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveSavings(id, parseFloat(amt))}>
          Add
        </button>
      </ModalShell>
    );
  }

  function AddBudgetModal() {
    const [cat, setCat] = useState('');
    const [lim, setLim] = useState('');
    return (
      <ModalShell title="Add Budget" onClose={hideModal}>
        <div>
          <label>Category</label>
          <input className="input" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="e.g. Dining Out" />
        </div>
        <div>
          <label>Monthly Limit ($)</label>
          <input className="input" type="number" value={lim} onChange={(e) => setLim(e.target.value)} placeholder="200" />
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveBudget(cat, parseFloat(lim))}>
          Add
        </button>
      </ModalShell>
    );
  }

  function AddSavingsModal() {
    const [name, setName] = useState('');
    const [target, setTarget] = useState('');
    return (
      <ModalShell title="New Savings Goal" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Laptop" />
        </div>
        <div>
          <label>Target ($)</label>
          <input className="input" type="number" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="2000" />
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveNewSavings(name, parseFloat(target))}>
          Create
        </button>
      </ModalShell>
    );
  }

  function AddChoreModal() {
    const [name, setName] = useState('');
    const [who, setWho] = useState(state.members[0]?.id ?? ui.userId);
    const [day, setDay] = useState(0);
    const [pts, setPts] = useState('10');
    return (
      <ModalShell title="Add Chore" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Clean windows" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Assign To</label>
            <select className="input" value={who} onChange={(e) => setWho(+e.target.value)}>
              {state.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Day</label>
            <select className="input" value={day} onChange={(e) => setDay(+e.target.value)}>
              {dayNames.map((dn, i) => (
                <option key={dn} value={i}>
                  {dn}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label>Points</label>
          <input className="input" type="number" value={pts} onChange={(e) => setPts(e.target.value)} />
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveChore({ name, who, day, pts: +pts })}>
          Add
        </button>
      </ModalShell>
    );
  }

  function AddShopModal() {
    const [name, setName] = useState('');
    const [qty, setQty] = useState('');
    const [cat, setCat] = useState('Produce');
    return (
      <ModalShell title="Add Item" onClose={hideModal}>
        <div>
          <label>Item</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Milk" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Quantity</label>
            <input className="input" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="2 gallons" />
          </div>
          <div>
            <label>Category</label>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
              {['Produce', 'Dairy', 'Meat', 'Bakery', 'Grains', 'Pantry', 'Household', 'Other'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveShop({ name, qty, cat })}>
          Add
        </button>
      </ModalShell>
    );
  }

  function ColorPicker({ value, onPick }: { value: string; onPick: (c: string) => void }) {
    return (
      <div className="flex gap-2 mt-1">
        {MEMBER_COLORS.map((c) => (
          <div
            key={c}
            className={`w-8 h-8 rounded-lg cursor-pointer border-2 transition hover:scale-110 ${c === value ? 'border-white' : 'border-transparent'}`}
            style={{ background: c }}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
    );
  }

  function AddMemberModal() {
    const [name, setName] = useState('');
    const [role, setRole] = useState<'admin' | 'member'>('member');
    const [color, setColor] = useState(MEMBER_COLORS[0]);
    return (
      <ModalShell title="Add Member" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div>
          <label>Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label>Color</label>
          <ColorPicker value={color} onPick={setColor} />
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveMember(name, role, color)}>
          Add
        </button>
      </ModalShell>
    );
  }

  function EditMemberModal({ id }: { id: number }) {
    const m = getMember(state, id);
    const isAdminUser = admin();
    const self = m?.id === ui.userId;
    const [name, setName] = useState(m?.name ?? '');
    const [status, setStatus] = useState(m?.status ?? 'home');
    const [role, setRole] = useState<'admin' | 'member'>((m?.role as 'admin' | 'member') ?? 'member');
    const [color, setColor] = useState(m?.color ?? '#10B981');
    if (!m) return null;
    const statuses = ['home', 'school', 'out', 'work', 'gym'];
    return (
      <ModalShell title={'Edit ' + m.name} onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div>
          <label>Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {isAdminUser && (
          <div>
            <label>Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        )}
        <div>
          <label>Color</label>
          <ColorPicker value={color} onPick={setColor} />
        </div>
        <div className="flex gap-3 pt-1">
          <button
            className="btn btn-primary flex-1"
            onClick={() => updateMember(id, { name, status, role: isAdminUser ? role : undefined, color })}
          >
            <i className="fa-solid fa-check" />
            Save
          </button>
          {isAdminUser && !self && (
            <button className="btn btn-danger flex-1" onClick={() => removeMember(id)}>
              <i className="fa-solid fa-user-minus" />
              Remove
            </button>
          )}
        </div>
      </ModalShell>
    );
  }

  function EditFamilyNameModal() {
    const [name, setName] = useState(state.householdName || '');
    return (
      <ModalShell title="Family Name" onClose={hideModal}>
        <div>
          <label>What should we call your household?</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Cantila Home" maxLength={80} />
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveFamilyName(name)}>
          <i className="fa-solid fa-check" />
          Save
        </button>
      </ModalShell>
    );
  }

  function AddEventModal() {
    const cats = Object.keys(catColors);
    const [title, setTitle] = useState('');
    const [date, setDate] = useState(ui.selectedDate);
    const [time, setTime] = useState('');
    const [cat, setCat] = useState(cats[0]);
    const [memberId, setMemberId] = useState(state.members[0]?.id ?? ui.userId);
    const [desc, setDesc] = useState('');
    return (
      <ModalShell title="Add Event" onClose={hideModal}>
        <div>
          <label>Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label>Time</label>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Category</label>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Assign To</label>
            <select className="input" value={memberId} onChange={(e) => setMemberId(+e.target.value)}>
              {state.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label>Description</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveEvent({ title, date, time, cat, memberId, desc })}>
          Save
        </button>
      </ModalShell>
    );
  }

  function ViewEventModal({ id }: { id: number }) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return null;
    const m = getMember(state, e.memberId);
    return (
      <ModalShell title={e.title} onClose={hideModal}>
        <div className="flex items-center gap-3">
          <i className="fa-regular fa-calendar text-[var(--muted)]" />
          <span>{fdLocal(e.date)}</span>
        </div>
        <div className="flex items-center gap-3">
          <i className="fa-regular fa-clock text-[var(--muted)]" />
          <span>{e.time}</span>
        </div>
        <div className="flex items-center gap-3">
          <i className="fa-solid fa-tag text-[var(--muted)]" />
          <span className="capitalize">{e.cat}</span>
        </div>
        <div className="flex items-center gap-3">
          {m && (
            <div className="avatar" style={{ background: m.color, width: 24, height: 24, fontSize: 9, borderRadius: 6 }}>
              {m.init}
            </div>
          )}
          <span>{m ? m.name : 'Unknown'}</span>
        </div>
        {e.desc && <p className="text-sm text-[var(--muted)] pt-2 border-t border-[var(--border)]">{e.desc}</p>}
        <div className="flex gap-3 mt-4">
          <button className="btn btn-danger btn-sm flex-1" onClick={() => deleteEvent(e.id)}>
            <i className="fa-solid fa-trash-can" />
            Delete
          </button>
          <button className="btn btn-secondary btn-sm flex-1" onClick={hideModal}>
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  function AddAutomationModal() {
    const [name, setName] = useState('');
    const [trigType, setTrigType] = useState<'time' | 'presence' | 'security'>('time');
    const [at, setAt] = useState('07:00');
    const [presence, setPresence] = useState<'everyone_away' | 'someone_home'>('everyone_away');
    const [armed, setArmed] = useState(true);
    const [actScene, setActScene] = useState(state.scenes[0]?.id ?? '');
    function buildTrigger(): AutomationTrigger {
      if (trigType === 'time') return { type: 'time', at };
      if (trigType === 'presence') return { type: 'presence', mode: presence };
      return { type: 'security', armed };
    }
    return (
      <ModalShell title="Add Automation" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Movie Night" />
        </div>
        <div>
          <label>Trigger</label>
          <select className="input" value={trigType} onChange={(e) => setTrigType(e.target.value as 'time' | 'presence' | 'security')}>
            <option value="time">At a time</option>
            <option value="presence">Presence</option>
            <option value="security">Security state</option>
          </select>
        </div>
        {trigType === 'time' && (
          <div>
            <label>Time</label>
            <input className="input" type="time" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
        )}
        {trigType === 'presence' && (
          <div>
            <label>When</label>
            <select className="input" value={presence} onChange={(e) => setPresence(e.target.value as 'everyone_away' | 'someone_home')}>
              <option value="everyone_away">Everyone leaves</option>
              <option value="someone_home">Someone comes home</option>
            </select>
          </div>
        )}
        {trigType === 'security' && (
          <div>
            <label>When security is</label>
            <select className="input" value={armed ? 'armed' : 'disarmed'} onChange={(e) => setArmed(e.target.value === 'armed')}>
              <option value="armed">Armed</option>
              <option value="disarmed">Disarmed</option>
            </select>
          </div>
        )}
        <div>
          <label>Run scene</label>
          <select className="input" value={actScene} onChange={(e) => setActScene(e.target.value)}>
            {state.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveAutomation({ name, trigger: buildTrigger(), actions: [{ kind: 'scene', scene: actScene }] })}>
          Add Automation
        </button>
      </ModalShell>
    );
  }

  function ConnectDevicesModal() {
    const [scanning, setScanning] = useState(false);
    const [scanned, setScanned] = useState(false);
    const [found, setFound] = useState<DiscoveredDevice[]>([]);
    const [reason, setReason] = useState('');
    async function scan() {
      setScanning(true);
      setReason('');
      try {
        const res = await fetch('/api/discover');
        const data: { ok?: boolean; reason?: string; devices?: DiscoveredDevice[] } = await res.json();
        setFound(Array.isArray(data.devices) ? data.devices : []);
        if (data.ok === false && data.reason) setReason(data.reason);
      } catch {
        setReason('Discovery unavailable on this network.');
        setFound([]);
      } finally {
        setScanning(false);
        setScanned(true);
      }
    }
    return (
      <ModalShell title="Connect Devices" onClose={hideModal}>
        <p className="text-xs text-[var(--muted)]">Scan your local network for smart devices to link.</p>
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" onClick={scan} disabled={scanning}>
            <i className="fa-solid fa-wifi" />
            {scanning ? 'Scanning…' : 'Scan network'}
          </button>
          <button className="btn btn-secondary" onClick={openManualConnect}>
            Manual
          </button>
        </div>
        {reason && <div className="text-[11px] text-[var(--amber)]">{reason}</div>}
        {found.length > 0 && (
          <>
            <div className="space-y-2">
              {found.map((dev) => (
                <div key={dev.host} className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--bg2)]">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(16,185,129,.12)', color: 'var(--accent)' }}>
                    <i className={`fa-solid ${dev.icon || 'fa-plug'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{dev.name}</div>
                    <div className="text-[10px] text-[var(--muted)]">{dev.host}</div>
                  </div>
                  <button className="btn btn-sm btn-secondary" onClick={() => addDiscovered(dev)}>
                    Add
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn-primary w-full" onClick={() => addAllDiscovered(found)}>
              Add all ({found.length})
            </button>
          </>
        )}
        {scanned && !found.length && !reason && <div className="text-[11px] text-[var(--muted)]">No devices found.</div>}
      </ModalShell>
    );
  }

  function ManualConnectModal() {
    const [name, setName] = useState('');
    const [host, setHost] = useState('');
    const [type, setType] = useState<Device['type']>('appliance');
    const [stream, setStream] = useState('');
    const [testResult, setTestResult] = useState('');
    const [testing, setTesting] = useState(false);
    async function test() {
      if (!host.trim()) {
        toast('Enter a host first', 'error');
        return;
      }
      setTesting(true);
      setTestResult('');
      try {
        const res = await fetch('/api/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ check: host.trim() }),
        });
        const data: { reachable?: boolean } = await res.json();
        setTestResult(data.reachable ? 'Reachable ✓' : 'Not reachable');
      } catch {
        setTestResult('Not reachable');
      } finally {
        setTesting(false);
      }
    }
    return (
      <ModalShell title="Manual Connect" onClose={hideModal}>
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Living Room Plug" />
        </div>
        <div>
          <label>Host / IP</label>
          <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label>Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as Device['type'])}>
              {(['lock', 'camera', 'sensor', 'media', 'appliance', 'climate'] as const).map((t) => (
                <option key={t} value={t}>
                  {devTypeMeta[t].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Stream URL <span className="font-normal text-[var(--muted)]">(optional)</span></label>
            <input className="input" value={stream} onChange={(e) => setStream(e.target.value)} placeholder="RTSP / HLS / MJPEG" />
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button className="btn btn-secondary btn-sm" onClick={test} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </button>
          {testResult && <span className="text-[11px] text-[var(--muted)]">{testResult}</span>}
        </div>
        <button className="btn btn-primary w-full" onClick={() => saveManual({ name, host, type, stream })}>
          Add Device
        </button>
      </ModalShell>
    );
  }

  // small local date formatter mirroring fd() to avoid extra import churn in modal
  function fdLocal(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const n = new Date();
    const t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // pushAlert is available from the store but actions push alerts inline via update()
  void pushAlert;

  return {
    // smart home control
    toggleLight,
    setBrightness,
    allLights,
    linkDeako,
    adjTemp,
    toggleThermo,
    setThermoMode,
    toggleArm,
    toggleLock,
    toggleSensor,
    toggleDevice,
    setRoom,
    activateScene,
    // device/room management
    openAddDevice,
    saveManage,
    openManageDevice,
    removeDevice,
    openAddRoom,
    saveRoom,
    // finance: transactions
    deleteTx,
    openAddTransaction,
    saveTransaction,
    // finance: recurring
    payRecurring,
    deleteRecurring,
    openAddRecurring,
    saveRecurring,
    // finance: debts
    openAddDebt,
    saveDebt,
    deleteDebt,
    openPayDebt,
    savePayDebt,
    // finance: savings & budgets
    addToSavings,
    saveSavings,
    openAddBudget,
    saveBudget,
    openAddSavings,
    saveNewSavings,
    // tasks
    toggleChore,
    toggleShop,
    deleteShop,
    clearChecked,
    openAddChore,
    saveChore,
    openAddShop,
    saveShop,
    // family
    openAddMember,
    saveMember,
    openEditMember,
    updateMember,
    removeMember,
    openEditFamilyName,
    saveFamilyName,
    // schedule events
    openAddEvent,
    saveEvent,
    viewEvent,
    deleteEvent,
    // automations
    openAddAutomation,
    saveAutomation,
    toggleAutomation,
    deleteAutomation,
    runAutomationNow,
    seedDefaults,
    // connect devices
    openConnectDevices,
    addDiscovered,
    addAllDiscovered,
    openManualConnect,
    saveManual,
  };
}
