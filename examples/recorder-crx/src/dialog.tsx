import React from 'react';
import './dialog.css';

export const Dialog: React.FC<React.PropsWithChildren<{
    isOpen: boolean,
    onClose: () => any,
    title: string,
}>> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{title}</h2>
          <button className="dialog-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="dialog-content">{children}</div>
      </div>
    </div>
  );
};
