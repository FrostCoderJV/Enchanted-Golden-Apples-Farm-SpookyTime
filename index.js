    const path = require('path')
    const mineflayer = require('mineflayer')
    const { SocksClient } = require('socks')
    const bypass = require('./plugins/bypass')
    const login = require('./plugins/login')
    const { loadProxies, resolveMcEndpoint } = require('./proxy-list')
    const { banProxy, pickUnbannedProxy, proxyBanKey } = require('./proxy-bans')

    const BAN_SNIPPET = 'ВЫ ЗАБАНЕНЫ!'

    function textSignalsProxyBan(s) {
        if (s == null) return false
        return String(s).includes(BAN_SNIPPET)
    }

    function messageToSearchStrings(msg) {
        const out = []
        if (msg == null) return out
        try {
            if (typeof msg === 'string') {
                out.push(msg)
                return out
            }
            if (typeof msg.toString === 'function') out.push(msg.toString())
            if (typeof msg.toAnsi === 'function') out.push(msg.toAnsi())
            if (msg.json != null) out.push(JSON.stringify(msg.json))
        } catch (_) {
            out.push(String(msg))
        }
        return out
    }

    function packetNameMayCarryText(name) {
        if (!name) return false
        const n = String(name).toLowerCase()
        return (
            n.includes('chat') ||
            n.includes('title') ||
            n.includes('action_bar') ||
            n.includes('boss_bar') ||
            n.includes('tab_list') ||
            n.includes('scoreboard') ||
            n.includes('disconnect') ||
            n.includes('kick')
        )
    }

    const MC_HOST = 'mc.SpookyTime.su'
    const MC_PORT = 25565

    /** true — через SOCKS из proxy.txt; false — прямое подключение без прокси */
    const USE_PROXY = false

    const PROXY_FILE = path.join(__dirname, 'proxy.txt')
    let proxies = []
    if (USE_PROXY) {
        try {
            proxies = loadProxies(PROXY_FILE)
        } catch (e) {
            console.error(`Не удалось прочитать ${PROXY_FILE}:`, e.message)
            process.exit(1)
        }
        if (!proxies.length) {
            console.error(`В ${PROXY_FILE} нет ни одной строки с прокси (формат host:port или host:port:user:pass).`)
            process.exit(1)
        }
    }

    class GApple {
        constructor(username, version, anarchy) {
            this.username = username;
            this.version = version;
            this.anarchy = anarchy;
            this._dest = null
            this._currentProxy = null
            this._reconnecting = false
            this._playtimeInterval = null
            this.initBot();
        }

        async initBot() {
            if (!this._dest) {
                this._dest = await resolveMcEndpoint(MC_HOST, MC_PORT)
            }
            const dest = this._dest

            if (!USE_PROXY) {
                this._currentProxy = null
                console.log(`Подключение: ник ${this.username}, анархия ${this.anarchy}, без прокси`)
                this.bot = mineflayer.createBot({
                    host: dest.host,
                    port: dest.port,
                    username: this.username,
                    version: this.version,
                    plugins: [bypass, login]
                })
            } else {
                let proxy = pickUnbannedProxy(proxies)
                while (!proxy) {
                    console.warn(`[${this.username}] Все прокси в бане, ждём 60 с…`)
                    await new Promise((r) => setTimeout(r, 60_000))
                    proxy = pickUnbannedProxy(proxies)
                }

                this._currentProxy = proxy
                console.log(`Подключение: ник ${this.username}, анархия ${this.anarchy}, прокси ${proxy.host}:${proxy.port}`)

                const proxyOpts = {
                    host: proxy.host,
                    port: proxy.port,
                    type: proxy.type
                }
                if (proxy.userId != null && proxy.userId !== '') {
                    proxyOpts.userId = proxy.userId
                    proxyOpts.password = proxy.password ?? ''
                }

                this.bot = mineflayer.createBot({
                    host: dest.host,
                    port: dest.port,
                    username: this.username,
                    version: this.version,
                    plugins: [bypass, login],
                    connect: (client) => {
                        SocksClient.createConnection({
                            proxy: proxyOpts,
                            command: 'connect',
                            destination: { host: dest.host, port: dest.port }
                        })
                            .then((info) => {
                                client.setSocket(info.socket)
                                client.emit('connect')
                            })
                            .catch((err) => {
                                client.emit('error', err)
                            })
                    }
                })
                this.attachProxyBanWatchers()
            }
            this.initEvents()
        }

        attachProxyBanWatchers() {
            const bot = this.bot
            const consider = (fragments) => {
                for (const f of fragments) {
                    if (textSignalsProxyBan(f)) {
                        void this.reconnectDueToProxyBan()
                        return
                    }
                }
            }

            bot.on('message', (msg) => consider(messageToSearchStrings(msg)))

            bot.on('whisper', (_u, msg) => consider(messageToSearchStrings(msg)))

            bot.on('kicked', (reason) => consider(messageToSearchStrings(reason)))

            const onPacket = (data, meta) => {
                if (!meta?.name || !packetNameMayCarryText(meta.name)) return
                try {
                    const s = JSON.stringify(data)
                    if (textSignalsProxyBan(s)) void this.reconnectDueToProxyBan()
                } catch (_) {}
            }
            bot._client.on('packet', onPacket)
            bot.once('end', () => {
                try {
                    bot._client.removeListener('packet', onPacket)
                } catch (_) {}
            })
        }

        async reconnectDueToProxyBan() {
            if (this._reconnecting) return
            this._reconnecting = true
            try {
                if (this._playtimeInterval) {
                    clearInterval(this._playtimeInterval)
                    this._playtimeInterval = null
                }

                const proxy = this._currentProxy
                if (proxy) banProxy(proxy)
                const key = proxyBanKey(proxy)
                console.warn(`[${this.username}] ${BAN_SNIPPET} — прокси ${key} в бане 24 ч, другой прокси`)

                try {
                    this.bot.quit('proxy_ban')
                } catch (_) {}

                await this.sleep(2000)
                await this.initBot()
            } catch (e) {
                console.error(`[${this.username}] Ошибка реконнекта после бана прокси:`, e?.message || e)
                await this.sleep(5000)
                await this.initBot()
            } finally {
                this._reconnecting = false
            }
        }

        initEvents() {
            this.bot.on('message', (msg) => {
                const text = msg.toAnsi()
                //console.log(text)
        
                if (text.includes('Добро пожаловать на ')) {
                    this.bot.chat(`/an${this.anarchy}`)
                    setTimeout(() => {
                        this.bot.chat(`/rtp small`);
                        for (const item of this.bot.inventory.items()) {
                            if (item.name != 'air') {
                                this.bot.tossStack(item);
                            }
                        }
                    }, 5000)
                } else if (text.includes('хочет телепортироваться')) {
                    this.bot.chat(`/tpaccept`)
                }
            })
        
            this.bot.on('windowOpen', async (window) => {
                console.log(`[${this.username}] Открылось окно: ${window.title}`)
                const title = window.title?.toString() ?? ''
        
                if (title.includes('rtp') || title.includes('РТП') || title.includes('Телепорт')) {
                    await this.sleep(500)
                    await this.bot.clickWindow(4, 0, 0) // кликаем центральный слот, подберите нужный
                    await this.sleep(500)
                    this.bot.closeWindow(window)
                }
            })
        
            this.bot.on('spawn', async () => {
                if (this._playtimeInterval) {
                    clearInterval(this._playtimeInterval)
                    this._playtimeInterval = null
                }

                await this.sleep(1000)
                this.bot.chat(`/rtp small`)
        
                this._playtimeInterval = setInterval(() => {
                    const timeAmount = this.getTimeAmount(this.bot)
                    if (timeAmount !== null) {
                        console.log(`[${this.username} | ${this.anarchy}] Наиграно: ${timeAmount} часов`)
                        if (timeAmount >= 6) {
                            this.runFreeSequence()
                        }
                    }
                }, 60_000)
            })
        }
        
        async runFreeSequence() {
            this.bot.chat(`/free`)
            await this.sleep(1000)
            for (const slot of [20, 21, 23, 24, 40, 4]) {
                await this.bot.clickWindow(slot, 0, 0)
                await this.sleep(1000)
            }
            await this.sleep(1000)
            this.bot.chat(`/tshop armour`)
            await this.sleep(2000)
            await this.bot.clickWindow(4, 0, 0)
            await this.sleep(2000)
            await this.bot.clickWindow(21, 0, 0)
            await this.sleep(2000)
            await this.bot.clickWindow(2, 0, 0)

            await this.sleep(2000)
            this.bot.chat(`/an210`)
            await this.sleep(2000)
            this.bot.chat(`/warp map4yk`)
            await this.sleep(15000)
            await this.bot.quit()
        }

        getTimeAmount(bot) {  // убрать async
            const sb = bot.scoreboard?.sidebar
            if (!sb) return null
            const rawItems = sb.items
            if (!Array.isArray(rawItems) || rawItems.length === 0) return null
        
            const reHours = /Наиграно\s*[:\uFF1a]\s*(\d+)\s*ч/iu
        
            for (const item of rawItems) {
                const line = this.scoreboardRowPlain(bot, item)
                const withScore = `${line} ${Number(item.value) || 0}`.trim()
        
                let m = line.match(reHours) || withScore.match(reHours)
                if (m) {
                    const n = parseInt(m[1], 10)
                    if (Number.isFinite(n) && n >= 0) return n
                }
        
                if (/наиграно/i.test(line)) {
                    const sc = item.value
                    if (Number.isFinite(sc) && sc >= 0) return Math.floor(sc)
                }
            }
            return null
        }

        scoreboardRowPlain(bot, item) {
            const stripAnsi = (str) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, '')
            
            let text = ''
            try {
                if (item.displayName && typeof item.displayName.toString === 'function') {
                    text = item.displayName.toString()
                }
            } catch (_) {}
            if (!text && item && item.name) {
                try {
                    const ChatMessage = require('prismarine-chat')(bot.registry)
                    text = ChatMessage.fromNotch(JSON.parse(item.name)).toString()
                } catch {
                    text = String(item.name)
                }
            }
            return stripAnsi(text).replace(/\u00a0/g, ' ')
        }

        async sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    }

    const VERSION = ['1.18.2', '1.20.2']

    const ANARCHY = [
        103, 104, 105, 106, 107, 108, 109, 110,
        203, 205, 206, 207, 208, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220,
        301, 302, 303, 304, 306, 307, 308,
        501, 502, 503, 504, 505, 506,
        601, 602, 603, 604, 606,
    ]

    const bots = []

    console.log('Starting bots...');
    ;(async () => {
        for (let i = 0; i < 2000; i++) {
            bots.push(new GApple(`LuckyManGG${i}`, VERSION[Math.floor(Math.random() * VERSION.length)], ANARCHY[Math.floor(Math.random() * ANARCHY.length)]))
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    })()