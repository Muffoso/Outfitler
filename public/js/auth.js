let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export async function refreshAccessToken() {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      accessToken = null;
      return false;
    }

    const data = await response.json();
    accessToken = data.accessToken;
    return true;
  } catch (err) {
    console.error('Refresh failed:', err);
    accessToken = null;
    return false;
  }
}

export async function authFetch(url, options = {}) {
  const headers = { ...options.headers };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response = await fetch(url, { ...options, headers, credentials: 'include' });

  if (response.status === 401 && accessToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(url, { ...options, headers, credentials: 'include' });
    }
  }

  return response;
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    accessToken = null;
    window.location.href = '/login.html';
  }
}

export async function initAuth() {
  const tokenCookie = document.cookie
    .split('; ')
    .find(row => row.startsWith('oauth_access_token='));

  if (tokenCookie) {
    accessToken = tokenCookie.split('=')[1];
    document.cookie = 'oauth_access_token=; max-age=0; path=/;';
    return;
  }

  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    window.location.href = '/login.html';
  }
}
