import { useRef, useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { api } from '../api';
import { Logo } from './UI';
export function Access({
  onUnlock,
  initialError,
}: {
  onUnlock: () => Promise<void>;
  initialError: string;
}) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  async function unlock() {
    setBusy(true);
    setError('');
    try {
      await api('login', 'POST', { code: digits.join('') });
      await onUnlock();
    } catch (e) {
      setError((e as Error).message);
      setDigits(['', '', '', '']);
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="access">
      <div className="access-brand">
        <Logo size={88} />
        <span>YOUR SPACE. YOUR RHYTHM.</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
        className="access-form"
      >
        <div className="eyebrow">
          <LockKeyhole size={13} /> PRIVATE ACCESS
        </div>
        <h1>Welcome to DXB.</h1>
        <p>Enter your four-digit code to make yourself at home.</p>
        <div className="code-slots">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              aria-label={`Code digit ${i + 1}`}
              type="password"
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              pattern="[0-9]*"
              value={digit}
              onChange={(e) => {
                const text = e.target.value.replace(/\D/g, '');
                if (text.length >= 4) {
                  setDigits(text.slice(0, 4).split(''));
                  inputs.current[3]?.focus();
                  return;
                }
                const next = [...digits];
                next[i] = text.slice(-1);
                setDigits(next);
                if (text && i < 3) inputs.current[i + 1]?.focus();
              }}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
                setDigits(Array.from({ length: 4 }, (_, j) => text[j] || ''));
                inputs.current[Math.min(text.length, 3)]?.focus();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !digits[i] && i > 0) {
                  const next = [...digits];
                  next[i - 1] = '';
                  setDigits(next);
                  inputs.current[i - 1]?.focus();
                }
                if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus();
                if (e.key === 'ArrowRight' && i < 3) inputs.current[i + 1]?.focus();
              }}
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || digits.join('').length !== 4}>
          {busy ? 'Unlocking…' : 'Unlock DXB'}
          <ArrowRight size={18} />
        </button>
        <small className="muted">
          A personal notification simulator.
          <br />
          No conversations. Just your chosen rhythm.
        </small>
      </form>
      <footer>
        DXB <span>PERSONAL / PRIVATE</span>
      </footer>
    </main>
  );
}
