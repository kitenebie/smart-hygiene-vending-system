import { createContext, useContext, useState, useCallback } from 'react';

interface ToastCtx {
  showToast: (msg: string, isError?: boolean) => void;
}

const ToastContext = createContext<ToastCtx>({ showToast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ msg: string; isError: boolean; visible: boolean }>({
    msg: '',
    isError: false,
    visible: false,
  });

  const showToast = useCallback((msg: string, isError = false) => {
    setState({ msg, isError, visible: true });
    setTimeout(() => setState(s => ({ ...s, visible: false })), 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={`toast${state.visible ? ' show' : ''}${state.isError ? ' error' : ''}`}>
        {state.msg}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
