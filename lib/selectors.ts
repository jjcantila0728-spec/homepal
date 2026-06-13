import type { HouseholdState, Member, Transaction } from './types';
import { mKey } from './format';

const fallbackUser: Member = { id: 0, name: '', role: 'member', status: '', color: '#10B981', init: '' };

export function getMember(state: HouseholdState, id: number): Member | undefined {
  return state.members.find((m) => m.id === id);
}
export function currentUser(state: HouseholdState, userId: number): Member {
  return getMember(state, userId) || state.members[0] || fallbackUser;
}
export function isAdmin(state: HouseholdState, userId: number): boolean {
  return currentUser(state, userId).role === 'admin';
}

export function txInMonth(state: HouseholdState, y: number, m: number): Transaction[] {
  const key = y + '-' + String(m + 1).padStart(2, '0');
  return state.transactions.filter((t) => mKey(t.date) === key);
}
export function sumType(list: Transaction[], type: 'income' | 'expense'): number {
  return list.filter((t) => t.type === type).reduce((s, t) => s + (+t.amount || 0), 0);
}
export function budgetSpent(state: HouseholdState, cat: string): number {
  const n = new Date();
  return txInMonth(state, n.getFullYear(), n.getMonth())
    .filter((t) => t.type === 'expense' && t.cat === cat)
    .reduce((s, t) => s + (+t.amount || 0), 0);
}
export function totalDebt(state: HouseholdState): number {
  return (state.debts || []).reduce((s, d) => s + (+d.balance || 0), 0);
}
export function totalMinPay(state: HouseholdState): number {
  return (state.debts || []).reduce((s, d) => s + (+d.minPayment || 0), 0);
}
