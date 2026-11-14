import { createContext, useContext, useState, useCallback } from 'react';
const ToastContext = createContext({ showToast: () => { } });
export function ToastProvider({ children }) {
    const [state, setState] = useState({
        msg: '',
        isError: false,
        visible: false,
    });
    const showToast = useCallback((msg, isError = false) => {
        setState({ msg, isError, visible: true });
        setTimeout(() => setState(s => ({ ...s, visible: false })), 2600);
    }, []);
    return (<ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={`toast${state.visible ? ' show' : ''}${state.isError ? ' error' : ''}`}>
        {state.msg}
      </div>
    </ToastContext.Provider>);
}
export function useToast() {
    return useContext(ToastContext);
}
