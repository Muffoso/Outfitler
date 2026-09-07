const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const nonce = res.locals.nonce;

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .container { max-width: 600px; margin: 50px auto; padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { margin-bottom: 20px; font-size: 28px; }
    .user-info { margin-bottom: 20px; padding: 10px; background: #f0f0f0; border-radius: 4px; }
    .user-info p { margin: 5px 0; }
    button { padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; }
    button:hover { background: #c82333; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Welcome</h1>
    <div id="userInfo" class="user-info">
      <p>Loading user info...</p>
    </div>
    <button id="logoutBtn">Log out</button>
  </div>

  <script type="module" nonce="${nonce}">
    import { initAuth, getAccessToken, logout as logoutAuth } from './js/auth.js';

    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn.addEventListener('click', async () => {
      await logoutAuth();
    });

    await initAuth();

    const token = getAccessToken();
    const userInfo = document.getElementById('userInfo');

    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userInfo.innerHTML = '<p><strong>Logged in as:</strong> ' + payload.email + '</p><p><strong>User ID:</strong> ' + payload.sub + '</p>';
    } else {
      userInfo.innerHTML = '<p>Du är inte inloggad</p>';
      window.location.href = '/login.html';
    }
  </script>
</body>
</html>`;

  res.send(html);
});

module.exports = router;
