import { initAuth, logout } from './auth.js';
import { initFriendsNav } from './shared.js';

await initAuth();
document.getElementById('logoutBtn').addEventListener('click', () => logout());
initFriendsNav();
