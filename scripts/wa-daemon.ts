/**
 * Standalone WhatsApp daemon — runs independently of ClaudeClaw.
 * - Keeps a WhatsApp Web session alive via whatsapp-web.js + Puppeteer
 * - Exposes CDP on port 9222 (fixed) for live chat/message reads
 * - HTTP API on port 4242 for status + queued sends
 * - Polls wa_outbox SQLite table every 3s and delivers pending messages
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import Database from 'better-sqlite3';
import qrcode from 'qrcode-terminal';
import wwebjs from 'whatsapp-web.js';

const { Client, LocalAuth } = wwebjs;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_DIR = path.resolve(__dirname, '../store');
const DB_PATH   = path.join(STORE_DIR, 'claudeclaw.db');
const SESSION   = path.join(STORE_DIR, 'waweb');
const PID_FILE  = path.join(STORE_DIR, 'wa-daemon.pid');
const CDP_PORT  = 9222;
const HTTP_PORT = 4242;

// ── PID lock ────────────────────────────────────────────────────────
fs.mkdirSync(STORE_DIR, { recursive: true });
if (fs.existsSync(PID_FILE)) {
  const old = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  if (!isNaN(old) && old !== process.pid) {
    try {
      process.kill(old, 'SIGTERM');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    } catch { /* already dead */ }
  }
}
fs.writeFileSync(PID_FILE, String(process.pid));
const cleanup = () => { try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ } };
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// ── DB ──────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS wa_outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    to_chat_id TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sent_at    INTEGER
  );
  CREATE TABLE IF NOT EXISTS wa_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id      TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    body         TEXT NOT NULL,
    timestamp    INTEGER NOT NULL,
    is_from_me   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wa_outbox_unsent  ON wa_outbox(sent_at)               WHERE sent_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_wa_messages_chat  ON wa_messages(chat_id, timestamp DESC);
`);

// ── WhatsApp client ─────────────────────────────────────────────────
let ready = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--remote-debugging-port=${CDP_PORT}`,
    ],
  },
});

client.on('qr', (qr: string) => {
  console.log('\n  Scan with WhatsApp > Linked Devices:\n');
  qrcode.generate(qr, { small: true });
  // Also write raw QR string to file for external rendering
  fs.writeFileSync(path.join(STORE_DIR, 'qr-latest.txt'), qr);
  console.log('[wa-daemon] QR string saved to store/qr-latest.txt');
});

client.on('authenticated', () => console.log('[wa-daemon] authenticated'));

client.on('ready', () => {
  ready = true;
  console.log(`[wa-daemon] connected ✓  CDP :${CDP_PORT}  HTTP :${HTTP_PORT}`);
  startOutboxPoller();
});

client.on('disconnected', async (r: string) => {
  ready = false;
  console.warn('[wa-daemon] disconnected:', r);
  console.log('[wa-daemon] attempting reconnect in 10s...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  try {
    await client.initialize();
  } catch (err) {
    console.error('[wa-daemon] reconnect failed:', err);
  }
});

client.on('message', async (msg: wwebjs.Message) => {
  if (msg.fromMe || msg.from === 'status@broadcast' || !msg.body) return;
  try {
    const contact = await msg.getContact();
    const name = contact.pushname || contact.name || msg.from.replace(/@[cg]\.us$/, '');
    db.prepare(
      `INSERT INTO wa_messages (chat_id, contact_name, body, timestamp, is_from_me, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
    ).run(msg.from, name, msg.body, msg.timestamp, Math.floor(Date.now() / 1000));
  } catch (err) {
    console.error('[wa-daemon] message handler error:', err);
  }
});

function startOutboxPoller(): void {
  setInterval(async () => {
    const pending = db.prepare(
      `SELECT id, to_chat_id, body FROM wa_outbox WHERE sent_at IS NULL ORDER BY created_at`,
    ).all() as Array<{ id: number; to_chat_id: string; body: string }>;

    for (const item of pending) {
      try {
        await client.sendMessage(item.to_chat_id, item.body);
        db.prepare(`UPDATE wa_outbox SET sent_at = ? WHERE id = ?`)
          .run(Math.floor(Date.now() / 1000), item.id);
      } catch (err) {
        console.error('[wa-daemon] outbox send error:', err);
      }
    }
  }, 3000);
}

// ── HTTP API ────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/status') {
    res.end(JSON.stringify({ ready, cdpPort: CDP_PORT }));
    return;
  }

  // GET /download-media?chatId=xxx@c.us&msgTs=1234567890
  // Finds the message by chatId + timestamp, downloads + decrypts media,
  // returns { mimetype, data (base64), filename }
  if (req.method === 'GET' && req.url?.startsWith('/download-media')) {
    const url = new URL(req.url, 'http://localhost');
    const chatId = url.searchParams.get('chatId');
    const msgTs  = parseInt(url.searchParams.get('msgTs') ?? '0', 10);

    if (!chatId || !msgTs) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'chatId and msgTs required' }));
      return;
    }

    (async () => {
      try {
        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 50 });
        const msg = messages.find((m) => m.timestamp === msgTs && m.hasMedia);
        if (!msg) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'media message not found' }));
          return;
        }
        const media = await msg.downloadMedia();
        if (!media) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'download returned null' }));
          return;
        }
        res.end(JSON.stringify({ mimetype: media.mimetype, data: media.data, filename: media.filename ?? null }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
      }
    })();
    return;
  }

  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const { chatId, text } = JSON.parse(body) as { chatId: string; text: string };
        if (!chatId || !text) { res.statusCode = 400; res.end(JSON.stringify({ error: 'chatId and text required' })); return; }
        db.prepare(`INSERT INTO wa_outbox (to_chat_id, body, created_at) VALUES (?, ?, ?)`)
          .run(chatId, text, Math.floor(Date.now() / 1000));
        res.end(JSON.stringify({ queued: true }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`[wa-daemon] HTTP API listening on :${HTTP_PORT}`);
});

// Retry initialize — WhatsApp Web sometimes navigates mid-injection
// ("Execution context was destroyed" is a known transient race condition)
(async () => {
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.initialize();
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTransient = errMsg.includes('Execution context was destroyed')
        || errMsg.includes('navigation')
        || errMsg.includes('Target closed')
        || errMsg.includes('Protocol error');
      console.error(`[wa-daemon] initialize attempt ${attempt}/${MAX_RETRIES} failed${isTransient ? ' (transient)' : ''}:`, errMsg);
      if (attempt === MAX_RETRIES) {
        console.error('[wa-daemon] all retries exhausted, exiting');
        process.exit(1);
      }
      // Exponential backoff: 5s, 10s, 15s, 20s
      const delay = attempt * 5000;
      console.log(`[wa-daemon] retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
})();
