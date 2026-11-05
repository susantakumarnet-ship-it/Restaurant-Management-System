/**
 * Notification service: in-app + email + SMS + WhatsApp.
 * Every message is recorded in `notifications` with its delivery status. When a provider is not
 * configured the message is written with status "logged" (and printed in dev) instead of failing.
 */
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { db } from '../db/index.js';

let transporter = null;
function mailer() {
  if (!config.mail.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  }
  return transporter;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function sendEmail(to, subject, text) {
  const t = mailer();
  if (!t) return { status: 'logged' };
  await t.sendMail({
    from: config.mail.from,
    to,
    subject,
    text,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
      <h2 style="color:#b45309;margin-top:0">${escapeHtml(subject)}</h2>
      <p style="white-space:pre-line;color:#333;line-height:1.5">${escapeHtml(text)}</p>
      <p style="color:#999;font-size:12px">Smart Restaurant Management System</p></div>`,
  });
  return { status: 'sent' };
}

async function sendSms(to, body) {
  const { twilioSid, twilioToken, twilioFrom } = config.sms;
  if (!twilioSid || !twilioToken || !twilioFrom) return { status: 'logged' };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: twilioFrom, Body: body }),
  });
  if (!res.ok) throw new Error(`SMS provider error ${res.status}`);
  return { status: 'sent' };
}

async function sendWhatsApp(to, body) {
  const { token, phoneNumberId } = config.whatsapp;
  if (!token || !phoneNumberId) return { status: 'logged' };
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { body } }),
  });
  if (!res.ok) throw new Error(`WhatsApp provider error ${res.status}`);
  return { status: 'sent' };
}

async function record(row) {
  const r = await db.one(
    `INSERT INTO notifications(user_id, branch_id, channel, type, title, message, recipient, status, link, is_read)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [row.userId || null, row.branchId || null, row.channel, row.type, row.title, row.message, row.recipient || null, row.status, row.link || null, row.channel !== 'in_app']
  );
  return r.id;
}

async function deliver(channel, sender, base, recipient) {
  if (!recipient) return;
  const id = await record({ ...base, channel, recipient, status: 'pending' });
  // External delivery is fire-and-forget so API latency doesn't depend on providers.
  Promise.resolve()
    .then(() => sender(recipient, channel === 'email' ? base.title : `${base.title}: ${base.message}`, base.message))
    .then(async (r) => {
      if (r.status === 'logged' && !config.isTest && !config.isProd) console.log(`[notify:${channel}] -> ${recipient} | ${base.title}: ${base.message}`);
      await db.query('UPDATE notifications SET status = $1 WHERE id = $2', [r.status, id]).catch(() => {});
    })
    .catch(async (e) => {
      console.error(`[notify:${channel}] failed`, e.message);
      await db.query(`UPDATE notifications SET status = 'failed', error = $1 WHERE id = $2`, [e.message.slice(0, 500), id]).catch(() => {});
    });
}

/**
 * @param {object} n
 * @param {number} [n.userId]  recipient user (gets an in-app notification)
 * @param {number} [n.branchId] branch (used for admin feed)
 * @param {boolean} [n.adminFeed] also post to the branch admin notification feed
 * @param {string} n.type  e.g. booking_confirmed
 * @param {string} n.title
 * @param {string} n.message
 * @param {string} [n.email] @param {string} [n.phone]
 * @param {string[]} [n.channels] subset of in_app/email/sms/whatsapp
 */
export async function notify(n) {
  const channels = n.channels || ['in_app', 'email', 'sms', 'whatsapp'];
  const base = { userId: n.userId, branchId: n.branchId, type: n.type, title: n.title, message: n.message, link: n.link };
  try {
    if (channels.includes('in_app') && n.userId) await record({ ...base, channel: 'in_app', status: 'sent' });
    if (n.adminFeed && n.branchId) {
      await record({ ...base, userId: null, channel: 'in_app', status: 'sent', title: n.adminTitle || n.title, message: n.adminMessage || n.message, link: n.adminLink || n.link });
    }
    if (channels.includes('email')) await deliver('email', (to, subject, text) => sendEmail(to, subject, text), base, n.email);
    if (channels.includes('sms')) await deliver('sms', (to, body) => sendSms(to, body), base, n.phone);
    if (channels.includes('whatsapp') && config.whatsapp.token) await deliver('whatsapp', (to, body) => sendWhatsApp(to, body), base, n.phone);
  } catch (e) {
    // Notifications must never break the business operation that triggered them.
    console.error('[notify] error', e.message);
  }
}

export const providers = {
  email: () => (config.mail.host ? 'smtp' : 'log'),
  sms: () => (config.sms.twilioSid ? 'twilio' : 'log'),
  whatsapp: () => (config.whatsapp.token ? 'meta-cloud-api' : 'disabled'),
};
