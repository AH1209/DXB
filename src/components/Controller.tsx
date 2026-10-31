import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  Clock3,
  Plus,
  Radio,
  Square,
  Users,
} from 'lucide-react';
import { api, deviceId, enablePush, permission, workerReady } from '../api';
import {
  configSchema,
  countries,
  hourlyTargets,
  type Bootstrap,
  type SessionConfig,
} from '../domain';
import { Avatar, LocalClock, Range, Sheet } from './UI';
export function Controller({
  data,
  selected,
  setSelected,
  onAdd,
  refresh,
  notify,
}: {
  data: Bootstrap;
  selected: string[];
  setSelected: (ids: string[]) => void;
  onAdd: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [duration, setDuration] = useState(data.settings.duration);
  const [frequency, setFrequency] = useState(data.settings.frequency);
  const [overrides, setOverrides] = useState<(number | null)[]>(Array(9).fill(null));
  const [distribution, setDistribution] = useState(data.settings.distribution);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const request = useRef({ signature: '', id: crypto.randomUUID() });
  const active = data.session?.status === 'active' ? data.session : null;
  const eligible = data.contacts.filter((c) => c.enabled);
  const config: SessionConfig = {
    duration,
    frequency,
    overrides,
    selected: selected.filter((id) => eligible.some((c) => c.id === id)),
    distribution,
  };
  const total = hourlyTargets(config).reduce((a, b) => a + b, 0);
  const sum = distribution.message + distribution.image + distribution.reply;
  async function start() {
    setBusy(true);
    try {
      configSchema.parse(config);
      if (permission() !== 'granted')
        throw new Error('Enable notifications in Settings before starting.');
      const subscription = await (await workerReady()).pushManager.getSubscription();
      if (!subscription) throw new Error('This device needs to be registered in Settings.');
      await api('subscriptions', 'POST', {
        deviceId: deviceId(),
        subscription: subscription.toJSON(),
      });
      const signature = JSON.stringify(config);
      if (signature !== request.current.signature)
        request.current = { signature, id: crypto.randomUUID() };
      await api('sessions', 'POST', {
        requestId: request.current.id,
        deviceId: deviceId(),
        config,
      });
      await refresh();
      request.current.signature = '';
      notify('Session saved. The server is now managing your schedule.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try {
      await api('sessions/stop', 'POST', {});
      await refresh();
      setConfirmStop(false);
      notify('Session stopped. Pending notifications cancelled.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (active) {
    const now = new Date(data.serverNow).getTime();
    const start = new Date(active.starts_at).getTime();
    const end = new Date(active.ends_at).getTime();
    const remaining = Math.max(0, end - now);
    const hour = Math.min(active.config.duration, Math.floor((now - start) / 3600000) + 1);
    return (
      <div className="controller">
        <div className="eyebrow">
          <span className="status-dot" /> SESSION IN PROGRESS
        </div>
        <h1>Your rhythm is running.</h1>
        <p className="lead">Your schedule continues on the server, even when DXB is closed.</p>
        <section className="live-session">
          <Radio size={28} />
          <div className="countdown">
            {Math.floor(remaining / 3600000)}
            <small>h</small> {Math.floor((remaining % 3600000) / 60000)}
            <small>m left</small>
          </div>
          <progress
            max={end - start}
            value={Math.max(0, now - start)}
            aria-label="Session progress"
          />
          <div className="range-limits">
            <span>
              Started{' '}
              {new Date(active.starts_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span>
              Ends{' '}
              {new Date(active.ends_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </section>
        <div className="stats-grid">
          <div>
            <strong>{active.planned}</strong>
            <span>Planned events</span>
          </div>
          <div>
            <strong>{active.submitted}</strong>
            <span>Submitted events</span>
          </div>
          <div>
            <strong>{active.failed}</strong>
            <span>Failed / uncertain deliveries</span>
          </div>
          <div>
            <strong>{active.pending}</strong>
            <span>Pending deliveries</span>
          </div>
        </div>
        <div className="section-heading">
          <h3>
            Hour {hour} of {active.config.duration}
          </h3>
          <span>{hourlyTargets(active.config)[hour - 1]} / hour target</span>
        </div>
        <div className="selection-window">
          {data.contacts
            .filter((c) => active.config.selected.includes(c.id))
            .map((c) => (
              <div className="select-row" key={c.id}>
                <Avatar contact={c} />
                <div className="row-copy">
                  <strong>{c.name}</strong>
                  <span>{c.timezone.replaceAll('_', ' ')}</span>
                </div>
                <LocalClock contact={c} />
              </div>
            ))}
        </div>
        <p className="fine-print">
          Configuration is locked for this session. Submitted means a push service accepted the
          request; it does not confirm display on your device. Failed counts include uncertain
          network outcomes.
        </p>
        <button className="danger full" onClick={() => setConfirmStop(true)}>
          <Square size={16} />
          Stop Session
        </button>
        {confirmStop && (
          <Sheet title="Stop this session?" onClose={() => setConfirmStop(false)}>
            <p className="sheet-copy">
              Pending notifications will be cancelled. Push requests already in flight or submitted
              cannot be recalled.
            </p>
            <button className="danger full" disabled={busy} onClick={() => void stop()}>
              {busy ? 'Stopping…' : 'Stop Session'}
            </button>
          </Sheet>
        )}
      </div>
    );
  }
  return (
    <div className="controller">
      <div className="eyebrow">
        <span className="status-dot idle" /> READY WHEN YOU ARE
      </div>
      <h1>Set your own rhythm.</h1>
      <p className="lead">A little activity. On your terms.</p>
      <div className="controller-intro">
        <span>
          <Clock3 size={15} /> Up to 9 hours
        </span>
        <span>
          <Bell size={15} /> Server scheduled
        </span>
      </div>
      <section className="control-section">
        <div className="section-number">
          01 <span>THE PACE</span>
        </div>
        <Range
          label="Session duration"
          value={duration}
          min={1}
          max={9}
          unit={duration === 1 ? 'hour' : 'hours'}
          onChange={(n) => {
            setDuration(n);
            setOverrides((old) =>
              Array.from({ length: 9 }, (_, i) => (i < n ? (old[i] ?? null) : null)),
            );
            request.current.signature = '';
          }}
        />
        <Range
          label="Notifications per hour"
          value={frequency}
          min={5}
          max={99}
          unit="/ hour"
          onChange={(n) => {
            setFrequency(n);
            request.current.signature = '';
          }}
        />
        <details className="disclosure">
          <summary>
            Customize each hour <ChevronDown size={16} />
          </summary>
          <div className="hour-list">
            {Array.from({ length: duration }, (_, i) => (
              <div className="hour-row" key={i}>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={overrides[i] != null}
                    onChange={(e) =>
                      setOverrides((old) => {
                        const next = [...old];
                        next[i] = e.target.checked ? frequency : null;
                        return next;
                      })
                    }
                  />
                  Hour {i + 1}
                </label>
                <span>{overrides[i] != null ? 'Override' : 'Inherited'}</span>
                <input
                  aria-label={`Hour ${i + 1} frequency`}
                  type="number"
                  min={5}
                  max={99}
                  disabled={overrides[i] == null}
                  value={overrides[i] ?? frequency}
                  onChange={(e) =>
                    setOverrides((old) => {
                      const next = [...old];
                      next[i] = +e.target.value;
                      return next;
                    })
                  }
                />
              </div>
            ))}
          </div>
        </details>
      </section>
      <section className="control-section">
        <div className="section-number">
          02 <span>THE PEOPLE</span>
        </div>
        <div className="section-heading">
          <h3>
            Select contacts <span className="count-pill">{config.selected.length}</span>
          </h3>
          <button className="text-button" onClick={onAdd}>
            <Plus size={15} />
            Add
          </button>
        </div>
        <div className="selection-actions">
          <button onClick={() => setSelected(eligible.map((c) => c.id))}>Select all</button>
          <span>·</span>
          <button onClick={() => setSelected([])}>Deselect all</button>
        </div>
        <div className="selection-window">
          {eligible.length === 0 ? (
            <div className="empty compact">
              <Users size={25} />
              <h3>Start with someone.</h3>
              <p>Add contacts to give your schedule a personal touch.</p>
              <button className="secondary" onClick={onAdd}>
                Add your first contact <Plus size={16} />
              </button>
            </div>
          ) : (
            eligible.map((c) => (
              <label className="select-row" key={c.id}>
                <Avatar contact={c} />
                <div className="row-copy">
                  <strong>{c.name}</strong>
                  <span>{countries.find((x) => x.id === c.country)?.name}</span>
                </div>
                <LocalClock contact={c} />
                <input
                  type="checkbox"
                  checked={config.selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id),
                    )
                  }
                />
              </label>
            ))
          )}
        </div>
        <p className="fine-print">
          Night owls get a little quiet. Activity drops to 15% between 01:00 and 07:00 in each
          contact’s local time.
        </p>
      </section>
      <section className="control-section">
        <div className="section-number">
          03 <span>THE DETAILS</span>
        </div>
        <details className="disclosure">
          <summary>
            Notification styles <ChevronDown size={16} />
          </summary>
          <div className="distribution">
            {(['message', 'image', 'reply'] as const).map((type) => (
              <label key={type}>
                <span>{type}</span>
                <div>
                  <input
                    aria-label={`${type} percentage`}
                    type="number"
                    min={0}
                    max={100}
                    value={distribution[type]}
                    onChange={(e) => setDistribution({ ...distribution, [type]: +e.target.value })}
                  />
                  <span>%</span>
                </div>
              </label>
            ))}
          </div>
          <p className={sum === 100 ? 'fine-print' : 'error'}>Total {sum}% · must equal 100%.</p>
        </details>
        <div className="estimate">
          <div>
            <span>Estimated maximum</span>
            <strong>
              {total} <small>notifications</small>
            </strong>
          </div>
          <div className="mini-bars">
            {hourlyTargets(config).map((n, i) => (
              <span
                key={i}
                style={{ height: `${12 + n * 0.45}px` }}
                title={`Hour ${i + 1}: ${n}`}
              />
            ))}
          </div>
        </div>
        <p className="fine-print">
          Nighttime reductions can lower this total. All notifications are labeled simulations.
          Delivery timing is controlled by your device and push service.
        </p>
      </section>
      {permission() !== 'granted' && (
        <button
          className="setup-callout"
          onClick={() => {
            void enablePush(data.publicKey)
              .then(refresh)
              .catch((e) => notify(e.message));
          }}
        >
          <Bell size={18} />
          <span>Enable notifications to get started</span>
          <ArrowUpRight size={16} />
        </button>
      )}
      <button
        className="primary start-button"
        disabled={busy || config.selected.length === 0 || sum !== 100}
        onClick={() => void start()}
      >
        {busy ? 'Saving schedule…' : 'Start Session'}
        <ArrowUpRight size={20} />
      </button>
      <div className="control-footnote">
        <Check size={12} /> Your session ends automatically.
      </div>
    </div>
  );
}
