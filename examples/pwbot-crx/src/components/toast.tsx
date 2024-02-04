import React, { useState, useEffect } from 'react';
import './toast.css';

export interface ToastProps {
  message: string;
  type?: 'success' | 'info' | 'warning' | 'error';
  show: boolean;
  timeout?: number;
  onClose?: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'info', show, onClose, timeout = 3000 }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(show);

    const timeoutId = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, timeout);

    return () => clearTimeout(timeoutId);
  }, [show, onClose]);

  return <>{isVisible && (
    <div className={`toast ${type}`}>
      {message}
    </div>
  )}</>;
};
