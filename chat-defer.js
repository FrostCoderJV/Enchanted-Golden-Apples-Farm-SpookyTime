/**
 * bot._client.chat задаётся в minecraft-protocol только после playerJoin (PLAY).
 * До этого bot.chat() падает с "chat is not a function".
 */
const attached = new WeakMap()

function ensureAttached(bot) {
    if (attached.has(bot)) return
    const q = []
    function flush() {
        if (typeof bot._client?.chat !== 'function') return
        while (q.length) {
            try {
                bot.chat(q.shift())
            } catch (e) {
                console.warn('[chat-defer]', e.message)
            }
        }
    }
    bot._client.on('playerJoin', flush)
    bot.on('spawn', flush)
    attached.set(bot, q)
}

function deferChat(bot, text) {
    if (typeof text !== 'string' || !text.trim()) return
    ensureAttached(bot)
    const q = attached.get(bot)
    const t = text.trim()
    if (typeof bot._client?.chat === 'function') {
        try {
            bot.chat(t)
        } catch (e) {
            console.warn('[chat-defer]', e.message)
        }
    } else {
        q.push(t)
        if (q.length > 100) q.shift()
    }
}

module.exports = deferChat
