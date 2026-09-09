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
});

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

// Invite to someone who does not have an account yet.
const sendFriendInviteEmail = async (email, inviterEmail, token) => {
  const link = `${config.appUrl}/register.html?invite=${token}`;
  const htmlContent = `
    <h2>${inviterEmail} vill bli vän med dig på Outfitler</h2>
    <p>Outfitler är en app för att hålla koll på dina kläder och outfits. Skapa ett
       konto så kopplas ni ihop och ni kan besöka varandras garderober.</p>
    <p><a href="${link}">${link}</a></p>
    <p>Om du inte vet vad det här är kan du ignorera mejlet.</p>
  `;
  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: 'Vänförfrågan på Outfitler',
      html: htmlContent,
    });
  } catch (err) {
    console.error('Failed to send friend invite email:', err);
    throw err;
  }
};

// Friend request to an existing user.
const sendFriendRequestEmail = async (email, inviterEmail) => {
  const link = `${config.appUrl}/friends.html`;
  const htmlContent = `
    <h2>${inviterEmail} vill bli vän med dig på Outfitler</h2>
    <p>Logga in och svara på förfrågan:</p>
    <p><a href="${link}">${link}</a></p>
  `;
  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: 'Vänförfrågan på Outfitler',
      html: htmlContent,
    });
  } catch (err) {
    console.error('Failed to send friend request email:', err);
    throw err;
  }
};

module.exports = {
  sendPasswordResetEmail,
  sendFriendInviteEmail,
  sendFriendRequestEmail,
};
