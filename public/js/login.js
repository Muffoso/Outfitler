import { authFetch } from './auth.js';

const form = document.getElementById('loginForm');
const errorDiv = document.getElementById('error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorDiv.textContent = '';

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    if (!response.ok) {
      const data = await response.json();
      errorDiv.textContent = data.error || 'Login failed';
      return;
    }

    // Access token stored in-memory via refreshAccessToken on next page load
    window.location.href = '/';
  } catch (err) {
    errorDiv.textContent = 'An error occurred';
    console.error(err);
  }
});
