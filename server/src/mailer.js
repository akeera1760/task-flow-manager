import nodemailer from "nodemailer";

function getSmtpConfig() {
  const smtpUrl = process.env.SMTP_URL;

  if (smtpUrl) {
    return { url: smtpUrl };
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const service = process.env.SMTP_SERVICE || "gmail";

  if (!user || !pass) {
    return null;
  }

  if (host) {
    return {
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
      auth: { user, pass }
    };
  }

  return {
    service,
    auth: { user, pass }
  };
}

function createTransporter() {
  const config = getSmtpConfig();

  if (!config) {
    return null;
  }

  return config.url ? nodemailer.createTransport(config.url) : nodemailer.createTransport(config);
}

export async function sendPasswordResetEmail({ to, name, token }) {
  const transporter = createTransporter();

  if (!transporter) {
    return {
      sent: false,
      reason: "SMTP_NOT_CONFIGURED"
    };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@localhost";
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const subject = "Task Manager Password Reset";

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 16px;">Password Reset Request</h2>
      <p>Hi ${name || "User"},</p>
      <p>We received a request to reset your password.</p>
      <p style="margin-bottom: 8px;">Your reset token is:</p>
      <div style="background: #f3f4f6; padding: 14px 18px; font-size: 20px; font-weight: 700; letter-spacing: 3px; width: fit-content; border-radius: 8px;">${token}</div>
      <p style="margin-top: 16px;">This token expires in 30 minutes.</p>
      <p>Open <a href="${appUrl}">${appUrl}</a> and paste the token into the reset password form.</p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `;

  const text = [
    `Hi ${name || "User"},`,
    "",
    "We received a request to reset your password.",
    `Your reset token is: ${token}`,
    "",
    "This token expires in 30 minutes.",
    `Open ${appUrl} and paste the token into the reset password form.`,
    "",
    "If you did not request this, you can ignore this email."
  ].join("\n");

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html
  });

  return {
    sent: true
  };
}