'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { HouseholdState, Alert, Plan } from '@/lib/types';
import { applySceneActions } from '@/lib/automations';

export type ToastType = 'success' | 'error' | 'warning' | 'info';
interface Toast {
  id: number;
  msg: string;
  type: ToastType;
  out?: boolean;
}

export interface UIState {
  userId: number;
  homeRoom: string;
  tasksTab: 'chores' | 'shopping';
  calMonth: number;
  calYear: number;
  selectedDate: string;
  notifOpen: boolean;
}

interface SceneSplash {
  name: string;
  desc: string;
  icon: string;
  color: string;
}

export interface HouseholdContextValue {
  state: HouseholdState;
  ui: UIState;
  plan: Plan;
  ready: boolean;
  update: (fn: (draft: HouseholdState) => void) => void;
  setUI: (patch: Partial<UIState>) => void;
  pushAlert: (a: Omit<Alert, 'id' | 'seen'>) => void;
  toast: (msg: string, type?: ToastType) => void;
  showModal: (node: ReactNode) => void;
  hideModal: () => void;
  activateScene: (id: string) => void;
  logout: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold must be used within HouseholdProvider');
  return ctx;
}

const now = new Date();

export function HouseholdProvider({
  initialState,
  initialPlan,
  children,
}: {
  initialState: HouseholdState;
  initialPlan: Plan;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<HouseholdState>(initialState);
  const [plan] = useState<Plan>(initialPlan);
  const [ready, setReady] = useState(true);
  const [ui, setUIState] = useState<UIState>({
    userId: initialState.members[0]?.id ?? 1,
    homeRoom: 'all',
    tasksTab: 'chores',
    calMonth: now.getMonth(),
    calYear: now.getFullYear(),
    selectedDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0],
    notifOpen: false,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<ReactNode>(null);
  const [splash, setSplash] = useState<SceneSplash | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const persistNow = () => {
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stateRef.current),
    }).catch(() => {});
  };

  const schedulePersist = () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(persistNow, 1000);
  };

  const update = (fn: (draft: HouseholdState) => void) => {
    setState((prev) => {
      const draft: HouseholdState = structuredClone(prev);
      fn(draft);
      stateRef.current = draft;
      return draft;
    });
    schedulePersist();
  };

  const setUI = (patch: Partial<UIState>) => setUIState((prev) => ({ ...prev, ...patch }));

  const toast = (msg: string, type: ToastType = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x))), 3000);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3300);
  };

  const pushAlert = (a: Omit<Alert, 'id' | 'seen'>) =>
    update((d) => {
      d.alerts.unshift({ ...a, id: ++d.nid, seen: false });
    });

  const showModal = (node: ReactNode) => setModal(node);
  const hideModal = () => setModal(null);

  const activateScene = (id: string) => {
    let scene: { name: string; desc: string; icon: string; color: string } | null = null;
    update((d) => {
      const sc = d.scenes.find((s) => s.id === id);
      if (!sc) return;
      scene = { name: sc.name, desc: sc.desc, icon: sc.icon, color: sc.color };
      applySceneActions(d, sc.actions);
      d.alerts.unshift({ id: ++d.nid, type: 'system', msg: 'Scene "' + sc.name + '" activated', time: 'Just now', sev: 'success', seen: false });
    });
    if (scene) {
      setSplash(scene);
      setTimeout(() => setSplash(null), 1500);
      toast('Scene "' + (scene as SceneSplash).name + '" activated', 'success');
    }
  };

  const logout = async () => {
    try {
      persistNow();
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    router.push('/login');
    router.refresh();
  };

  // Periodic background sync + flush on unload.
  useEffect(() => {
    const interval = setInterval(persistNow, 10000);
    const onUnload = () => {
      try {
        navigator.sendBeacon?.(
          '/api/state',
          new Blob([JSON.stringify(stateRef.current)], { type: 'application/json' }),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', onUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark unused setReady to satisfy strict noUnusedLocals without behavior change.
  void setReady;

  const value: HouseholdContextValue = {
    state,
    ui,
    plan,
    ready,
    update,
    setUI,
    pushAlert,
    toast,
    showModal,
    hideModal,
    activateScene,
    logout,
  };

  return (
    <HouseholdContext.Provider value={value}>
      {children}
      <ToastHost toasts={toasts} />
      <ModalHost node={modal} onClose={hideModal} />
      <SceneOverlay splash={splash} />
    </HouseholdContext.Provider>
  );
}

function ToastHost({ toasts }: { toasts: Toast[] }) {
  const icons: Record<ToastType, string> = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
  };
  return (
    <div id="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}${t.out ? ' out' : ''}`} role="status">
          <i className={`fa-solid ${icons[t.type]}`} aria-hidden="true" />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

function ModalHost({ node, onClose }: { node: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      id="modal-overlay"
      className={node ? 'show' : ''}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div id="modal-box" role="dialog" aria-modal="true" aria-label="Dialog">
        {node}
      </div>
    </div>
  );
}

function SceneOverlay({ splash }: { splash: SceneSplash | null }) {
  return (
    <div id="scene-overlay" className={splash ? 'show' : ''}>
      <div className="scene-splash" id="scene-splash-inner">
        {splash && (
          <>
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: splash.color + '20', color: splash.color, fontSize: 32 }}
            >
              <i className={`fa-solid ${splash.icon}`} />
            </div>
            <h2 className="text-2xl font-bold mb-2">{splash.name}</h2>
            <p className="text-[var(--muted)] text-sm">{splash.desc}</p>
          </>
        )}
      </div>
    </div>
  );
}
