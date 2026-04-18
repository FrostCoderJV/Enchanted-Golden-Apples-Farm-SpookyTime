const fs = require('fs')
const net = require('net')
const dns = require('dns').promises

/**
 * Строки proxy.txt:
 *   host:port                    — SOCKS5
 *   host:port:user:pass          — SOCKS5 с логином
 *   user:password@host:port      — то же (частый формат списков)
 *   user:pass:word@host:port     — пароль до последнего '@', хост после него
 *   [ipv6]:port
 *   socks4:… / socks5:…
 * Пустые строки и строки, начинающиеся с #, пропускаются.
 */
function parseProxyLine(line) {
    line = line.trim()
    if (!line || line.startsWith('#')) return null

    let type = 5
    if (line.startsWith('socks4:')) {
        type = 4
        line = line.slice('socks4:'.length).trim()
    } else if (line.startsWith('socks5:')) {
        line = line.slice('socks5:'.length).trim()
    }

    const at = line.lastIndexOf('@')
    if (at > 0) {
        const authPart = line.slice(0, at)
        const hostPart = line.slice(at + 1)
        let host
        let port
        const br = hostPart.match(/^\[([^\]]+)\]:(\d{1,5})$/)
        if (br) {
            host = br[1]
            port = Number(br[2])
        } else {
            const sm = hostPart.match(/^(.+):(\d{1,5})$/)
            if (!sm) return null
            host = sm[1]
            port = Number(sm[2])
        }
        if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null

        const c = authPart.indexOf(':')
        const userId = c >= 0 ? authPart.slice(0, c) : authPart
        const password = c >= 0 ? authPart.slice(c + 1) : ''
        if (!userId) return null

        return { host, port, type, userId, password }
    }

    const mBr = line.match(/^\[([^\]]+)\]:(\d{1,5})$/)
    if (mBr) {
        const port = Number(mBr[2])
        if (port > 0 && port <= 65535) return { host: mBr[1], port, type }
    }

    const mAuth = line.match(/^(.+?):(\d{1,5}):([^:]+):(.+)$/)
    if (mAuth) {
        const port = Number(mAuth[2])
        if (port > 0 && port <= 65535) {
            return { host: mAuth[1], port, type, userId: mAuth[3], password: mAuth[4] }
        }
    }

    const mSimple = line.match(/^(.+):(\d{1,5})$/)
    if (mSimple) {
        const port = Number(mSimple[2])
        if (port > 0 && port <= 65535) return { host: mSimple[1], port, type }
    }

    return null
}

function loadProxies(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8')
    return raw.split(/\r?\n/).map(parseProxyLine).filter(Boolean)
}

/** Как в minecraft-protocol tcp_dns: SRV для домена и порта по умолчанию. */
async function resolveMcEndpoint(host, port = 25565) {
    if (port !== 25565 || net.isIP(host) !== 0 || host === 'localhost') {
        return { host, port }
    }
    try {
        const addresses = await dns.resolveSrv('_minecraft._tcp.' + host)
        if (addresses?.length) {
            return { host: addresses[0].name, port: addresses[0].port }
        }
    } catch (_) {
        /* прямое подключение */
    }
    return { host, port }
}

module.exports = { parseProxyLine, loadProxies, resolveMcEndpoint }
