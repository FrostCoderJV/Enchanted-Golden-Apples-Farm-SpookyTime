const PASSWORD = 'CMEPTBAN'
const deferChat = require('./chat-defer')

module.exports = function login(bot) {
    bot.on('message', (message) => {
        const text = message.toAnsi()
        if (text.includes('/reg')) deferChat(bot, `/reg ${PASSWORD}`)
        else if (text.includes('/login')) deferChat(bot, `/login ${PASSWORD}`)
    })
}