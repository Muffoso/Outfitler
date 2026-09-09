const nodemailer = require('nodemailer');
const config = require('../config');

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
  // Fail fast instead of hanging when SMTP is misconfigured / unreachable.
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

// True once we've decided SMTP looks real enough to attempt a send.
const smtpConfigured = !!config.smtp.host && config.smtp.host !== 'smtp.example.com';

const sendPasswordResetEmail = async (email, resetToken) => {
  const resetLink = `${config.appUrl}/reset-password.html?token=${resetToken}`;

  const htmlContent = `
    <h2>Password Reset Request</h2>
    <p>Click the link below to reset your password:</p>
    <a href="${resetLink}">${resetLink}</a>
    <p>This link expires in 30 minutes.</p>
    <p>If you didn't request this, ignore this email.</p>
  `;

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: 'Password Reset',
      html: htmlContent,
    });
  } catch (err) {
    console.error('Failed to send email:', err);
    throw err;
  }
};

// Best-effort friend email. Never throws — returns true if it went out.
const trySend = async (label, message) => {
  if (!smtpConfigured) {
    console.warn(`${label} skipped: SMTP not configured (SMTP_HOST=${config.smtp.host})`);
    return false;
  }
  try {
    await transporter.sendMail({ from: config.smtp.from, ...message });
    return true;
  } catch (err) {
    console.error(`${label} failed:`, err.message);
    return false;
  }
};

// Invite to someone who does not have an account yet.
const sendFriendInviteEmail = (email, inviterEmail, token) => trySend('Friend invite email', {
  to: email,
  subject: 'Vänförfrågan på Outfitler',
  html: `
    <h2>${inviterEmail} vill bli vän med dig på Outfitler</h2>
    <p>Outfitler är en app för att hålla koll på dina kläder och outfits. Skapa ett
       konto så kopplas ni ihop och ni kan besöka varandras garderober.</p>
    <p><a href="${config.appUrl}/register.html?invite=${token}">${config.appUrl}/register.html?invite=${token}</a></p>
    <p>Om du inte vet vad det här är kan du ignorera mejlet.</p>
  `,
});

// Friend request to an existing user.
const sendFriendRequestEmail = (email, inviterEmail) => trySend('Friend request email', {
  to: email,
  subject: 'Vänförfrågan på Outfitler',
  html: `
    <h2>${inviterEmail} vill bli vän med dig på Outfitler</h2>
    <p>Logga in och svara på förfrågan:</p>
    <p><a href="${config.appUrl}/friends.html">${config.appUrl}/friends.html</a></p>
  `,
});

module.exports = {
  sendPasswordResetEmail,
  sendFriendInviteEmail,
  sendFriendRequestEmail,
};
