export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'You are offline. Reconnect to update DXB.');
  }
  const data = await response
    .json()
    .catch(() => ({
      error: 'Backend unavailable. Start with Netlify Dev or configure your Netlify deployment.',
    }));
  if (!response.ok || data.error)
    throw new ApiError(response.status, data.error || 'Request failed');
  return data as T;
}
export function deviceId() {
  let value = localStorage.getItem('dxb-device');
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem('dxb-device', value);
  }
  return value;
}
export function permission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}
export function installed() {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone
  );
}
export async function enablePush(publicKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    throw new Error('Web Push is not supported here. On iPhone, install DXB from Safari first.');
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !installed())
    throw new Error(
      'On iPhone, open Safari → Share → Add to Home Screen, then open DXB from its icon.',
    );
  if (!publicKey || publicKey.startsWith('YOUR_'))
    throw new Error('VAPID keys need to be configured on the server.');
  if (Notification.permission === 'denied')
    throw new Error('Notifications are blocked. Enable them in your device or browser settings.');
  // Permission is requested immediately from the user's click, before asynchronous work.
  const granted =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (granted !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await workerReady();
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const old = subscription.options.applicationServerKey;
    if (old && Array.from(new Uint8Array(old)).join() !== Array.from(key).join()) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await api('subscriptions', 'POST', { deviceId: deviceId(), subscription: subscription.toJSON() });
}

export async function workerReady(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator))
    throw new Error('Service workers are unavailable in this browser.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                'Service worker is not ready. Reload DXB; for local Netlify Dev open /?sw=1.',
              ),
            ),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
