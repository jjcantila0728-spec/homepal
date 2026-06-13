'use client';

import { useMemo } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { useHousehold } from '@/store/household';
import { useActions } from '@/hooks/useActions';
import { money } from '@/lib/format';
import { txInMonth, sumType, totalDebt, totalMinPay } from '@/lib/selectors';
import {
  StatCard,
  TxRow,
  BudgetCard,
  SavingsCard,
  RecurringCard,
  DebtCard,
  EmptyState,
} from '@/components/ui/Cards';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const dc = ['#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6B7280'];

export function Finance() {
  const { state } = useHousehold();
  const { openAddTransaction, openAddBudget, openAddRecurring, openAddDebt, openAddSavings } = useActions();

  const now = new Date();
  const CY = now.getFullYear();
  const CM = now.getMonth();

  const mt = txInMonth(state, CY, CM);
  const inc = sumType(mt, 'income');
  const exp = sumType(mt, 'expense');
  const bal = sumType(state.transactions, 'income') - sumType(state.transactions, 'expense');
  const debt = totalDebt(state);
  const billsDue = (state.recurring || [])
    .filter((r) => r.kind !== 'income')
    .reduce((s, r) => s + (+r.amount || 0), 0);

  const recs = (state.recurring || []).slice().sort((a, b) => (a.next || '').localeCompare(b.next || ''));
  const dbs = (state.debts || []).slice().sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const revTx = state.transactions.slice().reverse();

  // ---- bar chart: last 6 months income vs expenses ----
  const barData = useMemo(() => {
    const months: string[] = [];
    const incD: number[] = [];
    const expD: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(CY, CM - i, 1);
      months.push(d.toLocaleString('en', { month: 'short' }));
      const m = txInMonth(state, d.getFullYear(), d.getMonth());
      incD.push(sumType(m, 'income'));
      expD.push(sumType(m, 'expense'));
    }
    return {
      labels: months,
      datasets: [
        { label: 'Income', data: incD, backgroundColor: 'rgba(16,185,129,.65)', borderRadius: 5, borderSkipped: false as const },
        { label: 'Expenses', data: expD, backgroundColor: 'rgba(239,68,68,.65)', borderRadius: 5, borderSkipped: false as const },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.transactions, CY, CM]);

  const barOptions = useMemo(
    () => ({
      responsive: true,
      plugins: {
        legend: { labels: { color: '#94A3B8', font: { family: 'Plus Jakarta Sans', size: 11 } } },
      },
      scales: {
        x: { ticks: { color: '#7B8CA8' }, grid: { color: 'rgba(45,59,85,.2)' } },
        y: {
          ticks: { color: '#7B8CA8', callback: (v: string | number) => '$' + v },
          grid: { color: 'rgba(45,59,85,.2)' },
        },
      },
    }),
    [],
  );

  // ---- doughnut chart: expenses by category ----
  const doughData = useMemo(() => {
    const expByCat: Record<string, number> = {};
    state.transactions
      .filter((t) => t.type === 'expense')
      .forEach((t) => {
        expByCat[t.cat] = (expByCat[t.cat] || 0) + t.amount;
      });
    const labels = Object.keys(expByCat);
    return {
      labels,
      datasets: [{ data: Object.values(expByCat), backgroundColor: dc.slice(0, labels.length), borderWidth: 0 }],
    };
  }, [state.transactions]);

  const doughOptions = useMemo(
    () => ({
      responsive: true,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right' as const,
          labels: { color: '#94A3B8', padding: 10, font: { family: 'Plus Jakarta Sans', size: 11 } },
        },
      },
    }),
    [],
  );

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          cls="emerald"
          icon="fa-wallet"
          iconColor="var(--accent)"
          label="Balance"
          value={<span className="grad-text">{money(bal)}</span>}
        />
        <StatCard cls="amber" icon="fa-arrow-down" iconColor="var(--accent)" label="Income" value={'+' + money(inc)} sub="this month" />
        <StatCard cls="red" icon="fa-arrow-up" iconColor="var(--red)" label="Expenses" value={'-' + money(exp)} sub="this month" />
        <StatCard
          cls="purple"
          icon="fa-scale-unbalanced"
          iconColor="var(--purple)"
          label="Total Debt"
          value={money(debt)}
          sub={(state.debts || []).length + ' accounts'}
        />
      </div>

      <div className="card mb-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Monthly Budgets</h3>
          <button className="btn btn-sm btn-primary" onClick={openAddBudget} aria-label="Add budget">
            <i className="fa-solid fa-plus" />
          </button>
        </div>
        {state.budgets.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {state.budgets.map((b) => (
              <BudgetCard key={b.cat} b={b} />
            ))}
          </div>
        ) : (
          <EmptyState color="var(--accent)" title="No budgets yet" sub="Set a monthly limit to track spending" />
        )}
      </div>

      <div className="card mb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Bills &amp; Recurring</h3>
            <p className="text-[11px] text-[var(--muted)]">{money(billsDue)} in recurring bills</p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={openAddRecurring}>
            <i className="fa-solid fa-plus" />
            Add
          </button>
        </div>
        {recs.length ? (
          <div className="space-y-2">
            {recs.map((r) => (
              <RecurringCard key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <EmptyState color="var(--blue)" title="No recurring items yet" sub="Add bills or income that repeat" />
        )}
      </div>

      <div className="card mb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Debts &amp; Credit Cards</h3>
            <p className="text-[11px] text-[var(--muted)]">
              {money(debt)} owed &middot; {money(totalMinPay(state))}/mo minimum
            </p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={openAddDebt}>
            <i className="fa-solid fa-plus" />
            Add
          </button>
        </div>
        {dbs.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {dbs.map((d) => (
              <DebtCard key={d.id} d={d} />
            ))}
          </div>
        ) : (
          <EmptyState color="var(--purple)" title="No debts tracked — nice!" sub="You are all clear here" />
        )}
      </div>

      <div className="card mb-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Savings Goals</h3>
          <button className="btn btn-sm btn-primary" onClick={openAddSavings} aria-label="Add savings goal">
            <i className="fa-solid fa-plus" />
          </button>
        </div>
        {state.savings.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {state.savings.map((s) => (
              <SavingsCard key={s.id} s={s} />
            ))}
          </div>
        ) : (
          <EmptyState color="var(--cyan)" title="No savings goals yet" sub="Start a goal and watch it grow" />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div className="card">
          <h3 className="font-semibold mb-3">Monthly Overview</h3>
          <Bar data={barData} options={barOptions} height={200} />
        </div>
        <div className="card">
          <h3 className="font-semibold mb-3">Expense Breakdown</h3>
          <Doughnut data={doughData} options={doughOptions} height={200} />
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Transactions</h3>
          <button className="btn btn-primary btn-sm" onClick={openAddTransaction}>
            <i className="fa-solid fa-plus" />
            Add
          </button>
        </div>
        {revTx.map((t) => (
          <TxRow key={t.id} t={t} />
        ))}
      </div>
    </>
  );
}
