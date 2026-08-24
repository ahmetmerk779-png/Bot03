const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { SocksClient } = require('socks');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Bot ve Sunucu Yapılandırması
let CONFIG = {
    host: 'play.aesirmc.com',
    port: 25565,
    username: 'BotIsmin',
    password: '',
    targetServer: 'asmp',
    mcVersion: '1.20.4',
    proxyHost: '',
    proxyPort: '',
    proxyUser: '',
    proxyPass: '',
    reconnectInterval: 8000,
    antiAfkInterval: 180000
};

let bot = null;
let reconnectTimer = null;
let antiAfkTimer = null;
let lastLogs = [];

function log(msg) {
    const time = new Date().toLocaleTimeString('tr-TR');
    const logEntry = `[${time}] ${msg}`;
    console.log(logEntry);
    lastLogs.unshift(logEntry);
    if (lastLogs.length > 25) lastLogs.pop();
}

const botStats = {
    status: 'Kapalı / Başlatılmadı',
    health: 20,
    food: 20,
    currentServer: 'Belirsiz',
    reconnects: 0
};

function createBot() {
    if (!CONFIG.username || CONFIG.username === 'BotIsmin') {
        botStats.status = 'Kullanıcı adı girilmedi!';
        log('Lütfen web panelinden kullanıcı adınızı yazın.');
        return;
    }

    cleanUpBot();

    botStats.status = 'Proxy Sunucusuna Bağlanılıyor...';
    log(`${CONFIG.host}:${CONFIG.port} adresine bağlanılıyor (${CONFIG.username}) - Sürüm: ${CONFIG.mcVersion}...`);

    const botOptions = {
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
        version: CONFIG.mcVersion || '1.20.4'
    };

    // SOCKS5 Proxy Yapılandırması (Varsa aktif eder)
    if (CONFIG.proxyHost && CONFIG.proxyPort) {
        log(`SOCKS5 Proxy aktif: ${CONFIG.proxyHost}:${CONFIG.proxyPort}`);
        botOptions.connect = (client) => {
            SocksClient.createConnection({
                proxy: {
                    host: CONFIG.proxyHost,
                    port: parseInt(CONFIG.proxyPort),
                    type: 5,
                    userId: CONFIG.proxyUser || undefined,
                    password: CONFIG.proxyPass || undefined
                },
                command: 'connect',
                destination: {
                    host: CONFIG.host,
                    port: CONFIG.port
                }
            }, (err, info) => {
                if (err) {
                    log(`Proxy Bağlantı Hatası: ${err.message}`);
                    client.emit('error', err);
                    return;
                }
                client.setSocket(info.socket);
                client.emit('connect');
            });
        };
    }

    try {
        bot = mineflayer.createBot(botOptions);
    } catch (err) {
        log(`Bot başlatma hatası: ${err.message}`);
        triggerReconnect('Başlatma Hatası');
        return;
    }

    bot.on('spawn', () => {
        botStats.status = 'Çevrimiçi (Lobi / Proxy)';
        log('Sunucuya giriş yapıldı.');

        // 1. Şifre Girişi (/login)
        setTimeout(() => {
            if (bot && CONFIG.password) {
                bot.chat(`/login ${CONFIG.password}`);
                log('/login şifre komutu gönderildi.');
            }
        }, 2000);

        // 2. Alt Sunucuya Otomatik Geçiş (/gir)
        setTimeout(() => {
            if (bot && CONFIG.targetServer) {
                switchServer(CONFIG.targetServer);
            }
        }, 5000);

        startAntiAfk();
    });

    bot.on('health', () => {
        if (bot && bot.health !== undefined) botStats.health = Math.round(bot.health);
        if (bot && bot.food !== undefined) botStats.food = Math.round(bot.food);
    });

    bot.on('messagestr', (message) => {
        const cleanMsg = message.trim();
        if (cleanMsg) {
            log(`[CHAT] ${cleanMsg}`);
        }
    });

    bot.on('kicked', (reason) => {
        let parsedReason = reason;
        try { parsedReason = JSON.stringify(reason); } catch (e) {}
        triggerReconnect(`Kicked: ${parsedReason}`);
    });

    bot.on('end', () => triggerReconnect('Sunucu Bağlantıyı Kesti'));
    bot.on('error', (err) => triggerReconnect(`Hata: ${err.message}`));
}

function cleanUpBot() {
    if (antiAfkTimer) {
        clearInterval(antiAfkTimer);
        antiAfkTimer = null;
    }
    if (bot) {
        bot.removeAllListeners();
        try { bot.quit(); } catch (e) {}
        bot = null;
    }
}

function startAntiAfk() {
    if (antiAfkTimer) clearInterval(antiAfkTimer);
    antiAfkTimer = setInterval(() => {
        if (bot && bot.entity) {
            bot.setControlState('jump', true);
            setTimeout(() => {
                if (bot) bot.setControlState('jump', false);
            }, 400);
            bot.look(Math.random() * Math.PI * 2, 0);
            log('Anti-AFK: Hareket edildi.');
        }
    }, CONFIG.antiAfkInterval);
}

function triggerReconnect(reason) {
    botStats.status = `Koptu (${reason}) - Yeniden Bağlanılıyor...`;
    log(`Bağlantı koptu. Nedeni: ${reason}`);

    cleanUpBot();

    if (!reconnectTimer) {
        botStats.reconnects++;
        log(`${CONFIG.reconnectInterval / 1000} saniye içinde tekrar bağlanılacak...`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            createBot();
        }, CONFIG.reconnectInterval);
    }
}

function switchServer(serverName) {
    if (bot && serverName) {
        CONFIG.targetServer = serverName;
        bot.chat(`/gir ${serverName}`);
        botStats.currentServer = serverName.toUpperCase();
        botStats.status = `${serverName.toUpperCase()} Sunucusunda AFK`;
        log(`Alt sunucuya geçiliyor: /gir ${serverName}`);
    }
}

// Express Web Arayüzü ve API
app.get('/api/status', (req, res) => {
    res.json({
        stats: botStats,
        config: CONFIG,
        logs: lastLogs
    });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AesirMC Bot Dashboard</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #e2e8f0; padding: 16px; min-height: 100vh; }
        .header { text-align: center; margin-bottom: 20px; }
        .header h1 { color: #38bdf8; font-size: 24px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; max-width: 1000px; margin: 0 auto; }
        .card { background: #151d30; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
        .card-title { font-size: 16px; font-weight: 600; color: #38bdf8; margin-bottom: 14px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; display: flex; justify-content: space-between; }
        .stat-item { display: flex; justify-content: space-between; background: #0f172a; padding: 10px; border-radius: 8px; margin-bottom: 8px; font-size: 14px; }
        label { display: block; font-size: 12px; color: #94a3b8; margin: 10px 0 4px; }
        input, select { width: 100%; background: #0f172a; border: 1px solid #334155; color: #f8fafc; padding: 10px; border-radius: 6px; font-size: 14px; outline: none; }
        .btn { width: 100%; background: #0284c7; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: 600; cursor: pointer; margin-top: 10px; }
        .btn-green { background: #16a34a; }
        .btn-red { background: #dc2626; }
        .logs-box { background: #050811; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; height: 200px; overflow-y: auto; font-family: monospace; font-size: 12px; color: #4ade80; }
        .full { grid-column: 1 / -1; }
    </style>
</head>
<body>
    <div class="header">
        <h1>AesirMC AFK Bot Paneli</h1>
    </div>

    <div class="grid">
        <div class="card">
            <div class="card-title">📊 Bot Durumu <span id="reconnectBadge">0 Kopma</span></div>
            <div class="stat-item"><span>Durum:</span><span id="botStatus" style="color:#38bdf8;">Yükleniyor...</span></div>
            <div class="stat-item"><span>Aktif Sunucu:</span><span id="currentServer">-</span></div>
            <div class="stat-item"><span>Can / Açlık:</span><span id="botHealth">❤️ 20 | 🍖 20</span></div>

            <form action="/reconnect" method="POST">
                <button type="submit" class="btn btn-red">🔄 Yeniden Bağlat</button>
            </form>
        </div>

        <div class="card">
            <div class="card-title">🚀 Hızlı İşlemler</div>
            <form action="/switch-server" method="POST">
                <label>Alt Sunucuya Geç (/gir)</label>
                <input type="text" name="serverName" placeholder="asmp, towny, survival..." required>
                <button type="submit" class="btn btn-green">Sunucu Değiştir</button>
            </form>

            <form action="/send-command" method="POST">
                <label>Komut / Chat Gönder</label>
                <input type="text" name="command" placeholder="/spawn veya Selam" required>
                <button type="submit" class="btn">Gönder</button>
            </form>
        </div>

        <div class="card full">
            <div class="card-title">⚙️ Bot Ayarları</div>
            <form action="/update-config" method="POST" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                <div>
                    <label>Kullanıcı Adı</label>
                    <input type="text" name="username" value="${CONFIG.username}" required>
                </div>
                <div>
                    <label>Şifre (/login)</label>
                    <input type="password" name="password" value="${CONFIG.password}" placeholder="Şifreniz">
                </div>
                <div>
                    <label>Hedef Alt Sunucu</label>
                    <input type="text" name="targetServer" value="${CONFIG.targetServer}" placeholder="asmp">
                </div>
                <div>
                    <label>Minecraft Sürümü</label>
                    <select name="mcVersion">
                        <option value="1.20.4" ${CONFIG.mcVersion === '1.20.4' ? 'selected' : ''}>1.20.4</option>
                        <option value="1.21.1" ${CONFIG.mcVersion === '1.21.1' ? 'selected' : ''}>1.21.1</option>
                        <option value="1.20.1" ${CONFIG.mcVersion === '1.20.1' ? 'selected' : ''}>1.20.1</option>
                        <option value="1.16.5" ${CONFIG.mcVersion === '1.16.5' ? 'selected' : ''}>1.16.5</option>
                    </select>
                </div>

                <div style="grid-column: 1 / -1; border-top: 1px solid #1e293b; margin-top: 5px; padding-top: 5px;">
                    <label style="color: #38bdf8; font-weight: bold;">SOCKS5 Proxy Ayarları (Opsiyonel - IP Engeli İçin)</label>
                </div>
                <div>
                    <label>Proxy IP / Host</label>
                    <input type="text" name="proxyHost" value="${CONFIG.proxyHost}" placeholder="örn: 185.12.34.56">
                </div>
                <div>
                    <label>Proxy Port</label>
                    <input type="text" name="proxyPort" value="${CONFIG.proxyPort}" placeholder="örn: 1080">
                </div>
                <div>
                    <label>Proxy Kullanıcı Adı</label>
                    <input type="text" name="proxyUser" value="${CONFIG.proxyUser}">
                </div>
                <div>
                    <label>Proxy Şifre</label>
                    <input type="password" name="proxyPass" value="${CONFIG.proxyPass}">
                </div>

                <div style="grid-column: 1 / -1;">
                    <button type="submit" class="btn">Kaydet ve Başlat</button>
                </div>
            </form>
        </div>

        <div class="card full">
            <div class="card-title">📜 Canlı Loglar</div>
            <div class="logs-box" id="logsBox"><div>Yükleniyor...</div></div>
        </div>
    </div>

    <script>
        async function updateStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                document.getElementById('botStatus').innerText = data.stats.status;
                document.getElementById('currentServer').innerText = data.stats.currentServer;
                document.getElementById('botHealth').innerText = '❤️ ' + data.stats.health + ' | 🍖 ' + data.stats.food;
                document.getElementById('reconnectBadge').innerText = data.stats.reconnects + ' Kopma';

                const logsBox = document.getElementById('logsBox');
                logsBox.innerHTML = data.logs.map(l => '<div>' + l + '</div>').join('');
            } catch (e) {}
        }
        setInterval(updateStatus, 3000);
        updateStatus();
    </script>
</body>
</html>
    `);
});

app.post('/update-config', (req, res) => {
    CONFIG.username = req.body.username;
    CONFIG.password = req.body.password;
    CONFIG.targetServer = req.body.targetServer;
    CONFIG.mcVersion = req.body.mcVersion;
    CONFIG.proxyHost = req.body.proxyHost;
    CONFIG.proxyPort = req.body.proxyPort;
    CONFIG.proxyUser = req.body.proxyUser;
    CONFIG.proxyPass = req.body.proxyPass;
    log('Ayarlar panelden güncellendi ve yeniden başlatılıyor.');
    createBot();
    res.redirect('/');
});

app.post('/switch-server', (req, res) => {
    switchServer(req.body.serverName);
    res.redirect('/');
});

app.post('/send-command', (req, res) => {
    if (bot && req.body.command) {
        bot.chat(req.body.command);
        log(`[PANEL KOMUTU] ${req.body.command}`);
    }
    res.redirect('/');
});

app.post('/reconnect', (req, res) => {
    log('Panelden manuel yeniden başlatma tetiklendi.');
    createBot();
    res.redirect('/');
});

server.listen(PORT, '0.0.0.0', () => {
    log(`Web sunucusu ${PORT} portunda aktif.`);
    createBot();
});
