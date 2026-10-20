const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeid } = require('./id');

const {
  default: Toxic_Tech,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  generateWAMessageFromContent,
  proto,
} = require('@whiskeysockets/baileys');

const router = express.Router();
const sessionDir = path.join(__dirname, "temp");

function removeFile(filePath) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
  const id = makeid();
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  const tempDir = path.join(sessionDir, id);
  let responseSent = false;
  let sessionCleanedUp = false;
  let sessionSent = false;
  let currentSock = null;

  if (!num || num.length < 7) {
    return res.status(400).json({ code: 'Please provide a valid phone number.' });
  }

  async function cleanUpSession() {
    if (!sessionCleanedUp) {
      try { removeFile(tempDir); } catch (e) { console.error("Cleanup error:", e); }
      sessionCleanedUp = true;
    }
    if (currentSock?.ws) {
      try { currentSock.ws.close(); } catch {}
    }
  }

  async function startPairing() {
    try {
      let version;
      try {
        version = (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version;
        if (!Array.isArray(version) || version.length < 3) throw new Error('bad version');
      } catch {
        version = [2, 3000, 1015901307];
        console.log('⚠️ Version fetch failed...using fallback:', version.join('.'));
      }

      const { state, saveCreds } = await useMultiFileAuthState(tempDir);

      const sock = Toxic_Tech({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        browser: Browsers.macOS("Chrome"),
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
        getMessage: async () => undefined,
        markOnlineOnConnect: true,
        connectTimeoutMs: 120000,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        fireInitQueries: true,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 2000,
        transactionOpts: {
          maxCommitRetries: 10,
          delayBetweenTriesMs: 3000
        }
      });

      currentSock = sock;

      if (!state.creds.registered) {
        await delay(3000);
        const code = await sock.requestPairingCode(num);
        if (!responseSent && !res.headersSent) {
          res.json({ code });
          responseSent = true;
        }
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          sessionSent = true;
          console.log('✔️ pkxmd bot successfully connected to WhatsApp.');

          try { await sock.newsletterFollow('120363417804135599@newsletter'); } catch {}

          const userJid = sock.user.id.includes(':')
            ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
            : sock.user.id;

          try {
            await sock.sendMessage(userJid, {
              text: `│❒ Hello! 👋 PK-XMD Session INCOMING WAIT HERE IT IS 😂😂....👇`
            });
          } catch {}

          await delay(5000);
          await saveCreds();
          await delay(2000);

          const credsPath = path.join(tempDir, "creds.json");
          let sessionData = null;
          let attempts = 0;
          const maxAttempts = 10;

          while (attempts < maxAttempts && !sessionData) {
            try {
              if (fs.existsSync(credsPath)) {
                const data = fs.readFileSync(credsPath);
                if (data && data.length > 100) {
                  sessionData = data;
                  console.log(`✅ Session data found (${data.length} bytes) on attempt ${attempts + 1}`);
                  break;
                } else {
                  console.log(`⚠️ Session file too small: ${data?.length || 0} bytes`);
                }
              } else {
                console.log(`⚠️ Session file not found yet, attempt ${attempts + 1}/${maxAttempts}`);
              }
              await delay(3000);
              attempts++;
            } catch (readError) {
              console.error("Read attempt error:", readError);
              await delay(3000);
              attempts++;
            }
          }

          if (!sessionData) {
            console.error("Failed to read session data after all attempts");
            try { await sock.sendMessage(userJid, { text: "Failed to generate session. Please try again." }); } catch {}
            await cleanUpSession();
            return;
          }

          const base64 = "pk~" + Buffer.from(sessionData).toString('base64');

          try {
            console.log('📤 Sending session data to user...');
            const sessionMsg = await generateWAMessageFromContent(userJid, proto.Message.fromObject({
                interactiveMessage: {
                    body: { text: base64 },
                    footer: { text: '' },
                    nativeFlowMessage: {
                        messageVersion: 1,
                        buttons: [{
                            name: 'cta_copy',
                            buttonParamsJson: JSON.stringify({ display_text: 'Copy Session id', copy_code: base64 })
                        }],
                        messageParamsJson: ''
                    }
                }
            }), { userJid: sock.user.id });

            const sentSession = await sock.relayMessage(userJid, sessionMsg.message, { messageId: sessionMsg.key.id });

            await delay(3000);

            await sock.sendMessage(userJid, {
              text: `*PK-XMD CONNECTED ✅*

🤖 Bot active!

🔗 Repo: https://github.com/officialpkdriller/PK-XMD
📢 whatsapp channel ☣️: https://whatsapp.com/channel/0029VbAchaI59PwSijs6a81f
🌐 Dev: https://contact-pk-three.vercel.app/

Powered by PK-XMD Inc 🚀`
            }, { quoted: sentSession });

            await delay(5000);
            await cleanUpSession();
          } catch (sendError) {
            console.error("Error sending session:", sendError);
            await cleanUpSession();
          }

        } else if (connection === 'close') {
          if (sessionSent) return;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (statusCode === 401) {
            console.log('❌ Connection closed permanently (logged out)');
            await cleanUpSession();
          } else {
            console.log('⚠️ Connection closed, reconnecting...');
            await delay(3000);
            await startPairing();
          }
        }
      });

    } catch (err) {
      console.error('❌ Error during pairing:', err);
      await cleanUpSession();
      if (!responseSent && !res.headersSent) {
        res.status(500).json({ code: 'Service Unavailable. Please try again.' });
        responseSent = true;
      }
    }
  }

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Pairing process timeout")), 420000);
  });

  try {
    await Promise.race([startPairing(), timeoutPromise]);
  } catch (finalError) {
    console.error("Final error:", finalError);
    await cleanUpSession();
    if (!responseSent && !res.headersSent) {
      res.status(500).json({ code: "Service Error - Timeout" });
    }
  }
});

module.exports = router;
