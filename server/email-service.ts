import sgMail from "@sendgrid/mail";
import sgClient from "@sendgrid/client";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = "noreply@proset.ai";
const FROM_NAME = "Proset";
const SUPPORT_EMAIL = "support@proset.ai";

let initialized = false;

function ensureInitialized(): boolean {
  if (!SENDGRID_API_KEY) {
    console.warn("SENDGRID_API_KEY not configured - email service unavailable");
    return false;
  }
  if (!initialized) {
    sgMail.setApiKey(SENDGRID_API_KEY);
    sgClient.setApiKey(SENDGRID_API_KEY);
    initialized = true;
  }
  return true;
}

export function isEmailServiceAvailable(): boolean {
  return !!SENDGRID_API_KEY;
}

export async function sendFeedbackEmail(opts: {
  category: string;
  message: string;
  userEmail?: string;
  userName?: string;
  userNumber?: string;
  attachment?: {
    filename: string;
    content: string;
    type: string;
  };
}): Promise<boolean> {
  if (!ensureInitialized()) return false;

  const { category, message, userEmail, userName, userNumber } = opts;
  const subject = `[Proset Feedback] ${category}`;
  const userInfo = [
    userName ? `Name: ${userName}` : null,
    userEmail ? `Email: ${userEmail}` : null,
    userNumber ? `User #: ${userNumber}` : null,
  ].filter(Boolean).join("\n");

  const [response] = await sgMail.send({
    to: SUPPORT_EMAIL,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    replyTo: userEmail || undefined,
    subject,
    text: `Category: ${category}\n${userInfo}\n\n${message}`,
    html: `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0A1628; border-radius: 12px; overflow: hidden;">
      <div style="padding: 28px 36px 20px; background: linear-gradient(180deg, #132240 0%, #0A1628 100%);">
        <h2 style="color: #00B4D8; margin: 0; font-size: 22px; font-weight: 700;">Proset</h2>
        <p style="color: #5A7399; margin: 4px 0 0; font-size: 13px;">Support &amp; Feedback</p>
      </div>
      <div style="padding: 0 36px 32px;">
        <div style="background: #132240; border-radius: 10px; padding: 24px; border: 1px solid #1E3355;">
          <table style="width: 100%; margin-bottom: 16px; font-size: 14px; color: #8BA4C4;">
            <tr><td style="padding: 6px 0; font-weight: 600; width: 80px; color: #F0F4F8;">Category:</td><td>${escapeHtml(category)}</td></tr>
            ${userName ? `<tr><td style="padding: 6px 0; font-weight: 600; color: #F0F4F8;">Name:</td><td>${escapeHtml(userName)}</td></tr>` : ""}
            ${userEmail ? `<tr><td style="padding: 6px 0; font-weight: 600; color: #F0F4F8;">Email:</td><td><a href="mailto:${escapeHtml(userEmail)}" style="color: #00B4D8;">${escapeHtml(userEmail)}</a></td></tr>` : ""}
            ${userNumber ? `<tr><td style="padding: 6px 0; font-weight: 600; color: #F0F4F8;">User #:</td><td>${escapeHtml(userNumber)}</td></tr>` : ""}
          </table>
          <hr style="border: none; border-top: 1px solid #1E3355; margin: 16px 0;" />
          <div style="color: #F0F4F8; font-size: 15px; line-height: 1.7; white-space: pre-wrap;">${escapeHtml(message)}</div>
        </div>
        <div style="margin-top: 24px; padding: 0 4px;">
          ${signatureBlockHtml()}
        </div>
      </div>
      <div style="padding: 16px 36px; text-align: center; border-top: 1px solid #1E3355;">
        <p style="color: #5A7399; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} <a href="https://schoedeldesign.ai" style="color: #00B4D8; text-decoration: none;">Schoedel Design AI</a></p>
      </div>
    </div>`,
    attachments: opts.attachment ? [{
      content: opts.attachment.content,
      filename: opts.attachment.filename,
      type: opts.attachment.type,
      disposition: "attachment"
    }] : undefined,
  });

  console.log(`SendGrid feedback email response: status=${response.statusCode}, to=${SUPPORT_EMAIL}, from=${FROM_EMAIL}, subject=${subject}`);
  return true;
}

export async function sendFeedbackAcknowledgmentEmail(opts: {
  to: string;
  firstName?: string;
  category: string;
  message: string;
}): Promise<boolean> {
  if (!ensureInitialized()) return false;

  const { to, firstName, category, message } = opts;
  const greeting = firstName ? `Hi ${firstName}` : "Hi there";
  const snippet = message.length > 200 ? message.slice(0, 200) + "…" : message;

  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: "Barry Schoedel" },
    replyTo: SUPPORT_EMAIL,
    subject: `We received your feedback — ${category}`,
    text: `${greeting},\n\nThanks for reaching out! We received your ${category.toLowerCase()} feedback:\n\n"${snippet}"\n\nWe'll review it and get back to you as soon as we can. If you need to add anything, contact us at support@proset.ai or use the feedback modal in the app.\n\nBarry Schoedel\nApp Maker\n\n<a href="https://schoedeldesign.ai" style="color: #00B4D8; text-decoration: none;">Schoedel Design AI</a>`,
    html: `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0A1628; border-radius: 12px; overflow: hidden;">
      <div style="padding: 28px 36px 20px; background: linear-gradient(180deg, #132240 0%, #0A1628 100%);">
        <h2 style="color: #00B4D8; margin: 0; font-size: 22px; font-weight: 700;">Proset</h2>
        <p style="color: #5A7399; margin: 4px 0 0; font-size: 13px;">We got your message</p>
      </div>
      <div style="padding: 0 36px 32px;">
        <div style="background: #132240; border-radius: 10px; padding: 24px; border: 1px solid #1E3355;">
          <p style="color: #F0F4F8; font-size: 16px; margin: 0 0 12px; font-weight: 600;">${escapeHtml(greeting)},</p>
          <p style="color: #8BA4C4; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">Thanks for reaching out! We received your feedback and will review it shortly.</p>
          <div style="background: #0A1628; border-radius: 8px; padding: 16px; border: 1px solid #1E3355; margin-bottom: 16px;">
            <p style="color: #5A7399; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px; font-weight: 600;">${escapeHtml(category)}</p>
            <p style="color: #F0F4F8; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${escapeHtml(snippet)}</p>
          </div>
          <p style="color: #8BA4C4; font-size: 14px; line-height: 1.6; margin: 0;">If you need to add anything, contact us at support@proset.ai or use the feedback modal in the app.</p>
        </div>
        <div style="margin-top: 24px; padding: 0 4px;">
          ${signatureBlockHtml()}
        </div>
      </div>
      <div style="padding: 16px 36px; text-align: center; border-top: 1px solid #1E3355;">
        <p style="color: #5A7399; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} <a href="https://schoedeldesign.ai" style="color: #00B4D8; text-decoration: none;">Schoedel Design AI</a></p>
      </div>
    </div>`,
  });

  return true;
}

export async function sendWelcomeEmail(opts: {
  to: string;
  firstName: string;
}): Promise<boolean> {
  if (!ensureInitialized()) return false;

  const { to, firstName } = opts;

  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: "Barry Schoedel" },
    subject: "Welcome to Proset!",
    html: `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0A1628; border-radius: 12px; overflow: hidden;">
      <div style="padding: 40px 36px 28px; text-align: center; background: linear-gradient(180deg, #132240 0%, #0A1628 100%);">
        <h1 style="color: #00B4D8; margin: 0; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">Proset</h1>
        <p style="color: #8BA4C4; margin: 4px 0 0; font-size: 13px; font-weight: 400;">AI-Powered Voice Notes</p>
      </div>
      <div style="padding: 0 36px 36px;">
        <div style="background: #132240; border-radius: 10px; padding: 28px; border: 1px solid #1E3355;">
          <h2 style="color: #F0F4F8; margin: 0 0 12px; font-size: 22px; font-weight: 600;">Welcome, ${escapeHtml(firstName)}!</h2>
          <p style="color: #8BA4C4; font-size: 15px; line-height: 1.7; margin: 0 0 24px;">Your account is all set. Here are a few things to get you started:</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 12px; color: #F0F4F8; font-size: 14px; line-height: 1.5; border-bottom: 1px solid #1E3355;">
                <span style="color: #00B4D8; font-weight: 600; margin-right: 8px;">&#9679;</span>
                Tap the mic to record your first voice note
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 12px; color: #F0F4F8; font-size: 14px; line-height: 1.5; border-bottom: 1px solid #1E3355;">
                <span style="color: #00B4D8; font-weight: 600; margin-right: 8px;">&#9679;</span>
                Convert your transcript into any format you need
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 12px; color: #F0F4F8; font-size: 14px; line-height: 1.5; border-bottom: 1px solid #1E3355;">
                <span style="color: #00B4D8; font-weight: 600; margin-right: 8px;">&#9679;</span>
                Export or share in multiple file types
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 12px; color: #F0F4F8; font-size: 14px; line-height: 1.5;">
                <span style="color: #00B4D8; font-weight: 600; margin-right: 8px;">&#9679;</span>
                Connect cloud backups and task integrations
              </td>
            </tr>
          </table>
        </div>
        <div style="margin-top: 28px; padding: 0 4px;">
          <p style="color: #8BA4C4; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">Have questions or feedback? Just contact us at support@proset.ai or use the feedback modal in the app or use the feedback form in the app — I'd love to hear from you.</p>
          ${signatureBlockHtml()}
        </div>
      </div>
      <div style="padding: 20px 36px; text-align: center; border-top: 1px solid #1E3355;">
        <p style="color: #5A7399; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} <a href="https://schoedeldesign.ai" style="color: #00B4D8; text-decoration: none;">Schoedel Design AI</a></p>
      </div>
    </div>`,
  });

  return true;
}

export async function sendOtpEmail(opts: {
  to: string;
  code: string;
  expiryMinutes: number;
}): Promise<boolean> {
  if (!ensureInitialized()) return false;

  const { to, code, expiryMinutes } = opts;

  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: "Proset - Your verification code",
    text: `Your verification code is: ${code}\n\nThis code expires in ${expiryMinutes} minutes.\n\nIf you didn't request this code, please ignore this email.`,
    html: `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 440px; margin: 0 auto; background: #0A1628; border-radius: 12px; overflow: hidden;">
      <div style="padding: 36px 32px 24px; text-align: center; background: linear-gradient(180deg, #132240 0%, #0A1628 100%);">
        <h2 style="color: #00B4D8; margin: 0; font-size: 24px; font-weight: 700;">Proset</h2>
        <p style="color: #8BA4C4; margin: 4px 0 0; font-size: 12px; font-weight: 400;">AI-Powered Voice Notes</p>
      </div>
      <div style="padding: 0 32px 32px; text-align: center;">
        <div style="background: #132240; border-radius: 10px; padding: 28px; border: 1px solid #1E3355;">
          <p style="color: #8BA4C4; font-size: 15px; margin: 0 0 20px;">Your verification code is:</p>
          <div style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #00B4D8; padding: 20px; background: #0A1628; border-radius: 8px; margin: 0 0 20px; border: 1px solid #1E3355;">${escapeHtml(code)}</div>
          <p style="color: #8BA4C4; font-size: 14px; margin: 0 0 4px;">This code expires in ${expiryMinutes} minutes.</p>
          <p style="color: #5A7399; font-size: 12px; margin: 12px 0 0;">If you didn't request this code, please ignore this email.</p>
        </div>
        <div style="margin-top: 24px; padding: 0 4px; text-align: left;">
          ${signatureBlockHtml()}
        </div>
      </div>
      <div style="padding: 16px 32px; text-align: center; border-top: 1px solid #1E3355;">
        <p style="color: #5A7399; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} <a href="https://schoedeldesign.ai" style="color: #00B4D8; text-decoration: none;">Schoedel Design AI</a></p>
      </div>
    </div>`,
  });

  return true;
}

export async function sendVerificationEmail(opts: {
  to: string;
  firstName: string;
  verificationUrl: string;
}): Promise<boolean> {
  if (!ensureInitialized()) {
    throw new Error("Email service is not configured. SENDGRID_API_KEY is missing.");
  }

  const { to, firstName, verificationUrl } = opts;

  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: "Proset - Verify your email",
    text: `Hi ${firstName},\n\nPlease verify your email address by clicking the link below:\n\n${verificationUrl}\n\nIf you didn't create an account, you can safely ignore this email.\n\n— Proset`,
    html: `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 440px; margin: 0 auto; background: #0A1628; border-radius: 12px; overflow: hidden;">
      <div style="padding: 36px 32px 24px; text-align: center; background: linear-gradient(180deg, #132240 0%, #0A1628 100%);">
        <h2 style="color: #00B4D8; margin: 0; font-size: 24px; font-weight: 700;">Proset</h2>
        <p style="color: #8BA4C4; margin: 4px 0 0; font-size: 12px; font-weight: 400;">AI-Powered Voice Notes</p>
      </div>
      <div style="padding: 0 32px 32px; text-align: center;">
        <div style="background: #132240; border-radius: 10px; padding: 28px; border: 1px solid #1E3355;">
          <p style="color: #F0F4F8; font-size: 16px; margin: 0 0 6px; font-weight: 600;">Hi ${escapeHtml(firstName)},</p>
          <p style="color: #8BA4C4; font-size: 15px; margin: 0 0 24px;">Please verify your email address to activate your account:</p>
          <a href="${escapeHtml(verificationUrl)}" style="display: inline-block; background: #00B4D8; color: #FFFFFF; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 10px; margin: 0 0 20px;">Verify Email</a>
          <p style="color: #5A7399; font-size: 12px; margin: 12px 0 0;">If you didn't create an account, you can safely ignore this email.</p>
          <p style="color: #5A7399; font-size: 11px; margin: 16px 0 0; word-break: break-all;">Or copy this link: ${escapeHtml(verificationUrl)}</p>
        </div>
        <div style="margin-top: 24px; padding: 0 4px; text-align: left;">
          ${signatureBlockHtml()}
        </div>
      </div>
      <div style="padding: 16px 32px; text-align: center; border-top: 1px solid #1E3355;">
        <p style="color: #5A7399; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} <a href="https://schoedeldesign.ai" style="color: #00B4D8; text-decoration: none;">Schoedel Design AI</a></p>
      </div>
    </div>`,
  });

  return true;
}

export async function sendMagicLinkEmail(opts: {
  to: string;
  firstName: string;
  magicLinkUrl: string;
}): Promise<boolean> {
  if (!ensureInitialized()) {
    throw new Error("Email service is not configured. SENDGRID_API_KEY is missing.");
  }

  const { to, firstName, magicLinkUrl } = opts;
  const safeFirstName = firstName.replace(/[\r\n]+/g, " ").trim() || "there";

  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: "Proset - Your sign-in link",
    text: `Hi ${safeFirstName},\n\nUse the secure sign-in link below to access Proset:\n\n${magicLinkUrl}\n\nThis link expires in 10 minutes and can be used once.\n\nIf you didn't request this link, you can safely ignore this email.\n\n— Proset`,
    html: `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 440px; margin: 0 auto; background: #0A1628; border-radius: 12px; overflow: hidden;">
      <div style="padding: 36px 32px 24px; text-align: center; background: linear-gradient(180deg, #132240 0%, #0A1628 100%);">
        <h2 style="color: #00B4D8; margin: 0; font-size: 24px; font-weight: 700;">Proset</h2>
        <p style="color: #8BA4C4; margin: 4px 0 0; font-size: 12px; font-weight: 400;">AI-Powered Voice Notes</p>
      </div>
      <div style="padding: 0 32px 32px; text-align: center;">
        <div style="background: #132240; border-radius: 10px; padding: 28px; border: 1px solid #1E3355;">
          <p style="color: #F0F4F8; font-size: 16px; margin: 0 0 6px; font-weight: 600;">Hi ${escapeHtml(firstName)},</p>
          <p style="color: #8BA4C4; font-size: 15px; margin: 0 0 24px;">Tap below to sign in to Proset:</p>
          <a href="${escapeHtml(magicLinkUrl)}" style="display: inline-block; background: #00B4D8; color: #FFFFFF; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 10px; margin: 0 0 20px;">Sign In Securely</a>
          <p style="color: #8BA4C4; font-size: 14px; margin: 0 0 4px;">This link expires in 10 minutes and can be used once.</p>
          <p style="color: #5A7399; font-size: 12px; margin: 12px 0 0;">If you didn&apos;t request this link, you can safely ignore this email.</p>
          <p style="color: #5A7399; font-size: 11px; margin: 16px 0 0; word-break: break-all;">Or copy this link: ${escapeHtml(magicLinkUrl)}</p>
        </div>
        <div style="margin-top: 24px; padding: 0 4px; text-align: left;">
          ${signatureBlockHtml()}
        </div>
      </div>
      <div style="padding: 16px 32px; text-align: center; border-top: 1px solid #1E3355;">
        <p style="color: #5A7399; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} <a href="https://schoedeldesign.ai" style="color: #00B4D8; text-decoration: none;">Schoedel Design AI</a></p>
      </div>
    </div>`,
  });

  return true;
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  firstName: string;
  resetUrl: string;
  expiryMinutes: number;
}): Promise<boolean> {
  if (!ensureInitialized()) {
    throw new Error("Email service is not configured. SENDGRID_API_KEY is missing.");
  }

  const { to, firstName, resetUrl, expiryMinutes } = opts;

  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: "Proset - Reset your password",
    text: `Hi ${firstName},\n\nWe received a request to reset your password. Click the link below to set a new one:\n\n${resetUrl}\n\nThis link expires in ${expiryMinutes} minutes.\n\nIf you didn't request this, you can safely ignore this email.\n\n— Proset`,
    html: `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 440px; margin: 0 auto; background: #0A1628; border-radius: 12px; overflow: hidden;">
      <div style="padding: 36px 32px 24px; text-align: center; background: linear-gradient(180deg, #132240 0%, #0A1628 100%);">
        <h2 style="color: #00B4D8; margin: 0; font-size: 24px; font-weight: 700;">Proset</h2>
        <p style="color: #8BA4C4; margin: 4px 0 0; font-size: 12px; font-weight: 400;">AI-Powered Voice Notes</p>
      </div>
      <div style="padding: 0 32px 32px; text-align: center;">
        <div style="background: #132240; border-radius: 10px; padding: 28px; border: 1px solid #1E3355;">
          <p style="color: #F0F4F8; font-size: 16px; margin: 0 0 6px; font-weight: 600;">Hi ${escapeHtml(firstName)},</p>
          <p style="color: #8BA4C4; font-size: 15px; margin: 0 0 24px;">We received a request to reset your password. Click the button below to set a new one:</p>
          <a href="${escapeHtml(resetUrl)}" style="display: inline-block; background: #00B4D8; color: #FFFFFF; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 10px; margin: 0 0 20px;">Reset Password</a>
          <p style="color: #8BA4C4; font-size: 14px; margin: 0 0 4px;">This link expires in ${expiryMinutes} minutes.</p>
          <p style="color: #5A7399; font-size: 12px; margin: 12px 0 0;">If you didn't request this, you can safely ignore this email.</p>
          <p style="color: #5A7399; font-size: 11px; margin: 16px 0 0; word-break: break-all;">Or copy this link: ${escapeHtml(resetUrl)}</p>
        </div>
        <div style="margin-top: 24px; padding: 0 4px; text-align: left;">
          ${signatureBlockHtml()}
        </div>
      </div>
      <div style="padding: 16px 32px; text-align: center; border-top: 1px solid #1E3355;">
        <p style="color: #5A7399; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} <a href="https://schoedeldesign.ai" style="color: #00B4D8; text-decoration: none;">Schoedel Design AI</a></p>
      </div>
    </div>`,
  });

  return true;
}


function signatureBlockHtml(): string {
  return `<div style="margin-top: 20px;">
    <p style="color: #F0F4F8; font-size: 15px; font-weight: 600; margin: 0; line-height: 1.4;">Barry Schoedel</p>
    <p style="color: #5A7399; font-size: 13px; margin: 2px 0 0; line-height: 1.4;">App Maker</p>
    
  </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function addEmailToWaitlist(email: string): Promise<boolean> {
  if (!ensureInitialized()) {
    console.error("Email service not initialized for waitlist.");
    return false;
  }

  try {
    const request = {
      url: '/v3/marketing/contacts',
      method: 'PUT' as const,
      body: {
        contacts: [{ email }]
      }
    };
    await sgClient.request(request);
    return true;
  } catch (err: any) {
    console.error("Failed to add to waitlist:", err.response?.body || err.message);
    return false;
  }
}

export async function sendSupportTicketEmail(opts: {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
}): Promise<boolean> {
  if (!ensureInitialized()) {
    throw new Error("Email service is not configured. SENDGRID_API_KEY is missing.");
  }

  const { name, email, subject, category, message } = opts;

  await sgMail.send({
    to: "support@proset.ai",
    from: { email: FROM_EMAIL, name: FROM_NAME },
    replyTo: email,
    subject: `[Proset Support] ${category}: ${subject}`,
    text: `New support ticket from ${name} (${email})\n\nCategory: ${category}\nSubject: ${subject}\n\n${message}\n\n— Submitted via proset.ai/support`,
    html: `<div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:0 auto;background:#0A1628;border-radius:12px;overflow:hidden">
      <div style="padding:36px 32px 24px;text-align:center;background:linear-gradient(180deg,#132240 0%,#0A1628 100%)">
        <h2 style="color:#00B4D8;margin:0;font-size:24px;font-weight:700">Proset Support</h2>
        <p style="color:#8BA4C4;margin:4px 0 0;font-size:12px;font-weight:400">New Ticket</p>
      </div>
      <div style="padding:0 32px 32px">
        <div style="background:#132240;border-radius:10px;padding:28px;border:1px solid #1E3355">
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td style="color:#5A7399;font-size:13px;padding:4px 0;width:80px">From</td><td style="color:#F0F4F8;font-size:14px">${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</td></tr>
            <tr><td style="color:#5A7399;font-size:13px;padding:4px 0">Category</td><td style="color:#00B4D8;font-size:14px;font-weight:600">${escapeHtml(category)}</td></tr>
            <tr><td style="color:#5A7399;font-size:13px;padding:4px 0">Subject</td><td style="color:#F0F4F8;font-size:14px;font-weight:600">${escapeHtml(subject)}</td></tr>
          </table>
          <div style="border-top:1px solid #1E3355;padding-top:16px;margin-top:4px">
            <p style="color:#F0F4F8;font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</p>
          </div>
        </div>
        <div style="margin-top:16px;padding:0 4px">
          <p style="color:#5A7399;font-size:12px">Submitted via <a href="https://proset.ai/support" style="color:#00B4D8">proset.ai/support</a></p>
        </div>
      </div>
    </div>`,
  });

  console.log(`SendGrid support ticket response: status=OK, to=${SUPPORT_EMAIL}, from=${email}, subject=${subject}`);
  return true;
}

export async function sendSupportAcknowledgmentEmail(opts: {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
}): Promise<boolean> {
  if (!ensureInitialized()) return false;

  const { name, email, subject, category, message } = opts;
  const firstName = name.split(" ")[0] || name;
  const snippet = message.length > 250 ? message.slice(0, 250) + "…" : message;

  try {
    await sgMail.send({
      to: email,
      from: { email: FROM_EMAIL, name: "Barry Schoedel" },
      replyTo: SUPPORT_EMAIL,
      subject: `We received your support request — ${subject}`,
      text: `Hi ${firstName},\n\nThanks for reaching out! We received your support request and will review it shortly.\n\nCategory: ${category}\nSubject: ${subject}\n\n"${snippet}"\n\nWe typically respond within 24 hours. If you need immediate help, reply to this email or reach us at support@proset.ai.\n\nBarry Schoedel\nApp Maker\nSchoedel Design AI`,
      html: `<div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:0 auto;background:#0A1628;border-radius:12px;overflow:hidden">
      <div style="padding:36px 32px 24px;text-align:center;background:linear-gradient(180deg,#132240 0%,#0A1628 100%)">
        <h2 style="color:#00B4D8;margin:0;font-size:24px;font-weight:700">Proset</h2>
        <p style="color:#8BA4C4;margin:4px 0 0;font-size:12px;font-weight:400">We got your message</p>
      </div>
      <div style="padding:0 32px 32px">
        <div style="background:#132240;border-radius:10px;padding:28px;border:1px solid #1E3355">
          <p style="color:#F0F4F8;font-size:16px;margin:0 0 6px;font-weight:600">Hi ${escapeHtml(firstName)},</p>
          <p style="color:#8BA4C4;font-size:15px;line-height:1.7;margin:0 0 20px">Thanks for reaching out! We received your support request and will review it shortly. We typically respond within 24 hours.</p>
          <div style="background:#0A1628;border-radius:8px;padding:16px;border:1px solid #1E3355;margin-bottom:16px">
            <p style="color:#5A7399;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 4px;font-weight:600">${escapeHtml(category)}</p>
            <p style="color:#F0F4F8;font-size:14px;font-weight:600;margin:0 0 8px">${escapeHtml(subject)}</p>
            <p style="color:#8BA4C4;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${escapeHtml(snippet)}</p>
          </div>
          <p style="color:#8BA4C4;font-size:14px;line-height:1.6;margin:0">If you need immediate help, reply to this email or reach us at <a href="mailto:support@proset.ai" style="color:#00B4D8">support@proset.ai</a>.</p>
        </div>
        <div style="margin-top:24px;padding:0 4px">
          <div>
            <p style="color:#F0F4F8;font-size:15px;font-weight:600;margin:0;line-height:1.4">Barry Schoedel</p>
            <p style="color:#5A7399;font-size:13px;margin:2px 0 0;line-height:1.4">App Maker</p>
          </div>
        </div>
      </div>
      <div style="padding:16px 32px;text-align:center;border-top:1px solid #1E3355">
        <p style="color:#5A7399;font-size:11px;margin:0">&copy; ${new Date().getFullYear()} <a href="https://schoedeldesign.ai" style="color:#00B4D8;text-decoration:none">Schoedel Design AI</a></p>
      </div>
    </div>`,
    });
    return true;
  } catch (err: any) {
    console.error("Support acknowledgment email failed:", err.message);
    return false;
  }
}
