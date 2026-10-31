import { useEffect, useRef, type ReactNode } from 'react';
import { X, Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { isNight, localTime, type Contact } from '../domain';
export function Logo({ size = 40 }: { size?: number }) {
  return <img className="logo" src="/icons/icon-192.png" width={size} height={size} alt="DXB" />;
}
export function Avatar({ contact }: { contact: Contact }) {
  return contact.avatar_path ? (
    <img
      className="avatar"
      src={`/api/avatars/${contact.id}?v=${encodeURIComponent(contact.avatar_path)}`}
      alt=""
    />
  ) : (
    <span className="avatar initials">
      {contact.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()}
    </span>
  );
}
export function LocalClock({ contact }: { contact: Contact }) {
  return (
    <span className="local-clock">
      {isNight(contact.timezone) ? <Moon size={12} /> : <Sun size={12} />}{' '}
      {localTime(contact.timezone)}
    </span>
  );
}
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ y: 25, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22 }}
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        {children}
      </motion.div>
    </dialog>
  );
}
export function Range({
  label,
  value,
  min,
  max,
  onChange,
  unit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  unit: string;
}) {
  return (
    <div className="range-control">
      <div className="range-heading">
        <label>
          {label}
          <input
            aria-label={label}
            type="range"
            min={min}
            max={max}
            step={1}
            value={value}
            onChange={(e) => onChange(+e.target.value)}
            style={
              { '--progress': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties
            }
          />
        </label>
        <span className="range-value">
          {value}
          <small>{unit}</small>
        </span>
      </div>
      <div className="range-limits">
        <span>
          {min} {unit === 'hours' ? 'hour' : unit}
        </span>
        <span>
          {max} {unit === 'hour' ? 'hours' : unit}
        </span>
      </div>
    </div>
  );
}
