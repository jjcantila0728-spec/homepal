'use client';

import { useHousehold } from '@/store/household';
import { useActions } from '@/hooks/useActions';
import { Avatar, fd } from '@/lib/format';
import { getMember, connectorLabel } from '@/lib/selectors';
import { catColors, dayNames } from '@/lib/constants';
import { holidayMap } from '@/lib/holidays';
import { EmptyState } from '@/components/ui/Cards';

const M_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function Schedule() {
  const { state, ui, setUI } = useHousehold();
  const { openAddEvent, viewEvent } = useActions();

  const y = ui.calYear;
  const m = ui.calMonth;
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // Today's components (mirrors legacy CY / CM / CD).
  const now = new Date();
  const CY = now.getFullYear();
  const CM = now.getMonth();
  const CD = now.getDate();

  // Public holidays for the visible year, keyed by "YYYY-MM-DD".
  const holidays = holidayMap(state.location?.country, state.location?.region, y);

  // Mirror legacy changeMonth(delta).
  function changeMonth(delta: number) {
    let cm = m + delta;
    let cy = y;
    if (cm > 11) {
      cm = 0;
      cy++;
    }
    if (cm < 0) {
      cm = 11;
      cy--;
    }
    setUI({ calMonth: cm, calYear: cy });
  }

  function toggleMultiSelect() {
    setUI({ multiSelectDays: !ui.multiSelectDays, selectedDates: [] });
  }

  function onDayClick(ds2: string) {
    if (ui.multiSelectDays) {
      const set = new Set(ui.selectedDates);
      if (set.has(ds2)) set.delete(ds2);
      else set.add(ds2);
      setUI({ selectedDates: [...set] });
    } else {
      setUI({ selectedDate: ds2 });
    }
  }

  const selEvts = state.events
    .filter((e) => e.date === ui.selectedDate)
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time));
  const selHoliday = holidays[ui.selectedDate];

  return (
    <div className="flex flex-col lg:flex-row gap-5">
      <div className="flex-1">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <button className="btn btn-sm btn-secondary" onClick={() => changeMonth(-1)} aria-label="Previous month">
              <i className="fa-solid fa-chevron-left" />
            </button>
            <h3 className="font-semibold text-lg">
              {M_NAMES[m]} {y}
            </h3>
            <button className="btn btn-sm btn-secondary" onClick={() => changeMonth(1)} aria-label="Next month">
              <i className="fa-solid fa-chevron-right" />
            </button>
          </div>

          <div className="flex items-center justify-between mb-3">
            <button
              className={`btn btn-sm ${ui.multiSelectDays ? 'btn-primary' : 'btn-secondary'}`}
              onClick={toggleMultiSelect}
              aria-pressed={ui.multiSelectDays}
            >
              <i className="fa-solid fa-calendar-check" />
              {ui.multiSelectDays ? 'Selecting days' : 'Select days'}
            </button>
            {ui.multiSelectDays && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">{ui.selectedDates.length} selected</span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={openAddEvent}
                  disabled={ui.selectedDates.length === 0}
                >
                  <i className="fa-solid fa-plus" /> Add event
                </button>
              </div>
            )}
          </div>

          <div className="cal-grid">
            {dayNames.map((dn) => (
              <div key={dn} className="cal-head">
                {dn}
              </div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="cal-day empty" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const d = i + 1;
              const ds2 = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
              const isToday = d === CD && m === CM && y === CY;
              const isSel = ui.multiSelectDays ? ui.selectedDates.includes(ds2) : ds2 === ui.selectedDate;
              const dev = state.events.filter((e) => e.date === ds2);
              const holName = holidays[ds2];
              return (
                <div
                  key={ds2}
                  className={`cal-day ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''} ${holName ? 'holiday' : ''}`}
                  onClick={() => onDayClick(ds2)}
                  title={holName || undefined}
                  aria-label={
                    ds2 +
                    (holName ? ', holiday: ' + holName : '') +
                    (dev.length ? ', ' + dev.length + ' events' : '')
                  }
                >
                  <span className="day-num">{d}</span>
                  {(dev.length > 0 || holName) && (
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {holName && (
                        <span className="evt-dot" style={{ background: 'var(--amber)' }} aria-hidden="true" />
                      )}
                      {dev.map((ev) => (
                        <span key={ev.id} className="evt-dot" style={{ background: catColors[ev.cat] || '#6B7B8D' }} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="lg:w-72">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">{fd(ui.selectedDate)}</h3>
            <button className="btn btn-sm btn-primary" onClick={openAddEvent} aria-label="Add event">
              <i className="fa-solid fa-plus" />
            </button>
          </div>
          {selHoliday && (
            <div className="p-2.5 rounded-xl mb-1.5 flex items-center gap-2 bg-[var(--surface2)]">
              <i className="fa-solid fa-star text-[var(--amber)]" />
              <span className="text-sm font-medium">Holiday: {selHoliday}</span>
            </div>
          )}
          {selEvts.length ? (
            selEvts.map((se) => {
              const sm = getMember(state, se.memberId);
              return (
                <div
                  key={se.id}
                  className="p-2.5 rounded-xl mb-1.5 cursor-pointer hover:bg-[var(--surface2)] transition"
                  style={{ borderLeft: '3px solid ' + (catColors[se.cat] || '#6B7B8D') }}
                  onClick={() => viewEvent(se.id)}
                >
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {se.title}
                    {se.source === 'connector' && (
                      <i
                        className="fa-solid fa-plug-circle-bolt text-[10px] text-[var(--muted)]"
                        title={`Imported from ${connectorLabel(state, se.connectionId)}`}
                        aria-label={`Imported from ${connectorLabel(state, se.connectionId)}`}
                      />
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    <i className="fa-regular fa-clock" /> {se.time}
                    {se.endTime ? `–${se.endTime}` : ''}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Avatar member={sm} size={18} fontSize={7} radius={5} />
                    <span className="text-[10px] text-[var(--muted)]">{sm ? sm.name : ''}</span>
                  </div>
                </div>
              );
            })
          ) : selHoliday ? null : (
            <EmptyState color="var(--amber)" title="No events" sub="Nothing scheduled for this day" />
          )}
        </div>
      </div>
    </div>
  );
}
