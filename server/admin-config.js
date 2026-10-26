export const applicationSettings = [
  { key: 'dashboard_notice_enabled', label: 'Dashboard notice', type: 'boolean', defaultValue: false },
  { key: 'dashboard_notice', label: 'Dashboard notice text', type: 'string', defaultValue: '' },
  {
    key: 'trading_configuration',
    label: 'Trading configuration draft',
    type: 'trading_configuration',
    defaultValue: {
      strategy: '',
      permittedMarkets: [],
      permittedContracts: [],
      recoveryEnabled: false,
      recoveryMultiplier: '',
    },
  },
];

export function normalizeSettingValue(key, value) {
  const setting = applicationSettings.find((entry) => entry.key === key);
  if (!setting) throw new Error('This setting cannot be changed from the dashboard.');
  if (setting.type === 'trading_configuration') return normalizeTradingConfiguration(value);
  if (setting.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${setting.label} must be enabled or disabled.`);
    return value;
  }
  if (typeof value !== 'string' || value.trim().length > 500) {
    throw new Error(`${setting.label} must be text with no more than 500 characters.`);
  }
  return value.trim();
}

function normalizeTradingConfiguration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Trading configuration must be an object.');
  }
  const { strategy, permittedMarkets, permittedContracts, recoveryEnabled, recoveryMultiplier } = value;
  if (Object.keys(value).some((key) => ![
    'strategy', 'permittedMarkets', 'permittedContracts', 'recoveryEnabled', 'recoveryMultiplier',
  ].includes(key))) {
    throw new Error('Trading configuration contains an unsupported field.');
  }
  if (typeof strategy !== 'string' || strategy.trim().length > 120) {
    throw new Error('Strategy notes must be text with no more than 120 characters.');
  }
  const normalizeList = (entries, label) => {
    if (!Array.isArray(entries) || entries.length > 25
      || entries.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.trim().length > 80)) {
      throw new Error(`${label} must contain up to 25 non-empty entries of no more than 80 characters each.`);
    }
    const normalized = entries.map((entry) => entry.trim());
    if (new Set(normalized.map((entry) => entry.toLowerCase())).size !== normalized.length) {
      throw new Error(`${label} cannot contain duplicates.`);
    }
    return normalized;
  };
  if (typeof recoveryEnabled !== 'boolean') {
    throw new Error('Recovery must be enabled or disabled.');
  }
  if (typeof recoveryMultiplier !== 'string' || recoveryMultiplier.length > 20
    || (recoveryMultiplier !== '' && !/^\d+(?:\.\d{1,2})?$/.test(recoveryMultiplier))
    || (recoveryMultiplier !== '' && (!Number.isFinite(Number(recoveryMultiplier)) || Number(recoveryMultiplier) <= 0))
    || (recoveryEnabled && recoveryMultiplier === '')) {
    throw new Error('Enter a positive recovery multiplier with up to two decimal places.');
  }
  return {
    strategy: strategy.trim(),
    permittedMarkets: normalizeList(permittedMarkets, 'Permitted markets'),
    permittedContracts: normalizeList(permittedContracts, 'Permitted contracts'),
    recoveryEnabled,
    recoveryMultiplier: recoveryMultiplier.trim(),
  };
}

export function normalizeInvestorProfile(body) {
  const profile = {
    displayName: typeof body.displayName === 'string' ? body.displayName.trim() : '',
    username: typeof body.username === 'string' ? body.username.trim() : '',
    email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : '',
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
    country: typeof body.country === 'string' ? body.country.trim() : '',
  };
  if (profile.displayName.length < 2 || profile.displayName.length > 80) {
    throw new Error('Display name must be between 2 and 80 characters.');
  }
  if (profile.username && !/^[A-Za-z0-9_.-]{3,40}$/.test(profile.username)) {
    throw new Error('Username must be 3-40 characters and use only letters, numbers, dots, underscores, or hyphens.');
  }
  if (profile.email && (profile.email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))) {
    throw new Error('Enter a valid email address, or leave it blank.');
  }
  const phoneDigits = profile.phone.replace(/\D/g, '').length;
  if (profile.phone && (!/^[+()0-9 .-]{7,32}$/.test(profile.phone) || phoneDigits < 7 || phoneDigits > 15)) {
    throw new Error('Phone number must be 7-32 characters and contain only phone-number characters.');
  }
  if (profile.country.length > 80) throw new Error('Country must be no more than 80 characters.');
  return Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, value || null]));
}
