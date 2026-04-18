/** In-memory: прокси в бане 24 ч, после истечения снова доступен в пуле. */

const BAN_MS = 24 * 60 * 60 * 1000

/** host:port — идентичность прокси из списка */
const bans = new Map()

function proxyBanKey(proxy) {
    if (!proxy) return null
    return `${proxy.host}:${proxy.port}`
}

function pruneExpired() {
    const now = Date.now()
    for (const [k, until] of bans) {
        if (now >= until) bans.delete(k)
    }
}

function isProxyBanned(proxy) {
    pruneExpired()
    const key = proxyBanKey(proxy)
    if (!key) return false
    return bans.has(key)
}

function banProxy(proxy) {
    const key = proxyBanKey(proxy)
    if (!key) return
    bans.set(key, Date.now() + BAN_MS)
}

/** Случайный прокси не из бана, или null если все в бане */
function pickUnbannedProxy(proxies) {
    pruneExpired()
    const ok = proxies.filter((p) => {
        const key = proxyBanKey(p)
        return key && !bans.has(key)
    })
    if (!ok.length) return null
    return ok[Math.floor(Math.random() * ok.length)]
}

module.exports = {
    BAN_MS,
    proxyBanKey,
    isProxyBanned,
    banProxy,
    pickUnbannedProxy,
}
