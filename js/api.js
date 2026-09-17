/** Cliente HTTP Teodora + sessão */
(function (global) {
  const API_BASE = (typeof global.TEODORA_API_BASE === 'string'
    ? global.TEODORA_API_BASE
    : 'http://localhost:3001'
  ).replace(/\/$/, '');
  const TOKEN_KEY = 'teodora_token';
  const USER_KEY = 'teodora_user';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (_) { return null; }
  }

  function setSession(token, user) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (_) { /* ignore */ }
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) { /* ignore */ }
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.detail || data.error || data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function apiForm(path, formData) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
  }

  function absoluteUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  global.TeodoraAPI = {
    API_BASE,
    getToken,
    getUser,
    setSession,
    clearSession,
    api,
    apiForm,
    absoluteUrl,
  };
})(window);
