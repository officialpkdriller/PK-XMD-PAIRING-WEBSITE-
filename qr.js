const { makeid } = require('./id');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const {
    default: Toxic_Tech,
    useMultiFileAuthState,
    Browsers,
    delay,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    generateWAMessageFromContent,
    proto
} = require('@whiskeysockets/baileys');

const router = express.Router();
const tempRoot = path.join(__dirname, 'temp');

if (!fs.existsSync(tempRoot)) {
    fs.mkdirSync(tempRoot, { recursive: true });
}

function removeFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { recursive: true, force: true });
        }
    } catch {}
}

router.get('/', async (req, res) => {
    const id = makeid();
    const sessionDir = path.join(tempRoot, id);

    let responseSent = false;
    let finished     = false;
    let reconnecting = false;
    let sock         = null;

    function cleanupSync() {
        try {
            if (sock?.ev) {
                try { sock.ev.removeAllListeners(); } catch {}
            }
            if (sock?.ws) {
                try { sock.ws.close(); } catch {}
            }
        } catch {}
        removeFile(sessionDir);
    }

    async function fail(message, status) {
        if (finished) return;
        finished = true;
        cleanupSync();
        if (!responseSent && !res.headersSent) {
            res.status(status || 500).json({ code: message });
            responseSent = true;
        }
    }

    async function startSocket() {
        if (finished) return;
        try {
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            const { version } = await fetchLatestBaileysVersion();

            if (sock?.ev) {
                try { sock.ev.removeAllListeners('connection.update'); } catch {}
                try { sock.ev.removeAllListeners('creds.update'); } catch {}
            }

            sock = Toxic_Tech({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'silent' })
                    ),
                },
                printQRInTerminal:              false,
                logger:                         pino({ level: 'silent' }),
                browser:                        Browsers.macOS('Chrome'),
                syncFullHistory:                false,
                connectTimeoutMs:               120000,
                keepAliveIntervalMs:            10000,
                retryRequestDelayMs:            2000,
                maxRetries:                     10,
                generateHighQualityLinkPreview: true,
                markOnlineOnConnect:            false,
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                try {
                    const { connection, lastDisconnect, qr } = update;

                    if (finished) return;

                    if (qr && !responseSent && !res.headersSent) {
                        try {
                            const buf = await QRCode.toBuffer(qr, {
                                type: 'png', width: 300, margin: 2,
                                color: { dark: '#000000', light: '#ffffff' },
                                errorCorrectionLevel: 'M',
                            });
                            res.setHeader('Content-Type', 'image/png');
                            res.setHeader('Cache-Control', 'no-store');
                            res.end(buf);
                        } catch {
                            if (!res.headersSent) res.json({ qr });
                        }
                        responseSent = true;
                    }

                    if (connection === 'open') {
                        finished = true;

                        try { await sock.newsletterFollow('120363417804135599@newsletter'); } catch {}

                        const userJid = sock.user.id.includes(':')
                            ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
                            : sock.user.id;

                        try {
                            await sock.sendMessage(userJid, {
                                text: `Hello! 👋 PK-XMDBOT CONNECTEDSUCCESSFULLY INCOMINGSESSION_ID😊👇....`
                            });
                        } catch {}

                        await delay(5000);
                        await saveCreds();
                        await delay(2000);

                        const credsPath = path.join(sessionDir, 'creds.json');
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
                                    console.log(`⚠️ Session file not found yet, attempt \( {attempts + 1}/ \){maxAttempts}`);
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
                            cleanupSync();
                            return;
                        }

                        const b64data = Buffer.from(sessionData).toString('base64');

                        try {
                            console.log(' Sending session data to user...');
                            const sessionMsg = await generateWAMessageFromContent(userJid, proto.Message.fromObject({
                                interactiveMessage: {
                                    body: { text: b64data },
                                    footer: { text: '' },
                                    nativeFlowMessage: {
                                        messageVersion: 1,
                                        buttons: [{
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({ display_text: 'Copy Session id', copy_code: b64data })
                                        }],
                                        messageParamsJson: ''
                                    }
                                }
                            }), { userJid: sock.user.id });

                            const sentSession = await sock.relayMessage(userJid, sessionMsg.message, { messageId: sessionMsg.key.id });

                            await delay(3000);

                            await sock.sendMessage(
                                userJid,
                                {
                                    text: `*IMEFANIKIWA! PK-XMD IKO ONLINE ✅*

Bot yako iko tayari kuwaka 🔥

⭐ Repo github: https://github.com/officialpkdriller/PK-XMD
📢 follow on WhatsApp: https://whatsapp.com/channel/0029VbAchaI59PwSijs6a81f
💬 messagedeveloper: .https://contact-pk-three.vercel.app/

_PK-XMD - WE ARE BACK_ 💪`
                                },
                                { quoted: sentSession }
                            );
                        } catch (sendError) {
                            console.error("Error sending session:", sendError);
                            try {
                                const fallback = await sock.sendMessage(userJid, { text: b64data });
                                await sock.sendMessage(userJid, { text: `SESSION CONNECTED✔️` }, { quoted: fallback });
                            } catch {}
                        }

                        await delay(1000);
                        cleanupSync();
                        return;
                    }

                    if (connection === 'close') {
                        if (finished) return;

                        const statusCode =
                            lastDisconnect?.error?.output?.statusCode ||
                            lastDisconnect?.error?.statusCode;

                        if (statusCode === 401) {
                            return await fail('Logged out. Please try again.');
                        }

                        if (!reconnecting) {
                            reconnecting = true;
                            await delay(statusCode === 515 ? 1000 : 3000);
                            reconnecting = false;
                            return startSocket();
                        }
                    }

                } catch (err) {
                    if (!finished) await fail('Service is Currently Unavailable. Please try again.');
                }
            });

        } catch (err) {
            if (!finished) await fail('Service is Currently Unavailable. Please try again.');
        }
    }

    const globalTimeout = setTimeout(function () {
        if (!finished) fail('Request timed out. Please try again.');
    }, 420000);

    try {
        await startSocket();
    } catch {}

    return;
});

module.exports = router;
