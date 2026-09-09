const nodemailer = require('nodemailer');
const config = require('../config');

// Two delivery paths, in order of preference:
//   1. Brevo HTTP API (port 443) — set BREVO_API_KEY. Works on hosts that block
//      outbound SMTP (Railway does).
//   2. SMTP via nodemailer — the SMTP_* vars.
// If neither looks configured, sends are skipped (logged, never throw).

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: { user: config.smtp.user, pass: config.smtp.pass },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

const apiConfigured = !!config.brevoApiKey;
const smtpConfigured = !!config.smtp.host && config.smtp.host !== 'smtp.example.com';

// Parse EMAIL_FROM ("Outfitler <hej@x.se>" or "hej@x.se") into { name, email }.
const parseSender = (raw) => {
  const s = (raw || '').trim();
  const m = s.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1] || 'Outfitler', email: m[2].trim() };
  return { name: 'Outfitler', email: s };
};

const sendViaBrevoApi = async ({ to, subject, html }) => {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseSender(config.smtp.from),
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
  }
};

const sendViaSmtp = async ({ to, subject, html }) => {
  await transporter.sendMail({ from: config.smtp.from, to, subject, html });
};

// Deliver one message. Returns true if it went out, false otherwise. Never throws.
const deliver = async (label, message) => {
  try {
    if (apiConfigured) {
      await sendViaBrevoApi(message);
      return true;
    }
    if (smtpConfigured) {
      await sendViaSmtp(message);
      return true;
    }
    console.warn(`${label} skipped: no email transport configured (set BREVO_API_KEY or SMTP_*)`);
    return false;
  } catch (err) {
    console.error(`${label} failed:`, err.message);
    return false;
  }
};

const sendPasswordResetEmail = async (email, resetToken) => {
  const link = `${config.appUrl}/reset-password.html?token=${resetToken}`;
  const sent = await deliver('Password reset email', {
    to: email,
    subject: 'Password Reset',
    html: `
      <h2>Password Reset Request</h2>
      <p>Click the link below to reset your password:</p>
      <a href="${link}">${link}</a>
      <p>This link expires in 30 minutes.</p>
      <p>If you didn't request this, ignore this email.</p>
    `,
  });
  if (!sent) throw new Error('Password reset email could not be sent');
};

// Invite to someone who does not have an account yet.
const sendFriendInviteEmail = (email, inviterEmail, token) => deliver('Friend invite email', {
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

// A plain "you might like Outfitler" — no friend request attached.
const sendAppRecommendationEmail = (email, inviterEmail) => deliver('App recommendation email', {
  to: email,
  subject: 'Ett tips: Outfitler',
  html: `
    <h2>${inviterEmail} tror att du skulle gilla Outfitler</h2>
    <p>Outfitler är en app för att hålla koll på dina kläder och outfits.</p>
    <p><a href="${config.appUrl}">${config.appUrl}</a></p>
  `,
});

// Friend request to an existing user.
const sendFriendRequestEmail = (email, inviterEmail) => deliver('Friend request email', {
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
  sendAppRecommendationEmail,
};
