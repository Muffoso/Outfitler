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

// PUT a FormData with upload-progress reporting (fetch can't do progress).
// onProgress(fraction 0..1) is called as bytes go out. Refreshes the token once
// on 401, like authFetch. Resolves the parsed JSON body.
export function authUpload(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const attempt = (isRetry) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.withCredentials = true;
      if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      });
      xhr.addEventListener('load', async () => {
        if (xhr.status === 401 && accessToken && !isRetry) {
          const ok = await refreshAccessToken();
          if (ok) return attempt(true);
        }
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* no body */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
        reject(new Error((body && body.error) || `HTTP ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new Error('Nätverksfel')));
      xhr.send(formData);
    };
    attempt(false);
  });
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
