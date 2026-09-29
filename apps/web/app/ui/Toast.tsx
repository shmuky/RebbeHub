import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLang } from '../lib/useLang.js';
import { tu } from '../lib/i18nUi.js';
import { Icon } from './Icon.js';

/**
 * A short word that something happened ("Link copied", "Report sent"),
 * in the corner for a few seconds, read out to screen readers. Errors
 * stay until dismissed.
 */

type Tone = 'positive' | 'negative' | 'info';
interface ToastItem {
  id: number;
  text: ReactNode;
  tone: Tone;
}

const ToastContext = createContext<(text: ReactNode, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const lang = useLang();
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (text: ReactNode, tone: Tone = 'positive') => {
      const id = next.current++;
      setItems((list) => [...list.slice(-2), { id, text, tone }]);
      if (tone !== 'negative') setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon name={t.tone === 'negative' ? 'warn' : t.tone === 'info' ? 'info' : 'check'} />
            <span className="grow">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label={tu(lang, 'dismiss')}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
