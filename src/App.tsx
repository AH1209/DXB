import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, deviceId } from './api';
import { countries, type Bootstrap, type Contact } from './domain';
import { Access } from './components/Access';
import { Avatar, LocalClock, Logo, Sheet } from './components/UI';
import { ContactForm } from './components/ContactForm';
import { Controller } from './components/Controller';
import { Settings } from './components/Settings';
export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [view, setView] = useState('home');
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [country, setCountry] = useState('');
  const [zone, setZone] = useState('');
  const [filters, setFilters] = useState(false);
  const [edit, setEdit] = useState<Contact | true | null>(null);
  const [detail, setDetail] = useState<Contact | null>(null);
  const [remove, setRemove] = useState(false);
  const [toast, setToast] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const result = await api<Bootstrap>('bootstrap');
      setData(result);
      setAccessError('');
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setData(null);
      throw e;
    }
  }, []);
  useEffect(() => {
    void refresh()
      .then((result) => {
        setSelected(result.settings.selected);
        const id = new URLSearchParams(location.search).get('contact');
        if (id) {
          setDetail(result.contacts.find((c) => c.id === id) || null);
          history.replaceState(null, '', '/');
        }
        navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_BADGE' });
      })
      .catch((e) => {
        if (e.status !== 401) setAccessError(e.message);
      })
      .finally(() => setLoading(false));
  }, [refresh]);
  const savedSelection = JSON.stringify(data?.settings.selected || []);
  useEffect(() => {
    setSelected(JSON.parse(savedSelection) as string[]);
  }, [savedSelection]);
  const authenticated = !!data;
  useEffect(() => {
    if (
      !authenticated ||
      !('serviceWorker' in navigator) ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    )
      return;
    void navigator.serviceWorker
      .getRegistration()
      .then(async (reg) => {
        const subscription = await reg?.pushManager.getSubscription();
        if (subscription)
          await api('subscriptions', 'POST', {
            deviceId: deviceId(),
            subscription: subscription.toJSON(),
          });
      })
      .catch((e) => setToast(e.message));
  }, [authenticated]);
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => {
      void refresh().catch((e) => setToast(e.message));
    }, 15000);
    return () => clearInterval(timer);
  }, [!!data, refresh]);
  useEffect(() => {
    const on = () => {
      setOffline(false);
      if (data) void refresh().catch((e) => setToast(e.message));
    };
    const off = () => setOffline(true);
    const push = (event: MessageEvent) => {
      if (event.data?.type === 'DXB_PUSH' && data) void refresh().catch((e) => setToast(e.message));
      if (event.data?.type === 'DXB_SUBSCRIPTION_CHANGED')
        setToast('Push registration changed. Repair notifications in Settings.');
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    navigator.serviceWorker?.addEventListener('message', push);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      navigator.serviceWorker?.removeEventListener('message', push);
    };
  }, [data, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 9000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function reload() {
    await refresh();
  }
  if (loading)
    return (
      <div className="loading">
        <Logo size={80} />
        <div className="loading-line" />
        <span>Opening your space</span>
      </div>
    );
  if (!data)
    return (
      <Access
        initialError={accessError}
        onUnlock={async () => {
          const result = await refresh();
          setSelected(result.settings.selected);
          setView('home');
        }}
      />
    );
  const visible = data.contacts.filter((c) => {
    const countryName = countries.find((x) => x.id === c.country)?.name || c.country;
    const match = [c.name, countryName, c.city, c.timezone, c.description]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase());
    return (
      match &&
      (!country || c.country === country) &&
      (!zone || c.timezone === zone) &&
      (filter === 'all' ||
        (filter === 'selected' && selected.includes(c.id)) ||
        (filter === 'recent' &&
          c.last_activity &&
          Date.now() - new Date(c.last_activity).getTime() < 86400000))
    );
  });
  const active = data.session?.status === 'active';
  return (
    <MotionConfig reducedMotion="user">
      <div
        className="app-shell"
        style={{ '--accent': data.settings.accent } as React.CSSProperties}
      >
        <aside className="desktop-rail">
          <Logo size={60} />
          <span className="rail-caption">PERSONAL SPACE</span>
          <button
            className={view === 'home' ? 'rail-item active' : 'rail-item'}
            onClick={() => setView('home')}
          >
            <MessageCircle size={20} />
            Contacts <span>{data.contacts.length}</span>
          </button>
          <button
            className={view === 'control' ? 'rail-item active' : 'rail-item'}
            onClick={() => setView('control')}
          >
            <SlidersHorizontal size={20} />
            DXB Control
          </button>
          <div className="rail-bottom">
            <div className="rail-note">
              <span className="status-dot" />
              <span>
                A rhythm of your own.<small>Personal notification simulator</small>
              </span>
            </div>
            <button className="rail-item" onClick={() => setView('settings')}>
              <Settings2 size={20} />
              Settings
            </button>
          </div>
        </aside>
        <main className="main-panel">
          <header className="app-header">
            <div>
              {view === 'home' ? (
                <>
                  <Logo size={38} />
                  <span className="header-label">DXB</span>
                </>
              ) : (
                <button className="back-button" onClick={() => setView('home')}>
                  <ArrowLeft size={19} />
                  <span>{view === 'control' ? 'DXB Control' : 'Settings'}</span>
                </button>
              )}
            </div>
            <div>
              <span className="header-status">
                {active ? 'SESSION ACTIVE' : 'PERSONAL / PRIVATE'}
              </span>
              <button
                className="icon-button"
                aria-label="Add contact"
                onClick={() => setEdit(true)}
              >
                <Plus size={21} />
              </button>
            </div>
          </header>
          {offline && (
            <div role="status" className="offline">
              Offline · Server schedules continue. Reconnect to make changes.
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {view === 'home' ? (
                <div className="home">
                  <div className="home-heading">
                    <div>
                      <div className="eyebrow">YOUR PERSONAL SPACE</div>
                      <h1>
                        Contacts<span className="heading-dot">.</span>
                      </h1>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Filter contacts"
                      onClick={() => setFilters(true)}
                    >
                      <SlidersHorizontal size={20} />
                    </button>
                  </div>
                  <p className="lead">Familiar faces. A rhythm that’s yours.</p>
                  <div className="pinned-label">PINNED</div>
                  <button className="control-contact" onClick={() => setView('control')}>
                    <Logo size={53} />
                    <div>
                      <strong>
                        DXB Control <span className="system-pill">SYSTEM</span>
                      </strong>
                      <p>
                        {active
                          ? 'Your notification session is running'
                          : 'Set the pace of your notifications'}
                      </p>
                    </div>
                    <ArrowUpRight size={21} />
                  </button>
                  <div className="list-heading">
                    <span>
                      YOUR CONTACTS <b>{data.contacts.length.toString().padStart(2, '0')}</b>
                    </span>
                    <button className="text-button" onClick={() => setEdit(true)}>
                      <Plus size={14} />
                      New contact
                    </button>
                  </div>
                  {search && (
                    <motion.div
                      className="search-field"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 52, opacity: 1 }}
                    >
                      <Search size={19} />
                      <input
                        autoFocus
                        type="search"
                        placeholder="Name, city, country…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="Search contacts"
                      />
                      <button
                        className="icon-button"
                        aria-label={query ? 'Clear search' : 'Close search'}
                        onClick={() => (query ? setQuery('') : setSearch(false))}
                      >
                        <X size={18} />
                      </button>
                    </motion.div>
                  )}
                  {visible.length ? (
                    visible.map((c) => (
                      <button className="contact-row" key={c.id} onClick={() => setDetail(c)}>
                        <Avatar contact={c} />
                        <div className="row-copy">
                          <strong>{c.name}</strong>
                          <span>
                            {c.city ? `${c.city}, ` : ''}
                            {countries.find((x) => x.id === c.country)?.name}
                          </span>
                        </div>
                        <div className="row-meta">
                          <LocalClock contact={c} />
                          {c.last_activity && (
                            <small>
                              {new Date(c.last_activity).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                              })}{' '}
                              · simulated
                            </small>
                          )}
                        </div>
                        <ChevronRight size={14} />
                      </button>
                    ))
                  ) : (
                    <div className="empty">
                      <div className="empty-icon">
                        <Users size={28} />
                      </div>
                      <h2>
                        {data.contacts.length
                          ? 'No matching contacts.'
                          : 'A space for your people.'}
                      </h2>
                      <p>
                        {data.contacts.length
                          ? 'Try another name or adjust your filters.'
                          : 'Add your first contact, then head to DXB Control to create your notification session.'}
                      </p>
                      <button
                        className="secondary"
                        onClick={() =>
                          data.contacts.length
                            ? (setQuery(''), setCountry(''), setZone(''), setFilter('all'))
                            : setEdit(true)
                        }
                      >
                        {data.contacts.length ? 'Clear filters' : 'Add a contact'}
                        <Plus size={16} />
                      </button>
                    </div>
                  )}
                  <div className="home-note">
                    <CircleHelp size={15} />
                    <span>
                      Every notification is a simulation.
                      <br />
                      There are no conversations or real messages here.
                    </span>
                  </div>
                </div>
              ) : view === 'control' ? (
                <Controller
                  data={data}
                  selected={selected}
                  setSelected={setSelected}
                  onAdd={() => setEdit(true)}
                  refresh={reload}
                  notify={setToast}
                />
              ) : (
                <Settings
                  data={data}
                  refresh={reload}
                  notify={setToast}
                  onLogout={() => {
                    setData(null);
                    setSelected([]);
                    setDetail(null);
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
          <nav className="bottom-nav" aria-label="Main navigation">
            <button
              className={search && view === 'home' ? 'active' : ''}
              onClick={() => {
                setView('home');
                setSearch(true);
              }}
            >
              <Search size={21} />
              <span>Search</span>
            </button>
            <button
              className={view === 'home' && !search ? 'active' : ''}
              onClick={() => {
                setView('home');
                setSearch(false);
                setQuery('');
              }}
            >
              <Users size={22} />
              <span>Contacts</span>
            </button>
            <button
              className={view === 'settings' ? 'active' : ''}
              onClick={() => setView('settings')}
            >
              <Settings2 size={21} />
              <span>Settings</span>
            </button>
          </nav>
        </main>
        <aside className="desktop-aside">
          <div className="eyebrow">A LITTLE MORE INTENTIONAL</div>
          <h2>
            Your space.
            <br />
            Your rhythm.
          </h2>
          <div className="aside-rule" />
          <p>
            Choose the people.
            <br />
            Find your pace.
            <br />
            Let the day unfold.
          </p>
          <div className="aside-status">
            <span className="status-dot idle" />
            {active ? 'Session active' : 'No active session'}
          </div>
          <span className="aside-bottom">DXB — NOTIFICATION SIMULATOR</span>
        </aside>
        {edit && (
          <ContactForm
            contact={edit === true ? undefined : edit}
            contacts={data.contacts}
            onClose={() => setEdit(null)}
            onSaved={reload}
          />
        )}{' '}
        {detail && (
          <Sheet
            title="Contact details"
            onClose={() => {
              setDetail(null);
              setRemove(false);
            }}
          >
            <div className="contact-profile">
              <Avatar contact={detail} />
              <h2>{detail.name}</h2>
              <p>
                {[detail.city, countries.find((x) => x.id === detail.country)?.name]
                  .filter(Boolean)
                  .join(', ')}
              </p>
              <LocalClock contact={detail} />
              <p>{detail.description}</p>
              {detail.age && <small>Age {detail.age}</small>}
            </div>
            <div className="no-conversation">
              <MessageCircle size={24} />
              <h3>No conversation available</h3>
              <p>This contact appears only in simulated notifications.</p>
            </div>
            {remove ? (
              <div className="form-stack">
                <p className="error">
                  Delete this contact and their pending events? Submitted notifications cannot be
                  recalled.
                </p>
                <button
                  className="danger full"
                  disabled={deleteBusy}
                  onClick={() => {
                    setDeleteBusy(true);
                    void api(`contacts/${detail.id}`, 'DELETE')
                      .then(async () => {
                        setSelected((old) => old.filter((id) => id !== detail.id));
                        setDetail(null);
                        setRemove(false);
                        await reload();
                      })
                      .catch((e) => setToast(e.message))
                      .finally(() => setDeleteBusy(false));
                  }}
                >
                  Delete contact
                </button>
                <button className="secondary" onClick={() => setRemove(false)}>
                  Keep contact
                </button>
              </div>
            ) : (
              <div className="button-stack">
                <button
                  className="secondary"
                  disabled={active}
                  onClick={() => {
                    setEdit(detail);
                    setDetail(null);
                  }}
                >
                  Edit contact
                </button>
                {active && (
                  <small className="muted">Stop your session to edit contact details.</small>
                )}
                <button className="text-button danger-text" onClick={() => setRemove(true)}>
                  Delete contact
                </button>
              </div>
            )}
          </Sheet>
        )}
        {filters && (
          <Sheet title="Filter contacts" onClose={() => setFilters(false)}>
            <div className="form-stack">
              <label>
                Show
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="all">All contacts</option>
                  <option value="recent">Active in the last 24 hours</option>
                  <option value="selected">Selected for notifications</option>
                </select>
              </label>
              <label>
                Country
                <select value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">All countries</option>
                  {countries
                    .filter((c) => data.contacts.some((x) => x.country === c.id))
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Time zone
                <select value={zone} onChange={(e) => setZone(e.target.value)}>
                  <option value="">All time zones</option>
                  {[...new Set(data.contacts.map((c) => c.timezone))].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
              <button className="primary" onClick={() => setFilters(false)}>
                Show contacts
              </button>
            </div>
          </Sheet>
        )}
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
