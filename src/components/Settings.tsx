import { useState } from 'react';
import { Bell, Download, LogOut, Send, ShieldCheck, Smartphone } from 'lucide-react';
import { api, deviceId, enablePush, installed, permission } from '../api';
import { settingsSchema, type Bootstrap, type Preferences } from '../domain';
import { Logo, Sheet } from './UI';
export function Settings({
  data,
  refresh,
  notify,
  onLogout,
}: {
  data: Bootstrap;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  onLogout: () => void;
}) {
  const [prefs, setPrefs] = useState<Preferences>(data.settings);
  const [busy, setBusy] = useState(false);
  const [logout, setLogout] = useState(false);
  const [all, setAll] = useState(false);
  const current = data.subscriptions.find((s) => s.device_id === deviceId());
  async function action(task: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await task();
      await refresh();
      notify(message);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test(delayed: boolean) {
    setBusy(true);
    try {
      const result = await api<{ status: string; error?: string }>('test', 'POST', {
        deviceId: deviceId(),
        delayed,
      });
      notify(
        delayed
          ? 'Test saved on the server. Close DXB now; expect a push in about 1–2 minutes.'
          : result.status === 'submitted'
            ? 'Push service accepted the test request. Check your device.'
            : `Test status: ${result.status}. ${result.error || 'The server will retry eligible failures.'}`,
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings">
      <div className="eyebrow">MAKE IT YOURS</div>
      <h1>Settings.</h1>
      <div className="profile-card">
        <Logo size={64} />
        <div>
          <h3>{data.settings.profileName}</h3>
          <p>DXB · Personal space</p>
        </div>
        <ShieldCheck size={21} />
      </div>
      <section className="control-section">
        <div className="section-number">APPEARANCE & DEFAULTS</div>
        <div className="form-stack">
          <label>
            Profile name
            <input
              maxLength={60}
              value={prefs.profileName}
              onChange={(e) => setPrefs({ ...prefs, profileName: e.target.value })}
            />
          </label>
          <div className="section-heading">
            <span>Accent color</span>
            <div className="swatches">
              {(['#ffffff', '#b7cbbf', '#c7b9a5'] as const).map((color) => (
                <button
                  key={color}
                  aria-label={`Use ${color} accent`}
                  aria-pressed={prefs.accent === color}
                  style={{ background: color }}
                  onClick={() => setPrefs({ ...prefs, accent: color })}
                />
              ))}
            </div>
          </div>
          <div className="form-pair">
            <label>
              Default duration
              <input
                type="number"
                min={1}
                max={9}
                value={prefs.duration}
                onChange={(e) => setPrefs({ ...prefs, duration: +e.target.value })}
              />
            </label>
            <label>
              Per hour
              <input
                type="number"
                min={5}
                max={99}
                value={prefs.frequency}
                onChange={(e) => setPrefs({ ...prefs, frequency: +e.target.value })}
              />
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={prefs.badge}
              onChange={(e) => setPrefs({ ...prefs, badge: e.target.checked })}
            />
            Show app badge where supported
          </label>
          <details className="disclosure">
            <summary>Default notification distribution</summary>
            <div className="distribution">
              {(['message', 'image', 'reply'] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    aria-label={`Default ${key} percentage`}
                    type="number"
                    min={0}
                    max={100}
                    value={prefs.distribution[key]}
                    onChange={(e) =>
                      setPrefs({
                        ...prefs,
                        distribution: { ...prefs.distribution, [key]: +e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <details className="disclosure">
            <summary>Default selected contacts · {prefs.selected.length}</summary>
            <div className="default-selection">
              {data.contacts
                .filter((c) => c.enabled)
                .map((c) => (
                  <label className="check-label" key={c.id}>
                    <input
                      type="checkbox"
                      checked={prefs.selected.includes(c.id)}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          selected: e.target.checked
                            ? [...prefs.selected, c.id]
                            : prefs.selected.filter((id) => id !== c.id),
                        })
                      }
                    />
                    {c.name}
                  </label>
                ))}
            </div>
          </details>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                settingsSchema.parse(prefs);
                await api('settings', 'PUT', prefs);
                if (!prefs.badge)
                  navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_BADGE' });
              }, 'Preferences saved. New controls use these defaults.')
            }
          >
            Save preferences
          </button>
        </div>
      </section>
      <section className="control-section">
        <div className="section-number">
          <Bell size={15} /> NOTIFICATIONS
        </div>
        <dl className="status-list">
          <div>
            <dt>Permission</dt>
            <dd>{permission()}</dd>
          </div>
          <div>
            <dt>This device</dt>
            <dd>{current?.status || 'Not registered'}</dd>
          </div>
          <div>
            <dt>Last accepted push</dt>
            <dd>
              {current?.last_success ? new Date(current.last_success).toLocaleString() : 'None yet'}
            </dd>
          </div>
          <div>
            <dt>Home Screen / standalone</dt>
            <dd>{installed() ? 'Installed' : 'Browser tab'}</dd>
          </div>
          <div>
            <dt>Active devices</dt>
            <dd>{data.subscriptions.filter((s) => s.status === 'active').length}</dd>
          </div>
        </dl>
        <div className="button-stack">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void action(
                () => enablePush(data.publicKey),
                'This device is registered for push notifications.',
              )
            }
          >
            <Smartphone size={17} />
            Enable / repair notifications
          </button>
          <button
            className="secondary"
            disabled={busy || current?.status !== 'active'}
            onClick={() => void test(false)}
          >
            <Send size={17} />
            Send Test Notification
          </button>
          <button
            className="secondary"
            disabled={busy || current?.status !== 'active'}
            onClick={() => void test(true)}
          >
            <Bell size={17} />
            Delayed Background Test
          </button>
        </div>
        <p className="fine-print">
          The delayed test uses the same persistent dispatcher as your sessions. Acceptance by a
          push service is not proof of delivery.
        </p>
      </section>
      <section className="control-section">
        <div className="section-number">
          <Download size={15} /> INSTALL & HELP
        </div>
        <details className="disclosure">
          <summary>Install DXB on iPhone</summary>
          <ol className="help-list">
            <li>Open your deployed HTTPS address in Safari.</li>
            <li>Tap Share, then Add to Home Screen. Keep “Open as Web App” enabled if shown.</li>
            <li>Launch DXB using its Home Screen icon.</li>
            <li>Unlock, then tap Enable notifications here and allow the system prompt.</li>
            <li>Run a delayed test, close DXB, and lock your phone.</li>
          </ol>
          <p className="fine-print">
            iPhone Web Push requires iOS 16.4 or later and Home Screen installation.
          </p>
        </details>
        <details className="disclosure">
          <summary>Missing notifications?</summary>
          <p className="fine-print">
            Check your network, notification permissions, Focus mode, and device notification
            summaries. If permission is denied, change it in device settings; DXB cannot re-enable
            it silently. Repair an expired subscription here. The server’s Cron job must be enabled.
          </p>
        </details>
        <details className="disclosure">
          <summary>Privacy & platform limitations</summary>
          <p className="fine-print">
            DXB is a single-user simulator. A shared four-digit code is limited protection, not a
            strong account login. Contacts and schedules are stored in your Supabase project. No
            real messages or conversations exist. iOS controls sounds, app identity, grouping, and
            delivery timing. Custom native notification sounds and per-notification app icons are
            not available. OS reduced-motion preferences are respected automatically.
          </p>
        </details>
      </section>
      <section className="control-section">
        <div className="section-number">ACCESS & SECURITY</div>
        <dl className="status-list">
          <div>
            <dt>Access expires</dt>
            <dd>{new Date(data.authExpires).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt>Notification session</dt>
            <dd>{data.session?.status || 'None'}</dd>
          </div>
        </dl>
        <button className="danger full" onClick={() => setLogout(true)}>
          <LogOut size={17} />
          Log out
        </button>
      </section>
      <footer className="about">
        <Logo size={45} />
        <span>DXB / 1.0.0</span>
        <p>
          A personal notification simulator.
          <br />
          Your space. Your rhythm.
        </p>
      </footer>
      {logout && (
        <Sheet title="Leave your space?" onClose={() => setLogout(false)}>
          <p className="sheet-copy">
            Logging out stops the active notification session and disables push on this device.
            Requests already in flight may still arrive.
          </p>
          <label className="check-label">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Log out and disable all devices
          </label>
          <button
            className="danger full"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api('logout', 'POST', { deviceId: deviceId(), all })
                .then(async () => {
                  if ('serviceWorker' in navigator) {
                    const reg = await navigator.serviceWorker.getRegistration();
                    await reg?.pushManager
                      .getSubscription()
                      .then((s) => s?.unsubscribe())
                      .catch(() => {});
                    reg?.active?.postMessage({ type: 'CLEAR_BADGE' });
                  }
                  onLogout();
                })
                .catch((e) => notify(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Log out{all ? ' everywhere' : ''}
          </button>
        </Sheet>
      )}
    </div>
  );
}
