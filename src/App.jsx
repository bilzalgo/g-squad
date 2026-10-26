import { useCallback, useEffect, useMemo, useState } from 'react';
import logo from '../6819650.png';

const navItems = [
  { id: 'overview', label: 'Overview', icon: '◫', permission: 'dashboard:read' },
  { id: 'investors', label: 'Investors', icon: '♙', permission: 'investors:read' },
  { id: 'staff', label: 'Staff', icon: '♧', permission: 'staff:manage', ceoOnly: true },
  { id: 'deposits', label: 'Deposits', icon: '↓', permission: 'payments:read', alsoPermission: 'payments:review' },
  { id: 'withdrawals', label: 'Withdrawals', icon: '↑', permission: 'payments:read', alsoPermission: 'payments:review' },
  { id: 'approvals', label: 'Approvals', icon: '✓', permission: 'payments:review', alsoPermission: 'payments:execute' },
  { id: 'support', label: 'Customer support', icon: '✉', permission: 'support:read', alsoPermission: 'support:respond' },
  { id: 'trading', label: 'Trading', icon: '⌁', permission: 'trading:read' },
  { id: 'activity', label: 'Activity logs', icon: '≡', permission: 'audit:read', ceoOnly: true },
  { id: 'settings', label: 'Settings', icon: '⚙', permission: 'settings:manage', ceoOnly: true },
];

const permissionChoices = [
  ['dashboard:read', 'View dashboard summary'],
  ['investors:read', 'View investors'],
  ['investors:manage', 'Manage investor accounts'],
  ['payments:read', 'View deposits and withdrawals'],
  ['payments:review', 'Review payment requests'],
  ['payments:execute', 'Execute CEO-authorized payment actions'],
  ['support:read', 'View customer-support accounts and notes'],
  ['support:respond', 'Add internal support notes and escalate issues'],
  ['trading:read', 'View trading records'],
  ['trading:manage', 'Manage trading configuration'],
];

export default function App() {
  const [account, setAccount] = useState(undefined);
  const [csrfToken, setCsrfToken] = useState('');
  const [view, setView] = useState('overview');
  const [toast, setToast] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [health, setHealth] = useState(null);
  const [pendingActions, setPendingActions] = useState(0);

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 5000);
  }, []);

  const api = useCallback(async (path, options = {}) => {
    const isAction = !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase());
    const startedAt = performance.now();
    if (isAction) {
      playActionSound();
      setPendingActions((current) => current + 1);
    }
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (csrfToken && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    try {
      const response = await fetch(path, {
        ...options,
        headers,
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
      return data;
    } finally {
      if (isAction) {
        const remainingDisplayTime = Math.max(0, 4000 - (performance.now() - startedAt));
        await new Promise((resolve) => window.setTimeout(resolve, remainingDisplayTime));
        setPendingActions((current) => Math.max(0, current - 1));
      }
    }
  }, [csrfToken]);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    api('/api/auth/session')
      .then((result) => {
        setAccount(result.account);
        setCsrfToken(result.csrfToken || '');
      })
      .catch(() => setAccount(null));
    fetch('/api/health').then((response) => response.json()).then(setHealth).catch(() => setHealth({ database: 'unavailable' }));
  }, [api]);

  const availableNavigation = useMemo(() => navItems.filter((item) => (
    account?.role === 'CEO'
      ? true
      : account?.permissions?.includes(item.permission) || item.alsoPermission && account?.permissions?.includes(item.alsoPermission)
  )), [account]);
  const activeView = availableNavigation.some((item) => item.id === view)
    ? view
    : availableNavigation[0]?.id || '';
  useEffect(() => {
    if (account && activeView !== view) setView(activeView);
  }, [account, activeView, view]);

  if (account === undefined) return <ScreenLoading />;
  if (!account) {
    return (
      <>
        <Login api={api} health={health} onLogin={(result) => {
          setAccount(result.account);
          setCsrfToken(result.csrfToken);
          setView('overview');
        }} notify={notify} />
        {pendingActions > 0 && <ActionLoadingOverlay />}
        <Toast toast={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      setAccount(null);
      setCsrfToken('');
      setView('overview');
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand logo={logo} />
        <div className="workspace-caption">WORKSPACE</div>
        <nav className="nav flex-column gap-1" aria-label="Admin navigation">
          {availableNavigation.map((item) => (
            <button
              className={`nav-link side-link ${activeView === item.id ? 'active' : ''}`}
              key={item.id}
              onClick={() => setView(item.id)}
            >
              <span className="side-icon">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="connection-dot" />
          <span>{health?.database === 'connected' ? 'Database connected' : 'Database setup required'}</span>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><Brand logo={logo} compact /></div>
          <div className="topbar-spacer" />
          <NotificationBell api={api} setView={setView} notify={notify} />
          <div className="signed-in">
            <span className="status-dot" />
            <span className="signed-name">{account.displayName}</span>
            <span className="role-pill">{account.role}</span>
          </div>
          <button className="btn btn-sm btn-outline-secondary signout" onClick={signOut}>Sign out</button>
        </header>
        <div className="content-wrap">
          <Page
            view={activeView}
            account={account}
            api={api}
            refreshKey={refreshKey}
            refresh={refresh}
            notify={notify}
            setView={setView}
          />
        </div>
      </main>
      {pendingActions > 0 && <ActionLoadingOverlay />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function playActionSound() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return;

  let audioContext;
  try {
    audioContext = new AudioContextConstructor();
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const start = audioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.setValueAtTime(1175, start + 0.09);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(0.4, start + 0.01);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.26);
    oscillator.addEventListener('ended', () => audioContext.close(), { once: true });
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch((error) => console.error('Unable to enable the action sound.', error));
    }
  } catch (error) {
    if (audioContext) void audioContext.close();
    console.error('Unable to play the action sound.', error);
  }
}

function ActionLoadingOverlay() {
  return (
    <div className="action-loading-overlay" role="status" aria-live="polite">
      <div className="action-loading-message">
        <span className="spinner-border text-warning" aria-hidden="true" />
        <span>Waiting for the server to finish…</span>
      </div>
    </div>
  );
}

function NotificationBell({ api, setView, notify }) {
  const [open, setOpen] = useState(false);
  const { data, loading, error, reload } = useLoad(api, '/api/notifications', 0);
  const notifications = data?.notifications || [];
  const unread = notifications.filter((item) => !item.readAt).length;

  const openNotification = async (item) => {
    try {
      if (!item.readAt) {
        await api(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
          method: 'POST',
          body: '{}',
        });
        reload();
      }
      if (item.relatedType === 'approval_request') setView('approvals');
      if (item.relatedType === 'support_note') setView('support');
      setOpen(false);
    } catch (requestError) {
      notify(requestError.message, 'danger');
    }
  };

  return (
    <div className="notification-center">
      <button className="btn btn-sm btn-outline-secondary notification-toggle" aria-expanded={open}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen((value) => !value)}>
        Notifications{unread > 0 && <span className="notification-count">{unread}</span>}
      </button>
      {open && <section className="notification-popover" aria-label="Notifications">
        <div className="notification-heading"><strong>Notifications</strong><span>{unread} unread</span></div>
        {loading ? <PageLoading label="Loading notifications…" />
          : error ? <ErrorCard error={error} />
            : notifications.length ? notifications.map((item) => (
              <button className={`notification-item ${item.readAt ? '' : 'unread'}`} key={item.id}
                onClick={() => openNotification(item)}>
                <span>{item.message}</span>
                <small>{formatDate(item.createdAt)} · {item.relatedType?.replaceAll('_', ' ') || 'Update'}</small>
              </button>
            )) : <EmptyState text="No notifications yet." />}
      </section>}
    </div>
  );
}

function Brand({ logo: mark, compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <img src={mark} alt="" className="brand-mark" />
      {!compact && <div><strong>G-Squad</strong><span>ADMIN CONSOLE</span></div>}
    </div>
  );
}

function Login({ api, health, onLogin, notify }) {
  const [step, setStep] = useState('account');
  const [accountId, setAccountId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const continueWithAccount = (event) => {
    event.preventDefault();
    setStep('setup');
    setError('');
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ accountId: accountId.trim(), code }),
      }));
    } catch (requestError) {
      setError(requestError.message);
      notify(requestError.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-card">
        <Brand logo={logo} />
        <div className="login-heading">
          <span className="eyebrow">ADMINISTRATOR ACCESS</span>
          <h1>{step === 'account' ? 'Welcome back' : step === 'setup' ? 'Set up authenticator' : 'Verify your identity'}</h1>
          <p>{step === 'account'
            ? 'Enter your admin account ID to continue.'
            : step === 'setup'
              ? 'Use your one-time setup code to securely register Google Authenticator.'
              : 'Enter the six-digit code from Google Authenticator to sign in.'}</p>
        </div>
        {health?.database !== 'connected' && (
          <div className="alert alert-warning setup-alert" role="status">
            Database {health?.database === 'not_configured' ? 'is not configured' : 'is not connected'}.
            Configure <code>DATABASE_URL</code> and apply the database migration to enable sign-in.
          </div>
        )}
        {step === 'account' ? <form onSubmit={continueWithAccount}>
          <label className="form-label" htmlFor="account-id">Admin account ID</label>
          <input id="account-id" className="form-control form-control-lg mb-3" autoComplete="username"
            pattern="[A-Za-z0-9_-]{3,40}" title="Use 3-40 letters, numbers, underscores, or hyphens."
            value={accountId} onChange={(event) => setAccountId(event.target.value)} required maxLength={40} />
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-lg w-100 login-submit">Continue</button>
        </form> : step === 'setup' ? <Enrollment api={api} accountId={accountId} notify={notify}
          onCancel={() => setStep('login')}
          onComplete={() => {
            setCode('');
            setStep('login');
          }} /> : <>
          <div className="setup-alert mb-3">Signing in as <strong>{accountId}</strong></div>
          <form onSubmit={submit}>
            <label className="form-label" htmlFor="totp-code">Six-digit authenticator code</label>
            <input id="totp-code" className="form-control form-control-lg code-input" inputMode="numeric"
              autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-lg w-100 login-submit" disabled={busy || code.length !== 6}>
              {busy ? <><span className="spinner-border spinner-border-sm me-2" />Verifying…</> : 'Sign in securely'}
            </button>
          </form>
          <button className="btn btn-link w-100 mt-3 p-1 enrollment-link" onClick={() => {
            setStep('setup');
            setCode('');
            setError('');
          }}>First time? Set up authenticator</button>
          <button className="btn btn-link w-100 p-1 enrollment-link" onClick={() => {
            setStep('account');
            setCode('');
            setError('');
          }}>Use a different account ID</button>
        </>}
        <div className="login-footnote">Admin access is protected with time-based one-time codes. There is no password login.</div>
      </section>
      <div className="login-bottom">G-Squad · Secure administration</div>
      <Toast toast={null} onClose={() => {}} />
    </div>
  );
}

function Enrollment({ api, accountId, notify, onCancel, onComplete }) {
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSetup(await api('/api/enrollment/start', {
        method: 'POST',
        body: JSON.stringify({ accountId: accountId.trim(), enrollmentToken }),
      }));
    } catch (requestError) {
      setError(requestError.message);
      notify(requestError.message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  const complete = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/enrollment/complete', {
        method: 'POST',
        body: JSON.stringify({ accountId: accountId.trim(), enrollmentToken, code }),
      });
      notify('Authenticator enrolled. Wait for the next six-digit code, then sign in.');
      onComplete();
    } catch (requestError) {
      setError(requestError.message);
      notify(requestError.message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {!setup ? <form onSubmit={start}>
        <div className="alert alert-info setup-alert">
          Account ID: <strong>{accountId}</strong>. Enter the one-time setup code issued for this account.
          The code is required before the authenticator secret can be displayed.
        </div>
        <label className="form-label" htmlFor="enroll-token">One-time setup code</label>
        <input id="enroll-token" className="form-control" autoComplete="off" autoCapitalize="none" spellCheck={false}
          value={enrollmentToken} onChange={(event) => setEnrollmentToken(event.target.value)} required />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn btn-primary w-100 mt-3" disabled={busy}>{busy ? 'Preparing enrollment…' : 'Continue enrollment'}</button>
        <button type="button" className="btn btn-link w-100 mt-2 p-1 enrollment-link" onClick={onCancel}>Back to sign in</button>
      </form> : <form onSubmit={complete}>
        <div className="alert alert-warning setup-alert">
          Add this secret to Google Authenticator now. It is displayed once and will not be shown again.
        </div>
        <label className="form-label">Authenticator secret</label>
        <div className="enrollment-secret">{setup.secret}</div>
        <p className="small text-secondary mt-2">Or import this provisioning URI in your authenticator app:</p>
        <code className="provisioning-uri">{setup.provisioningUri}</code>
        <label className="form-label mt-3" htmlFor="enroll-totp-code">Current six-digit authenticator code</label>
        <input id="enroll-totp-code" className="form-control code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn btn-primary w-100 mt-3" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and finish setup'}</button>
      </form>}
    </div>
  );
}

function Page({ view, account, api, refreshKey, refresh, notify, setView }) {
  const title = navItems.find((item) => item.id === view)?.label || 'Overview';
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">G-SQUAD / ADMIN</span><h1>{title}</h1></div>
        <div className="page-date">{new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date())}</div>
      </div>
      {view === 'overview' && <Overview api={api} refreshKey={refreshKey} setView={setView} />}
      {view === 'staff' && <Staff api={api} refreshKey={refreshKey} notify={notify} />}
      {view === 'investors' && <Investors api={api} refreshKey={refreshKey} notify={notify} account={account} />}
      {['deposits', 'withdrawals'].includes(view) && <Transactions api={api} refreshKey={refreshKey} kind={view === 'deposits' ? 'deposit' : 'withdrawal'} account={account} notify={notify} />}
      {view === 'approvals' && <Approvals api={api} refreshKey={refreshKey} account={account} notify={notify} />}
      {view === 'support' && <Support api={api} refreshKey={refreshKey} account={account} notify={notify} />}
      {view === 'trading' && <Trading api={api} refreshKey={refreshKey} />}
      {view === 'activity' && <Activity api={api} refreshKey={refreshKey} />}
      {view === 'settings' && <Settings api={api} refreshKey={refreshKey} notify={notify} />}
      {!navItems.some((item) => item.id === view) && <div className="empty-card">This section is not available.</div>}
      <div className="page-bottom">Signed in as <strong>{account.displayName}</strong> · Administrative actions are recorded.</div>
    </>
  );
}

function Overview({ api, refreshKey, setView }) {
  const { data, loading, error } = useLoad(api, '/api/dashboard', refreshKey);
  if (loading) return <PageLoading label="Loading verified application data…" />;
  if (error) return <ErrorCard error={error} />;
  const metrics = data.metrics;
  const cards = [
    ['Investors', metrics.totalInvestors, `${metrics.activeInvestors} active · ${metrics.suspendedInvestors} suspended`, '♙'],
    ['Staff accounts', metrics.totalStaff, `${metrics.activeStaff} active · ${metrics.revokedStaff} revoked / suspended`, '♧'],
    ['Pending deposits', metrics.pendingDeposits, 'Awaiting review or resolution', '↓'],
    ['Pending withdrawals', metrics.pendingWithdrawals, 'Funds in review or processing', '↑'],
    ['CEO decisions', metrics.pendingApprovals, `${metrics.approvalsForDeposits} deposits · ${metrics.approvalsForWithdrawals} withdrawals`, '✓'],
    ['Completed transactions', metrics.completedTransactions, 'Deposits credited · withdrawals paid', '✓'],
    ['Rejected transactions', metrics.rejectedTransactions, 'Rejected, failed, or expired', '×'],
    ['Recorded trades', metrics.recordedTrades, 'From persisted trade records', '⌁'],
    ['Wallet liabilities', money(metrics.walletLiabilities), 'Available plus reserved balances', '$'],
    ['Reserved obligations', money(metrics.reservedWalletBalance), 'Funds reserved for withdrawals', '↗'],
    ['Security events', metrics.securityEvents24h, 'Failed or denied actions · last 24 hours', '!'],
  ];
  return (
    <>
      {data.notice.enabled && data.notice.message && <div className="integration-banner">
        <div className="integration-mark">i</div>
        <div><strong>CEO dashboard notice</strong><p>{data.notice.message}</p></div>
      </div>}
      <div className="integration-banner">
        <div className="integration-mark">!</div>
        <div><strong>Trading is unavailable</strong><p>The trading engine and Deriv integration are not connected. This dashboard does not report simulated trades.</p></div>
        <button className="btn btn-sm btn-outline-dark" onClick={() => setView('trading')}>View status</button>
      </div>
      <div className="row g-3 metric-grid">
        {cards.map(([label, value, detail, icon]) => (
          <div className="col-12 col-sm-6 col-xl-3" key={label}>
            <div className="metric-card">
              <div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div>
              <div className="metric-value">{value ?? 0}</div><div className="metric-detail">{detail}</div>
            </div>
          </div>
        ))}
      </div>
      <section className="surface-card mt-4">
        <div className="section-heading"><div><h2>Recent administrative activity</h2><p>Latest records from the audit log</p></div><button className="text-action" onClick={() => setView('activity')}>View logs <span>→</span></button></div>
        <AuditRows rows={data.recentAudit} />
      </section>
    </>
  );
}

function Staff({ api, refreshKey, notify }) {
  const { data, loading, error, reload } = useLoad(api, '/api/staff', refreshKey);
  const [displayName, setDisplayName] = useState('');
  const [selected, setSelected] = useState([]);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState(null);
  const [historyStaff, setHistoryStaff] = useState(null);

  const togglePermission = (permission) => setSelected((current) => (
    current.includes(permission) ? current.filter((entry) => entry !== permission) : [...current, permission]
  ));

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api('/api/staff', {
        method: 'POST',
        body: JSON.stringify({ displayName, permissions: selected }),
      });
      setCreated(result);
      setDisplayName('');
      setSelected([]);
      notify('Staff account created. Securely deliver the one-time enrollment code.');
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const update = async (staff, nextAction) => {
    const explanation = window.prompt(`Confirm ${nextAction} for ${staff.displayName}. Enter the reason:`);
    if (!explanation) return;
    try {
      const result = await api(`/api/staff/${encodeURIComponent(staff.accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: nextAction, reason: explanation }),
      });
      if (result.enrollmentToken) setCreated(result);
      notify(`Staff account ${nextAction === 'restore' ? 'restored' : nextAction === 'permissions' ? 'updated' : nextAction} successfully.`);
      setAction(null);
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    }
  };

  if (loading) return <PageLoading label="Loading staff records…" />;
  if (error) return <ErrorCard error={error} />;
  return (
    <div className="row g-4 align-items-start">
      <div className="col-12 col-xl-7">
        <section className="surface-card">
          <div className="section-heading"><div><h2>Staff accounts</h2><p>{data.staff.length} staff identities</p></div></div>
          <DataTable columns={['Name / account ID', 'Status', 'Permissions', 'Actions']} empty="No staff accounts have been created.">
            {data.staff.map((staff) => (
              <tr key={staff.accountId}>
                <td><strong>{staff.displayName}</strong><small>{staff.accountId}</small></td>
                <td><StatusBadge status={staff.status} /></td>
                <td><span className="permission-count">{staff.permissions.length} assigned</span></td>
                <td><div className="table-actions">
                  {staff.status === 'active' && <button className="btn btn-sm btn-outline-danger" onClick={() => update(staff, 'revoke')}>Revoke</button>}
                  {['revoked', 'suspended'].includes(staff.status) && <button className="btn btn-sm btn-outline-success" onClick={() => update(staff, 'restore')}>Restore</button>}
                  {['active', 'enrollment_pending'].includes(staff.status) && <button className="btn btn-sm btn-outline-warning" onClick={() => update(staff, 'replace_authenticator')}>
                    {staff.status === 'active' ? 'Replace authenticator' : 'Regenerate enrollment'}
                  </button>}
                  {staff.status === 'active' && <button className="btn btn-sm btn-outline-danger" onClick={() => update(staff, 'deactivate')}>Deactivate</button>}
                  {!['deactivated'].includes(staff.status) && <button className="btn btn-sm btn-light" onClick={() => setAction(staff)}>Permissions</button>}
                  <button className="btn btn-sm btn-light" onClick={() => setHistoryStaff(staff)}>History</button>
                </div></td>
              </tr>
            ))}
          </DataTable>
        </section>
      </div>
      <div className="col-12 col-xl-5">
        <section className="surface-card create-staff-card">
          <div className="section-heading"><div><h2>Create staff account</h2><p>Each staff member uses an individual authenticator.</p></div></div>
          {created && (
            <div className="alert alert-success">
              <strong>{created.staff.displayName} · {created.staff.accountId}</strong>
              <p className="mt-2 mb-2">{created.warning || `Deliver this single-use enrollment code through a secure channel. It expires in ${created.enrollmentExpiresInHours} hours.`}</p>
              <div className="enrollment-code">{created.enrollmentToken}</div>
              <button className="btn btn-sm btn-outline-success mt-2" onClick={() => {
                navigator.clipboard.writeText(created.enrollmentToken).then(() => notify('Enrollment code copied.'));
              }}>Copy code</button>
              <button className="btn btn-sm btn-link" onClick={() => setCreated(null)}>Dismiss</button>
            </div>
          )}
          <form onSubmit={create}>
            <label className="form-label" htmlFor="staff-name">Staff display name</label>
            <input id="staff-name" className="form-control mb-3" required minLength={2} maxLength={80}
              value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <label className="form-label">Permissions</label>
            <div className="permission-list">
              {permissionChoices.map(([value, label]) => (
                <label className="form-check permission-item" key={value}>
                  <input className="form-check-input" type="checkbox" checked={selected.includes(value)}
                    onChange={() => togglePermission(value)} />
                  <span className="form-check-label">{label}</span>
                </label>
              ))}
            </div>
            <button className="btn btn-primary w-100 mt-3" disabled={busy}>
              {busy ? 'Creating account…' : 'Create staff account'}
            </button>
          </form>
        </section>
      </div>
      {action && <PermissionModal staff={action} api={api} onClose={() => setAction(null)} notify={notify} reload={reload} />}
      {historyStaff && <StaffActivityModal staff={historyStaff} api={api} onClose={() => setHistoryStaff(null)} />}
    </div>
  );
}

function StaffActivityModal({ staff, api, onClose }) {
  const { data, loading, error } = useLoad(
    api,
    `/api/staff/${encodeURIComponent(staff.accountId)}/activity`,
    0,
  );
  return (
    <div className="modal-backdrop-custom" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog-card staff-history-dialog" role="dialog" aria-modal="true" aria-labelledby="staff-history-title">
        <div className="section-heading">
          <div><h2 id="staff-history-title">Action history · {staff.displayName}</h2><p>{staff.accountId} · Latest 250 recorded actions</p></div>
          <button className="icon-close" onClick={onClose} aria-label="Close history">×</button>
        </div>
        {loading ? <PageLoading label="Loading staff action history…" /> : error ? <ErrorCard error={error} /> : (
          <DataTable columns={['Action', 'Result', 'Details', 'Time']} empty="No actions have been recorded for this staff account.">
            {data.events.map((event) => (
              <tr key={event.id}>
                <td><strong>{event.actionType}</strong><small>Request {event.requestId.slice(0, 8)}</small></td>
                <td><StatusBadge status={event.result} /></td>
                <td><details><summary>View details</summary><pre className="audit-details">{JSON.stringify(event.details, null, 2)}</pre></details></td>
                <td>{formatDate(event.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  );
}

function PermissionModal({ staff, api, onClose, notify, reload }) {
  const [selected, setSelected] = useState(staff.permissions || []);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`/api/staff/${encodeURIComponent(staff.accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'permissions', permissions: selected, reason }),
      });
      notify('Staff permissions updated.');
      reload();
      onClose();
    } catch (error) {
      notify(error.message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop-custom" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="permission-title">
        <div className="section-heading"><div><h2 id="permission-title">Permissions · {staff.displayName}</h2><p>Changes are recorded in the activity log.</p></div><button className="icon-close" onClick={onClose}>×</button></div>
        <div className="permission-list">
          {permissionChoices.map(([value, label]) => (
            <label className="form-check permission-item" key={value}>
              <input className="form-check-input" type="checkbox" checked={selected.includes(value)}
                onChange={() => setSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />
              <span className="form-check-label">{label}</span>
            </label>
          ))}
        </div>
        <label className="form-label mt-3" htmlFor="permission-reason">Reason</label>
        <textarea className="form-control" id="permission-reason" rows="2" value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="dialog-actions"><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy || reason.trim().length < 3}>{busy ? 'Saving…' : 'Save permissions'}</button></div>
      </div>
    </div>
  );
}

function Investors({ api, refreshKey, notify, account }) {
  const { data, loading, error, reload } = useLoad(api, '/api/investors', refreshKey);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [profile, setProfile] = useState(null);
  const [editingProfile, setEditingProfile] = useState(null);
  if (loading) return <PageLoading label="Loading investor records…" />;
  if (error) return <ErrorCard error={error} />;
  const investors = data.investors.filter((investor) => (
    `${investor.displayName} ${investor.accountId} ${investor.username || ''} ${investor.email || ''}`
      .toLowerCase().includes(query.toLowerCase())
  ));
  const changeStatus = async (investor, action) => {
    const actionLabel = { suspend: 'Suspend', reactivate: 'Reactivate', deactivate: 'Deactivate' }[action];
    if (!window.confirm(`${actionLabel} ${investor.displayName}?`)) return;
    const reason = window.prompt('Enter the reason for this account change:');
    if (!reason?.trim()) return;
    try {
      await api(`/api/investors/${encodeURIComponent(investor.accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, reason }),
      });
      notify(`Investor account ${action === 'suspend' ? 'suspended' : action === 'deactivate' ? 'deactivated' : 'reactivated'}.`);
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    }
  };
  const anonymize = async (investor) => {
    if (!window.confirm(`Delete and anonymize ${investor.displayName} (${investor.accountId})? Financial and audit records will be retained. This cannot be undone.`)) return;
    const confirmation = window.prompt(`Type the exact investor account ID ${investor.accountId} to confirm anonymization.`);
    if (confirmation !== investor.accountId) {
      if (confirmation !== null) notify('Investor account ID did not match. No changes were made.', 'danger');
      return;
    }
    const reason = window.prompt('Enter the reason for deleting and anonymizing this account:');
    if (!reason?.trim()) return;
    try {
      await api(`/api/investors/${encodeURIComponent(investor.accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'delete', reason }),
      });
      notify('Investor account anonymized. Financial and audit history was retained.');
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    }
  };
  return (
    <section className="surface-card">
      <div className="section-heading"><div><h2>Investor accounts</h2><p>Live database records only. Wallet adjustments are ledger-based and recorded with an audit trail.</p></div></div>
      <input className="form-control investor-search" placeholder="Search investor name, account ID, username, or email" value={query} onChange={(event) => setQuery(event.target.value)} />
      <DataTable columns={['Investor', 'Status', 'Available balance', 'Reserved', 'Joined', 'Actions']} empty="No investor accounts are recorded.">
        {investors.map((investor) => (
          <tr key={investor.accountId}>
            <td><strong>{investor.displayName}</strong><small>{investor.accountId}</small>{investor.email && <small>{investor.email}</small>}</td>
            <td><StatusBadge status={investor.anonymizedAt ? 'deleted' : investor.status} /></td>
            <td>{money(investor.availableBalance)}</td><td>{money(investor.reservedBalance)}</td>
            <td>{formatDate(investor.createdAt)}</td>
            <td><div className="table-actions">
              <button className="btn btn-sm btn-light" onClick={() => setProfile(investor)}>View</button>
              {account.role === 'CEO' && <>
                {!investor.anonymizedAt && <button className="btn btn-sm btn-light" onClick={() => setEditingProfile(investor)}>Edit</button>}
                {!investor.anonymizedAt && <>
                  <button className="btn btn-sm btn-outline-success" onClick={() => setSelected({ investor, operation: 'credit' })}>Add</button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelected({ investor, operation: 'debit' })}>Deduct</button>
                </>}
                {investor.status === 'active'
                  ? <button className="btn btn-sm btn-outline-danger" onClick={() => changeStatus(investor, 'suspend')}>Suspend</button>
                  : ['suspended', 'deactivated'].includes(investor.status) && !investor.anonymizedAt && <button className="btn btn-sm btn-outline-success" onClick={() => changeStatus(investor, 'reactivate')}>Reactivate</button>}
                {!investor.anonymizedAt && investor.status !== 'deactivated' && <button className="btn btn-sm btn-outline-danger" onClick={() => changeStatus(investor, 'deactivate')}>Deactivate</button>}
                {!investor.anonymizedAt && <button className="btn btn-sm btn-danger" onClick={() => anonymize(investor)}>Delete</button>}
              </>}
            </div></td>
          </tr>
        ))}
      </DataTable>
      {selected && <WalletAdjustment investor={selected.investor} operation={selected.operation} api={api}
        onClose={() => setSelected(null)} notify={notify} reload={reload} />}
      {profile && <InvestorProfileModal investor={profile} api={api} onClose={() => setProfile(null)} />}
      {editingProfile && <InvestorProfileEditor investor={editingProfile} api={api} notify={notify}
        onClose={() => setEditingProfile(null)} onSaved={() => { setEditingProfile(null); reload(); }} />}
    </section>
  );
}

function Support({ api, refreshKey, account, notify }) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const [escalated, setEscalated] = useState(false);
  const [busy, setBusy] = useState(false);
  const investorsPath = `/api/support/investors?q=${encodeURIComponent(search)}`;
  const investors = useLoad(api, investorsPath, refreshKey);
  const notes = useLoad(
    api,
    `/api/support/notes?accountId=${encodeURIComponent(selectedId)}`,
    refreshKey,
  );
  const canRespond = account.role === 'CEO' || account.permissions?.includes('support:respond');

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    try {
      await api(`/api/support/investors/${encodeURIComponent(selectedId)}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note, escalated }),
      });
      setNote('');
      setEscalated(false);
      notes.reload();
      notify(escalated ? 'Support note recorded and escalated to the CEO.' : 'Support note recorded.');
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (investors.loading && !investors.data) return <PageLoading label="Loading support accounts…" />;
  if (investors.error) return <ErrorCard error={investors.error} />;
  const selectedInvestor = investors.data.investors.find((item) => item.accountId === selectedId);

  return (
    <div className="row g-4 align-items-start">
      <div className="col-12 col-xl-5">
        <section className="surface-card">
          <div className="section-heading"><div><h2>Customer support</h2><p>Internal account notes; no external ticket inbox is connected.</p></div></div>
          <label className="form-label" htmlFor="support-search">Find investor</label>
          <input id="support-search" className="form-control mb-3" value={search}
            onChange={(event) => setSearch(event.target.value)} placeholder="Search name or account ID" />
          <DataTable columns={['Investor', 'Status', '']} empty="No matching investor accounts.">
            {investors.data.investors.map((investor) => (
              <tr key={investor.accountId} className={selectedId === investor.accountId ? 'table-active' : ''}>
                <td><strong>{investor.displayName}</strong><small>{investor.accountId}</small></td>
                <td><StatusBadge status={investor.status} /></td>
                <td><button className="btn btn-sm btn-light" onClick={() => setSelectedId(investor.accountId)}>Open</button></td>
              </tr>
            ))}
          </DataTable>
        </section>
      </div>
      <div className="col-12 col-xl-7">
        <section className="surface-card">
          <div className="section-heading"><div><h2>{selectedInvestor ? selectedInvestor.displayName : 'Support notes'}</h2>
            <p>{selectedInvestor ? selectedInvestor.accountId : 'Select an investor to review internal notes.'}</p></div></div>
          {selectedId && (notes.loading ? <PageLoading label="Loading support notes…" />
            : notes.error ? <ErrorCard error={notes.error} />
              : <DataTable columns={['Note', 'Author', 'Created']} empty="No internal notes are recorded for this investor.">
                {notes.data.notes.map((item) => (
                  <tr key={item.id}><td>{item.note}{item.escalated && <small className="text-danger">Escalated to CEO</small>}</td>
                    <td>{item.authorName}<small>{item.authorAccountId}</small></td><td>{formatDate(item.createdAt)}</td></tr>
                ))}
              </DataTable>)}
          {canRespond && selectedId && <form className="mt-3" onSubmit={submit}>
            <label className="form-label" htmlFor="support-note">Internal note</label>
            <textarea id="support-note" className="form-control" value={note}
              onChange={(event) => setNote(event.target.value)} rows="4" minLength={1} maxLength={4000} required />
            <label className="form-check mt-3">
              <input className="form-check-input" type="checkbox" checked={escalated}
                onChange={(event) => setEscalated(event.target.checked)} />
              <span className="form-check-label">Escalate this issue to the CEOs</span>
            </label>
            <button className="btn btn-primary mt-3" disabled={busy || !note.trim()}>
              {busy ? 'Saving…' : 'Save support note'}
            </button>
          </form>}
        </section>
      </div>
    </div>
  );
}

function InvestorProfileEditor({ investor, api, notify, onClose, onSaved }) {
  const [profile, setProfile] = useState({
    displayName: investor.displayName || '',
    username: investor.username || '',
    email: investor.email || '',
    phone: investor.phone || '',
    country: investor.country || '',
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (key, value) => setProfile((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/investors/${encodeURIComponent(investor.accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'edit_profile', ...profile, reason }),
      });
      notify('Investor profile saved and audited.');
      onSaved();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return <div className="modal-backdrop-custom" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="investor-edit-title">
      <div className="section-heading">
        <div><h2 id="investor-edit-title">Edit investor profile</h2><p>{investor.accountId}</p></div>
        <button className="icon-close" onClick={onClose} aria-label="Close profile editor">×</button>
      </div>
      <form onSubmit={save}>
        <div className="row g-3">
          <ProfileInput id="investor-display-name" label="Display name" value={profile.displayName} onChange={(value) => update('displayName', value)} maxLength={80} required />
          <ProfileInput id="investor-username" label="Username" value={profile.username} onChange={(value) => update('username', value)} maxLength={40} />
          <ProfileInput id="investor-email" label="Email" type="email" value={profile.email} onChange={(value) => update('email', value)} maxLength={254} />
          <ProfileInput id="investor-phone" label="Phone" value={profile.phone} onChange={(value) => update('phone', value)} maxLength={32} />
          <ProfileInput id="investor-country" label="Country" value={profile.country} onChange={(value) => update('country', value)} maxLength={80} />
          <div className="col-12">
            <label className="form-label" htmlFor="investor-profile-reason">Reason for change</label>
            <textarea id="investor-profile-reason" className="form-control" rows="2" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required />
          </div>
        </div>
        <div className="dialog-actions">
          <button className="btn btn-light" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || reason.trim().length < 3}>{busy ? 'Saving…' : 'Save profile'}</button>
        </div>
      </form>
    </div>
  </div>;
}

function ProfileInput({ id, label, type = 'text', value, onChange, maxLength, required = false }) {
  return <div className="col-12 col-md-6">
    <label className="form-label" htmlFor={id}>{label}</label>
    <input id={id} className="form-control" type={type} value={value}
      onChange={(event) => onChange(event.target.value)} maxLength={maxLength} required={required} />
  </div>;
}

function InvestorProfileModal({ investor, api, onClose }) {
  const [pages, setPages] = useState({ deposits: 1, withdrawals: 1, ledger: 1, activity: 1 });
  const query = new URLSearchParams({
    depositsPage: String(pages.deposits),
    withdrawalsPage: String(pages.withdrawals),
    ledgerPage: String(pages.ledger),
    activityPage: String(pages.activity),
  });
  const { data, loading, error } = useLoad(
    api,
    `/api/investors/${encodeURIComponent(investor.accountId)}?${query}`,
    0,
  );
  return (
    <div className="modal-backdrop-custom" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog-card profile-dialog" role="dialog" aria-modal="true" aria-labelledby="investor-profile-title">
        <div className="section-heading">
          <div><h2 id="investor-profile-title">{investor.displayName} · {investor.accountId}</h2><p>Investor profile, financial history, and recorded activity</p></div>
          <button className="icon-close" onClick={onClose} aria-label="Close investor details">×</button>
        </div>
        {loading ? <PageLoading label="Loading investor history…" /> : error ? <ErrorCard error={error} /> : (
          <>
            <div className="row g-2 mb-3">
              <div className="col-6"><div className="balance-preview"><div><span>Available</span><strong>{money(data.investor.availableBalance)}</strong></div></div></div>
              <div className="col-6"><div className="balance-preview"><div><span>Reserved</span><strong>{money(data.investor.reservedBalance)}</strong></div></div></div>
              <div className="col-6"><div className="balance-preview"><div><span>Status</span><strong><StatusBadge status={data.investor.status} /></strong></div></div></div>
              <div className="col-6"><div className="balance-preview"><div><span>Joined</span><strong>{formatDate(data.investor.createdAt)}</strong></div></div></div>
            </div>
            <div className="balance-preview mb-3">
              <div><span>Username</span><strong>{data.investor.username || '—'}</strong></div>
              <div><span>Email</span><strong>{data.investor.email || '—'}</strong></div>
              <div><span>Phone</span><strong>{data.investor.phone || '—'}</strong></div>
              <div><span>Country</span><strong>{data.investor.country || '—'}</strong></div>
            </div>
            <h3 className="history-heading">Deposits</h3>
            <DataTable columns={['Transaction', 'Amount', 'Currency', 'Status', 'Created']} empty="No deposits recorded.">
              {data.deposits.map((item) => <tr key={item.id}><td>{item.id}</td><td>{money(item.amountUsd)}</td><td>{item.currency}<small>{item.providerReference || 'No provider reference'}</small></td><td><StatusBadge status={item.status} /></td><td>{formatDate(item.createdAt)}</td></tr>)}
            </DataTable>
            <HistoryPagination pagination={data.historyPagination.deposits} onPageChange={(page) => setPages((current) => ({ ...current, deposits: page }))} />
            <h3 className="history-heading">Withdrawals</h3>
            <DataTable columns={['Transaction', 'Amount', 'Destination', 'Status', 'Created']} empty="No withdrawals recorded.">
              {data.withdrawals.map((item) => <tr key={item.id}><td>{item.id}</td><td>{money(item.amountUsd)}</td><td>{item.network}<small className="destination">{item.destination}</small></td><td><StatusBadge status={item.status} /></td><td>{formatDate(item.createdAt)}</td></tr>)}
            </DataTable>
            <HistoryPagination pagination={data.historyPagination.withdrawals} onPageChange={(page) => setPages((current) => ({ ...current, withdrawals: page }))} />
            <h3 className="history-heading">Wallet ledger</h3>
            <DataTable columns={['Reference', 'Amount', 'Available after', 'Entry', 'Reason / actor', 'Created']} empty="No wallet ledger entries recorded.">
              {data.ledger.map((item) => <tr key={item.reference}><td>{item.reference}</td><td>{money(item.amount)}</td><td>{money(item.availableAfter)}</td><td>{item.entryType}</td><td>{item.reason}<small>{item.actor || 'System'}</small></td><td>{formatDate(item.createdAt)}</td></tr>)}
            </DataTable>
            <HistoryPagination pagination={data.historyPagination.ledger} onPageChange={(page) => setPages((current) => ({ ...current, ledger: page }))} />
            <h3 className="history-heading">Account activity</h3>
            <DataTable columns={['Actor', 'Action', 'Result', 'Details', 'Time']} empty="No account activity recorded.">
              {data.activity.map((event) => <tr key={event.id}><td>{event.actorLabel}<small>{event.actorRole}</small></td><td>{event.actionType}</td><td><StatusBadge status={event.result} /></td><td>{event.transactionId || event.approvalRequestId || '—'}</td><td>{formatDate(event.createdAt)}</td></tr>)}
            </DataTable>
            <HistoryPagination pagination={data.historyPagination.activity} onPageChange={(page) => setPages((current) => ({ ...current, activity: page }))} />
            <IntegrationNotice text={data.trading.message} />
          </>
        )}
      </div>
    </div>
  );
}

function HistoryPagination({ pagination, onPageChange }) {
  if (pagination.totalPages <= 1) return null;
  const first = (pagination.page - 1) * pagination.pageSize + 1;
  const last = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return <div className="d-flex align-items-center justify-content-between gap-3 mt-2 mb-3">
    <small className="text-secondary">Showing {first}–{last} of {pagination.total}</small>
    <div className="d-flex gap-2">
      <button className="btn btn-sm btn-outline-secondary" onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page <= 1}>Previous</button>
      <span className="small align-self-center">Page {pagination.page} of {pagination.totalPages}</span>
      <button className="btn btn-sm btn-outline-secondary" onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>Next</button>
    </div>
  </div>;
}

function WalletAdjustment({ investor, operation, api, onClose, notify, reload }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const currentCents = toCents(investor.availableBalance);
  const amountCents = toCents(amount);
  const resulting = currentCents === null || amountCents === null ? null
    : currentCents + (operation === 'credit' ? amountCents : -amountCents);
  const save = async (event) => {
    event.preventDefault();
    if (resulting === null || resulting < 0n) return;
    setBusy(true);
    try {
      const result = await api(`/api/investors/${encodeURIComponent(investor.accountId)}/wallet-adjustments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ operation, amount, reason }),
      });
      notify(`Wallet adjustment recorded: ${result.adjustment.reference}${result.replayed ? ' (previous submission)' : ''}.`);
      reload();
      onClose();
    } catch (error) {
      notify(error.message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop-custom" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="wallet-adjustment-title">
        <div className="section-heading"><div><h2 id="wallet-adjustment-title">{operation === 'credit' ? 'Add funds' : 'Deduct funds'}</h2><p>{investor.displayName} · {investor.accountId}</p></div><button className="icon-close" onClick={onClose}>×</button></div>
        <form onSubmit={save}>
          <label className="form-label" htmlFor="wallet-adjustment-amount">Amount (USD)</label>
          <input id="wallet-adjustment-amount" className="form-control" type="number" min="0.01" step="0.01" value={amount}
            onChange={(event) => setAmount(event.target.value)} required />
          <label className="form-label mt-3" htmlFor="wallet-adjustment-reason">Reason</label>
          <textarea id="wallet-adjustment-reason" className="form-control" rows="3" minLength="3" maxLength="500"
            value={reason} onChange={(event) => setReason(event.target.value)} required />
          <div className="balance-preview">
            <div><span>Current available balance</span><strong>{money(investor.availableBalance)}</strong></div>
            <div><span>Result after adjustment</span><strong>{resulting === null ? '—' : moneyFromCents(resulting)}</strong></div>
          </div>
          {resulting !== null && resulting < 0n && <div className="form-error">This debit exceeds the current available balance.</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || reason.trim().length < 3 || resulting === null || resulting < 0n}>
              {busy ? 'Recording…' : 'Confirm adjustment'}
            </button></div>
        </form>
      </div>
    </div>
  );
}

function Transactions({ api, refreshKey, kind, account, notify }) {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useLoad(api, `/api/transactions?kind=${kind}&page=${page}`, refreshKey);
  const investors = useLoad(api, '/api/payment-investors', refreshKey);
  const [busy, setBusy] = useState('');
  const [investorAccountId, setInvestorAccountId] = useState('');
  const [amountUsd, setAmountUsd] = useState('');
  const [currency, setCurrency] = useState('USDT');
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  if (loading) return <PageLoading label={`Loading ${kind} records…`} />;
  if (error) return <ErrorCard error={error} />;
  const rows = data.transactions;
  const canCreate = account.role === 'CEO' || account.permissions?.includes('payments:review');
  const create = async (event) => {
    event.preventDefault();
    setBusy('create');
    try {
      const requestKey = idempotencyKey || crypto.randomUUID();
      if (!idempotencyKey) setIdempotencyKey(requestKey);
      const result = await api(`/api/${kind === 'deposit' ? 'deposits' : 'withdrawals'}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey },
        body: JSON.stringify(kind === 'deposit'
          ? { investorAccountId, amountUsd, currency }
          : { investorAccountId, amountUsd, destination, reason }),
      });
      setIdempotencyKey('');
      setAmountUsd('');
      setReason('');
      if (kind === 'withdrawal') setDestination('');
      notify(kind === 'deposit'
        ? 'Plisio invoice created. The investor must complete payment; verification is still required.'
        : `Withdrawal reserved for review. Provider quote: ${result.withdrawal.providerAmount} ${result.withdrawal.providerCurrency} · fee ${result.withdrawal.providerFee} USDT.`);
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy('');
    }
  };
  const checkProviderStatus = async (item) => {
    setBusy(item.id);
    try {
      await api(`/api/${kind === 'deposit' ? 'deposits' : 'withdrawals'}/${encodeURIComponent(item.id)}/check`, {
        method: 'POST',
        body: '{}',
      });
      notify('Provider status refreshed.');
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy('');
    }
  };
  const requestApproval = async (item, proposedAction) => {
    const reason = window.prompt(`Why are you requesting authorization to ${proposedAction} this ${kind}?`);
    if (!reason?.trim()) return;
    setBusy(`${item.id}:${proposedAction}`);
    try {
      await api(`/api/transactions/${kind}/${encodeURIComponent(item.id)}/approval-requests`, {
        method: 'POST',
        body: JSON.stringify({ proposedAction, reason }),
      });
      notify('Approval request submitted to the CEO.');
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy('');
    }
  };
  return (
    <>
    {canCreate && <section className="surface-card mb-4">
      <div className="section-heading"><div>
        <h2>{kind === 'deposit' ? 'Create Plisio deposit invoice' : 'Request USDT TRC20 withdrawal'}</h2>
        <p>{kind === 'deposit'
          ? 'Create a provider-hosted invoice. Wallet credit still requires provider verification and separate CEO authorization.'
          : 'Get a fresh provider quote, reserve available funds, and submit the payout for staff and CEO review.'}</p>
      </div></div>
      <form className="row g-3 align-items-end" onSubmit={create}>
        <div className="col-12 col-md-5">
          <label className="form-label" htmlFor={`${kind}-investor`}>Active investor</label>
          <select id={`${kind}-investor`} className="form-select" value={investorAccountId}
            onChange={(event) => setInvestorAccountId(event.target.value)} required>
            <option value="">{investors.loading ? 'Loading investors…' : 'Select investor'}</option>
            {investors.data?.investors.map((investor) => (
              <option key={investor.accountId} value={investor.accountId}>
                {investor.displayName} · {investor.accountId}{kind === 'withdrawal' ? ` · available ${money(investor.availableBalance)}` : ''}
              </option>
            ))}
          </select>
          {investors.error && <div className="form-error">{investors.error}</div>}
        </div>
        <div className="col-12 col-sm-4 col-md-3">
          <label className="form-label" htmlFor={`${kind}-amount`}>Amount (USD)</label>
          <input id={`${kind}-amount`} className="form-control" type="number" min={kind === 'withdrawal' ? '1.00' : '0.01'}
            step="0.01" inputMode="decimal" value={amountUsd} onChange={(event) => setAmountUsd(event.target.value)} required />
        </div>
        {kind === 'deposit' ? <div className="col-12 col-sm-4 col-md-2">
          <label className="form-label" htmlFor="deposit-currency">Payment currency</label>
          <select id="deposit-currency" className="form-select" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="USDT">USDT · TRC20</option><option value="BTC">Bitcoin</option><option value="TRX">TRON</option>
          </select>
        </div> : <>
          <div className="col-12 col-md-4">
            <label className="form-label" htmlFor="withdraw-destination">USDT TRC20 destination</label>
            <input id="withdraw-destination" className="form-control" value={destination}
              onChange={(event) => setDestination(event.target.value.trim())} maxLength={64} required />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="withdraw-reason">Reason / review notes</label>
            <input id="withdraw-reason" className="form-control" value={reason}
              onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required />
          </div>
        </>}
        <div className="col-12 d-flex align-items-center gap-3">
          <button className="btn btn-primary" disabled={busy === 'create' || investors.loading || !investors.data?.investors.length}>
            {busy === 'create' ? 'Submitting…' : kind === 'deposit' ? 'Create invoice' : 'Quote and reserve withdrawal'}
          </button>
          {kind === 'withdrawal' && <small className="text-secondary">Automatic payout is disabled until enabled in secure server configuration.</small>}
        </div>
      </form>
    </section>}
    <section className="surface-card">
      <div className="section-heading"><div><h2>{kind === 'deposit' ? 'Deposit requests' : 'Withdrawal requests'}</h2><p>Provider and transaction state from persisted records. Review decisions are not simulated.</p></div></div>
      <DataTable columns={['Reference / investor', 'Amount', 'Details', 'Status', 'Created', 'Provider actions', ...(account.role === 'STAFF' ? ['Staff actions'] : [])]} empty={`No ${kind} requests are recorded.`}>
        {rows.map((item) => {
          const activeApproval = item.approval && ['pending', 'approved'].includes(item.approval.status);
          const eligibleForReject = kind === 'deposit'
            ? ['pending', 'payment_reported', 'payment_confirmed', 'awaiting_ceo'].includes(item.status)
            : ['pending_review', 'awaiting_ceo'].includes(item.status);
          const eligibleForApprove = kind === 'deposit'
            ? item.status === 'payment_confirmed' && item.providerStatus === 'verified'
            : ['pending_review', 'awaiting_ceo'].includes(item.status);
          return (
          <tr key={`${item.kind}-${item.id}`}>
            <td><strong>{item.id.slice(0, 8).toUpperCase()}</strong><small>{item.investorName} · {item.investorAccountId}</small></td>
            <td>{money(item.amountUsd)}</td>
            <td>{kind === 'deposit' ? <>{item.currency}<small>{item.providerReference || 'No provider reference'}</small><small>Provider: {item.providerStatus || 'unverified'}</small></> : <>USDT · {item.network}<small className="destination">{item.destination}</small><small>Quote: {item.providerAmount || '—'} {item.providerCurrency || ''} · fee {item.providerFee || '—'} USDT</small></>}</td>
            <td><StatusBadge status={item.status} /></td><td>{formatDate(item.createdAt)}</td>
            <td><div className="table-actions">
              {kind === 'deposit' && item.invoiceUrl && <a className="btn btn-sm btn-outline-secondary" href={item.invoiceUrl} target="_blank" rel="noreferrer">Invoice</a>}
              {kind === 'deposit' && item.invoiceAddress && <small className="destination">{item.invoiceAddress}</small>}
              {kind === 'withdrawal' && item.providerReference && <small>{item.providerReference}</small>}
              {kind === 'withdrawal' && item.providerStatus && <small>Provider: {item.providerStatus}</small>}
              {kind === 'withdrawal' && item.providerReference && ['processing', 'ceo_approved'].includes(item.status) &&
                <button className="btn btn-sm btn-outline-primary" disabled={Boolean(busy)} onClick={() => checkProviderStatus(item)}>{busy === item.id ? 'Checking…' : 'Check status'}</button>}
              {kind === 'deposit' && item.providerInvoiceId && !['credited', 'rejected', 'expired', 'failed'].includes(item.status) &&
                <button className="btn btn-sm btn-outline-primary" disabled={Boolean(busy)} onClick={() => checkProviderStatus(item)}>{busy === item.id ? 'Checking…' : 'Check status'}</button>}
            </div></td>
            {account.role === 'STAFF' && <td>
              {activeApproval
                ? <small>Approval {item.approval.status}</small>
                : eligibleForApprove || eligibleForReject
                  ? <div className="table-actions">
                    {eligibleForApprove && <button className="btn btn-sm btn-outline-success" onClick={() => requestApproval(item, 'approve')} disabled={Boolean(busy)}>{busy === `${item.id}:approve` ? 'Sending…' : 'Request approve'}</button>}
                    {eligibleForReject && <button className="btn btn-sm btn-outline-danger" onClick={() => requestApproval(item, 'reject')} disabled={Boolean(busy)}>{busy === `${item.id}:reject` ? 'Sending…' : 'Request reject'}</button>}
                  </div>
                  : <small>No staff action available</small>}
            </td>}
          </tr>
        );})}
      </DataTable>
      {data.pagination.totalPages > 1 && <div className="d-flex align-items-center justify-content-between gap-3 mt-3">
        <small className="text-secondary">
          Showing {(data.pagination.page - 1) * data.pagination.pageSize + 1}–{Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total)} of {data.pagination.total}
        </small>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(Math.max(1, data.pagination.page - 1))} disabled={data.pagination.page <= 1}>Previous</button>
          <span className="small align-self-center">Page {data.pagination.page} of {data.pagination.totalPages}</span>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => setPage(Math.min(data.pagination.totalPages, data.pagination.page + 1))} disabled={data.pagination.page >= data.pagination.totalPages}>Next</button>
        </div>
      </div>}
      <IntegrationNotice text={kind === 'deposit'
        ? 'Invoice payment is not wallet credit. Plisio status is re-fetched server-side; separate CEO approval is required before credit.'
        : 'A withdrawal quote reserves funds. Payouts run only when the server-side kill switch is enabled, after CEO authorization, and remain reserved until Plisio confirms completion.'} />
    </section>
    </>
  );
}

function Approvals({ api, refreshKey, account, notify }) {
  const { data, loading, error, reload } = useLoad(api, '/api/approvals', refreshKey);
  const [busy, setBusy] = useState('');
  if (loading) return <PageLoading label="Loading approval requests…" />;
  if (error) return <ErrorCard error={error} />;
  const decide = async (item, decision) => {
    const reason = window.prompt(`Enter the reason for this CEO decision (${decision.replace('_', ' ')}):`);
    if (!reason?.trim()) return;
    setBusy(item.id);
    try {
      await api(`/api/approvals/${encodeURIComponent(item.id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason }),
      });
      notify(decision === 'more_information' ? 'Request returned to staff for more information.' : `Proposal ${decision === 'approve' ? 'authorized' : 'not authorized'}.`);
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy('');
    }
  };
  const execute = async (item) => {
    if (!window.confirm(`Execute the CEO-authorized ${item.proposedAction} action for this ${item.transactionType}?`)) return;
    setBusy(item.id);
    try {
      const result = await api(`/api/approvals/${encodeURIComponent(item.id)}/execute`, { method: 'POST', body: '{}' });
      notify(result.note || `Authorized action recorded: ${result.result.status}.`);
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy('');
    }
  };
  const resubmit = async (item) => {
    const reason = window.prompt('Provide the additional information requested by the CEO:');
    if (!reason?.trim()) return;
    setBusy(item.id);
    try {
      await api(`/api/transactions/${item.transactionType}/${encodeURIComponent(item.transactionId)}/approval-requests`, {
        method: 'POST',
        body: JSON.stringify({ proposedAction: item.proposedAction, reason }),
      });
      notify('Updated approval request submitted to the CEO.');
      reload();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="surface-card">
      <div className="section-heading"><div><h2>CEO approval requests</h2><p>Transaction details are fingerprinted at submission; changes invalidate the authorization.</p></div></div>
      <DataTable columns={['Request', 'Transaction / investor', 'Proposal', 'Staff reason / CEO decision', 'Status', 'Submitted', 'Actions']} empty="No approval requests are recorded.">
        {data.approvals.map((item) => (
          <tr key={item.id}><td>{item.id.slice(0, 8).toUpperCase()}</td>
            <td>{item.transactionType} · {item.transactionDetails?.investorName || 'Investor record unavailable'}
              <small>{item.transactionDetails?.investorAccountId || '—'} · {money(item.transactionDetails?.amountUsd)} · {item.transactionId}</small>
              {item.transactionType === 'deposit'
                ? <small>{item.transactionDetails?.currency} · provider {item.transactionDetails?.providerStatus || 'unverified'}</small>
                : <small>{item.transactionDetails?.currency} · {item.transactionDetails?.network} · {item.transactionDetails?.destination}</small>}
            </td>
            <td className="text-capitalize">{item.proposedAction}</td>
            <td>{item.reason}{item.decisionReason && <small>CEO: {item.decisionReason}</small>}<small>Submitted by {item.requesterName} ({item.requestedBy})</small></td>
            <td><StatusBadge status={item.status} /></td><td>{formatDate(item.createdAt)}</td>
            <td><div className="table-actions">
              {account.role === 'CEO' && item.status === 'pending' && <>
                <button className="btn btn-sm btn-outline-success" disabled={busy === item.id} onClick={() => decide(item, 'approve')}>Authorize</button>
                <button className="btn btn-sm btn-outline-danger" disabled={busy === item.id} onClick={() => decide(item, 'reject')}>Reject</button>
                <button className="btn btn-sm btn-light" disabled={busy === item.id} onClick={() => decide(item, 'more_information')}>Request info</button>
              </>}
              {account.role === 'STAFF' && item.requestedBy === account.accountId && item.status === 'approved' &&
                <button className="btn btn-sm btn-primary" disabled={busy === item.id} onClick={() => execute(item)}>Execute authorized action</button>}
              {account.role === 'STAFF' && item.requestedBy === account.accountId && item.status === 'more_information' &&
                <button className="btn btn-sm btn-outline-warning" disabled={busy === item.id} onClick={() => resubmit(item)}>Respond and resubmit</button>}
            </div></td>
          </tr>
        ))}
      </DataTable>
      <IntegrationNotice text="Deposit credits require a trusted provider status of verified. Withdrawal authorization does not initiate a transfer or mark it paid; no payment-provider integration is connected." />
    </section>
  );
}

function Trading({ api, refreshKey }) {
  const { data, loading, error } = useLoad(api, '/api/trading', refreshKey);
  if (loading) return <PageLoading label="Checking trading integration…" />;
  if (error) return <ErrorCard error={error} />;
  return (
    <>
      <div className="integration-banner warning-banner">
        <div className="integration-mark">!</div>
        <div><strong>Deriv trading integration unavailable</strong><p>{data.message}</p></div>
        <span className="status-badge status-unavailable">Unavailable</span>
      </div>
      <section className="surface-card mt-4">
        <div className="section-heading"><div><h2>Trading activity</h2><p>Only records returned from the application database are shown.</p></div></div>
        <DataTable columns={['Trade ID', 'Status', 'Profit / loss', 'Recorded']} empty="No trade records are available.">
          {data.trades.map((trade) => <tr key={trade.id}><td>{trade.externalReference || trade.id}</td><td><StatusBadge status={trade.status} /></td><td>{trade.profitLoss === null ? '—' : money(trade.profitLoss)}</td><td>{formatDate(trade.createdAt)}</td></tr>)}
        </DataTable>
      </section>
    </>
  );
}

function Activity({ api, refreshKey }) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const filters = new URLSearchParams({
    q: query,
    role,
    action,
    from: from ? new Date(from).toISOString() : '',
    to: to ? new Date(to).toISOString() : '',
  });
  const path = `/api/audit?${filters.toString()}`;
  const { data, loading, error } = useLoad(api, path, refreshKey);
  const exportEvents = async () => {
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch(`/api/audit/export?${filters.toString()}`, { credentials: 'same-origin' });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Export failed (${response.status}).`);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'g-squad-audit.csv';
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (requestError) {
      setExportError(requestError.message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="surface-card">
      <div className="section-heading">
        <div><h2>Activity and security log</h2><p>Append-only records from successful and denied administrative actions.</p></div>
        <button className="btn btn-sm btn-outline-secondary" onClick={exportEvents} disabled={exporting}>{exporting ? 'Preparing export…' : 'Export CSV'}</button>
      </div>
      <div className="filter-row">
        <input className="form-control" placeholder="Search actor, account, transaction, action…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="form-select" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">All roles</option>{['CEO', 'STAFF', 'INVESTOR', 'SYSTEM', 'ANONYMOUS'].map((value) => <option key={value}>{value}</option>)}
        </select>
        <input className="form-control" aria-label="Filter by action type" placeholder="Action type" value={action} onChange={(event) => setAction(event.target.value)} />
        <input className="form-control" aria-label="Filter from date and time" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input className="form-control" aria-label="Filter to date and time" type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      {exportError && <div className="alert alert-danger" role="alert">{exportError}</div>}
      {loading ? <PageLoading label="Loading audit events…" /> : error ? <ErrorCard error={error} /> : (
        <DataTable columns={['Actor', 'Action', 'Affected account', 'Related record', 'Details', 'Result', 'Time']} empty="No matching activity records.">
          {data.events.map((event) => <tr key={event.id}><td><strong>{event.actorLabel}</strong><small>{event.actorRole} · {event.actorAccountId || 'system'}</small></td>
            <td>{event.actionType}<small>Request {event.requestId.slice(0, 8)}</small></td>
            <td>{event.affectedAccountId || '—'}</td>
            <td>{event.transactionId || event.approvalRequestId || '—'}</td>
            <td><details><summary>View details</summary><pre className="audit-details">{JSON.stringify(event.details, null, 2)}</pre></details></td>
            <td><StatusBadge status={event.result} /></td><td>{formatDate(event.createdAt)}</td></tr>)}
        </DataTable>
      )}
    </section>
  );
}

function Settings({ api, refreshKey, notify }) {
  const { data, loading, error, reload } = useLoad(api, '/api/settings', refreshKey);
  if (loading) return <PageLoading label="Loading application settings…" />;
  if (error) return <ErrorCard error={error} />;
  return (
    <>
      <section className="surface-card">
        <div className="section-heading"><div><h2>Integration status</h2><p>Configured credentials are never returned to this page.</p></div></div>
        <div className="integration-list">
          <IntegrationRow label="Plisio payments" status={data.integrations.plisio} detail="Server-side invoices, status checks, and webhook verification are implemented. Payouts require explicit server-side enablement." />
          <IntegrationRow label="Deriv trading" status={data.integrations.deriv} detail="Account authorization checks are available from Trading; live trade execution remains disabled." />
          <IntegrationRow label="Neon database" status="connected" detail="Database connection status is verified on the server." />
        </div>
        <IntegrationNotice text={data.note} />
      </section>
      <section className="surface-card mt-4">
        <div className="section-heading"><div><h2>Application configuration</h2><p>Changes are validated server-side and recorded with the CEO identity, previous value, new value, and reason.</p></div></div>
        <div className="integration-list">{data.settings.map((setting) => setting.type === 'trading_configuration'
          ? <TradingConfigurationEditor key={setting.key} setting={setting} api={api} notify={notify} onSaved={reload} />
          : <SettingEditor key={setting.key} setting={setting} api={api} notify={notify} onSaved={reload} />)}</div>
      </section>
    </>
  );
}

function TradingConfigurationEditor({ setting, api, notify, onSaved }) {
  const [value, setValue] = useState(setting.value);
  const [markets, setMarkets] = useState(setting.value.permittedMarkets.join(', '));
  const [contracts, setContracts] = useState(setting.value.permittedContracts.join(', '));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const draft = {
        ...value,
        permittedMarkets: markets.split(',').map((entry) => entry.trim()).filter(Boolean),
        permittedContracts: contracts.split(',').map((entry) => entry.trim()).filter(Boolean),
      };
      await api(`/api/settings/${encodeURIComponent(setting.key)}`, {
        method: 'PATCH',
        body: JSON.stringify({ value: draft, reason }),
      });
      setValue(draft);
      setReason('');
      notify('Trading configuration draft saved and audited.');
      onSaved();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return <form className="setting-editor" onSubmit={save}>
    <div className="section-heading">
      <div><strong>{setting.label}</strong><small>Draft only · Last updated {formatDate(setting.updatedAt)}</small></div>
    </div>
    <IntegrationNotice text="These settings are stored for planning and audit only. They are not sent to Deriv, do not configure an execution engine, and cannot enable live or simulated trades. Confirm permitted values and provider/legal authorization before any future integration." />
    <div className="row g-3">
      <div className="col-12">
        <label className="form-label" htmlFor="trading-strategy-notes">Strategy settings</label>
        <input id="trading-strategy-notes" className="form-control" maxLength={120} value={value.strategy}
          onChange={(event) => setValue((current) => ({ ...current, strategy: event.target.value }))} />
      </div>
      <div className="col-12 col-lg-6">
        <label className="form-label" htmlFor="trading-markets">Permitted markets</label>
        <textarea id="trading-markets" className="form-control" rows="2" maxLength={2100} value={markets}
          onChange={(event) => setMarkets(event.target.value)} aria-describedby="trading-markets-help" />
        <small id="trading-markets-help">Separate entries with commas. Draft values only.</small>
      </div>
      <div className="col-12 col-lg-6">
        <label className="form-label" htmlFor="trading-contracts">Permitted contracts</label>
        <textarea id="trading-contracts" className="form-control" rows="2" maxLength={2100} value={contracts}
          onChange={(event) => setContracts(event.target.value)} aria-describedby="trading-contracts-help" />
        <small id="trading-contracts-help">Separate entries with commas. Draft values only.</small>
      </div>
      <div className="col-12 col-md-6">
        <label className="form-check form-switch mb-0">
          <input className="form-check-input" type="checkbox" role="switch" checked={value.recoveryEnabled}
            onChange={(event) => setValue((current) => ({ ...current, recoveryEnabled: event.target.checked }))}
            aria-label="Enable recovery in draft configuration" />
          <span className="form-check-label">Recovery in draft configuration</span>
        </label>
      </div>
      <div className="col-12 col-md-6">
        <label className="form-label" htmlFor="trading-recovery-multiplier">Recovery multiplier</label>
        <input id="trading-recovery-multiplier" className="form-control" inputMode="decimal" maxLength={20}
          value={value.recoveryMultiplier} onChange={(event) => setValue((current) => ({
            ...current, recoveryMultiplier: event.target.value,
          }))} />
      </div>
    </div>
    <div className="setting-reason-row mt-3">
      <input className="form-control" value={reason} onChange={(event) => setReason(event.target.value)}
        placeholder="Reason for change" minLength={3} maxLength={500} required />
      <button className="btn btn-sm btn-primary" disabled={busy || reason.trim().length < 3}>
        {busy ? 'Saving draft…' : 'Save draft'}
      </button>
    </div>
  </form>;
}

function SettingEditor({ setting, api, notify, onSaved }) {
  const [value, setValue] = useState(setting.value);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/settings/${encodeURIComponent(setting.key)}`, {
        method: 'PATCH',
        body: JSON.stringify({ value, reason }),
      });
      setReason('');
      notify(`${setting.label} saved and audited.`);
      onSaved();
    } catch (requestError) {
      notify(requestError.message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return <form className="setting-editor" onSubmit={save}>
    <div className="setting-editor-heading">
      <div><strong>{setting.label}</strong><small>{setting.key} · Last updated {formatDate(setting.updatedAt)}</small></div>
      {setting.type === 'boolean'
        ? <label className="form-check form-switch mb-0">
          <input className="form-check-input" type="checkbox" role="switch" checked={value}
            onChange={(event) => setValue(event.target.checked)} aria-label={setting.label} />
        </label>
        : <textarea className="form-control setting-value" value={value} rows="2"
          onChange={(event) => setValue(event.target.value)} maxLength={500} aria-label={setting.label} />}
    </div>
    <div className="setting-reason-row">
      <input className="form-control" value={reason} onChange={(event) => setReason(event.target.value)}
        placeholder="Reason for change" minLength={3} maxLength={500} required />
      <button className="btn btn-sm btn-primary" disabled={busy || reason.trim().length < 3}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  </form>;
}

function IntegrationRow({ label, status, detail }) {
  return <div className="integration-row"><div><strong>{label}</strong><p>{detail}</p></div><StatusBadge status={status} /></div>;
}

function AuditRows({ rows }) {
  if (!rows?.length) return <EmptyState text="No administrative activity has been recorded yet." />;
  return <div className="audit-list">{rows.map((row) => <div className="audit-row" key={row.id}>
    <div className="audit-avatar">{(row.actorLabel || '?').slice(0, 1).toUpperCase()}</div>
    <div className="audit-main"><strong>{row.actionType}</strong><span>{row.actorLabel} · {row.actorRole}</span></div>
    <StatusBadge status={row.result} /><time>{formatDate(row.createdAt)}</time>
  </div>)}</div>;
}

function DataTable({ columns, empty, children }) {
  const content = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="table-responsive">
      <table className="table align-middle data-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{content.length ? content : <tr><td colSpan={columns.length}><EmptyState text={empty} /></td></tr>}</tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status = 'unknown' }) {
  const normalized = String(status).toLowerCase().replaceAll('_', ' ');
  const tone = ['active', 'success', 'approved', 'paid', 'credited', 'connected'].includes(normalized) ? 'success'
    : ['pending', 'pending review', 'awaiting ceo', 'payment reported', 'payment confirmed', 'processing', 'configured not verified', 'configured not connected'].includes(normalized) ? 'warning'
      : ['revoked', 'suspended', 'rejected', 'failed', 'denied', 'deactivated', 'unavailable'].includes(normalized) ? 'danger' : 'neutral';
  return <span className={`status-badge status-${tone}`}>{normalized}</span>;
}

function IntegrationNotice({ text }) {
  return <div className="integration-notice"><span>i</span><p>{text}</p></div>;
}

function EmptyState({ text }) {
  return <div className="empty-state"><span className="empty-icon">⌕</span><strong>{text}</strong></div>;
}

function PageLoading({ label }) {
  return <div className="loading-state"><span className="spinner-border spinner-border-sm text-warning" />{label}</div>;
}

function ScreenLoading() {
  return <div className="screen-loading"><span className="spinner-border text-warning" />Loading secure admin console…</div>;
}

function ErrorCard({ error }) {
  return <div className="alert alert-danger"><strong>Unable to load this section.</strong><div>{error}</div></div>;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return <div className={`toast-banner toast-${toast.type}`} role="status" aria-live="polite">
    <span>{toast.type === 'danger' ? '!' : '✓'}</span><div>{toast.message}</div>
    <button onClick={onClose} aria-label="Dismiss notification">×</button>
  </div>;
}

function useLoad(api, path, refreshKey) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    api(path).then((data) => setState({ data, loading: false, error: '' }))
      .catch((error) => setState({ data: null, loading: false, error: error.message }));
  }, [api, path]);
  useEffect(reload, [reload, refreshKey]);
  return { ...state, reload };
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function money(value) {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(String(value))) return '—';
  const [whole, fraction = ''] = String(value).split('.');
  return `$${BigInt(whole).toLocaleString()}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function toCents(value) {
  const input = String(value ?? '');
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function moneyFromCents(cents) {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  const whole = (absolute / 100n).toLocaleString();
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${sign}$${whole}.${fraction}`;
}
