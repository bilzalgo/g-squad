const websocketUrl = 'wss://ws.derivws.com/websockets/v3';

export async function getDerivStatus() {
  const appId = process.env.DERIV_APP_ID;
  const token = process.env.DERIV_API_TOKEN;
  if (!appId || !token) {
    return {
      status: 'not_configured',
      message: 'Set DERIV_APP_ID and a server-only DERIV_API_TOKEN to check the account connection.',
      tradingEnabled: false,
    };
  }
  if (typeof WebSocket !== 'function') {
    return {
      status: 'unavailable',
      message: 'This Node.js runtime does not support WebSocket. Use the documented Node.js 24 runtime.',
      tradingEnabled: false,
    };
  }
  if (!/^\d{1,12}$/.test(appId) || token.length > 4096) {
    return { status: 'misconfigured', message: 'The Deriv app ID or API token configuration is invalid.', tradingEnabled: false };
  }

  try {
    const authorization = await authorize(appId, token);
    return {
      status: 'connected',
      message: authorization.is_virtual
        ? 'Deriv demo account connected. Automated trading remains disabled.'
        : 'Deriv account connection verified. Live trade execution is disabled pending provider, permission, and legal approval.',
      accountType: authorization.is_virtual ? 'demo' : 'live',
      currency: authorization.currency || null,
      tradingEnabled: false,
    };
  } catch {
    return {
      status: 'unavailable',
      message: 'Deriv authorization could not be verified. Check the server-side token and provider status.',
      tradingEnabled: false,
    };
  }
}

function authorize(appId, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${websocketUrl}?app_id=${encodeURIComponent(appId)}`);
    const timeout = setTimeout(() => finish(new Error('Deriv authorization timed out.')), 10_000);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      if (error) reject(error);
      else resolve(value);
    };

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ authorize: token }));
    }, { once: true });
    socket.addEventListener('message', (event) => {
      let response;
      try {
        response = JSON.parse(String(event.data));
      } catch {
        finish(new Error('Invalid Deriv response.'));
        return;
      }
      if (response.error || response.msg_type !== 'authorize' || !response.authorize) {
        finish(new Error('Deriv authorization failed.'));
        return;
      }
      finish(null, {
        is_virtual: response.authorize.is_virtual === 1 || response.authorize.is_virtual === true,
        currency: typeof response.authorize.currency === 'string' ? response.authorize.currency : null,
      });
    });
    socket.addEventListener('error', () => finish(new Error('Deriv WebSocket connection failed.')), { once: true });
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error('Deriv connection closed.'));
    }, { once: true });
  });
}
