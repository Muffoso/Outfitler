import { initAuth, getAccessToken, logout as logoutAuth } from './auth.js';

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await logoutAuth();
});

await initAuth();

const token = getAccessToken();
const userInfo = document.getElementById('userInfo');

if (token) {
  const payload = JSON.parse(atob(token.split('.')[1]));
  userInfo.innerHTML = `
    <p><strong>Logged in as:</strong> ${payload.email}</p>
    <p><strong>User ID:</strong> ${payload.sub}</p>
  `;
} else {
  userInfo.innerHTML = '<p>Du är inte inloggad</p>';
  window.location.href = '/login.html';
}
