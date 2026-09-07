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

module.exports = {
  sendPasswordResetEmail,
};
