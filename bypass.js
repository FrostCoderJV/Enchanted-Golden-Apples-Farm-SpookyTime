const RAD_TO_DEG = 180 / Math.PI
const MOVEMENT_PACKETS = new Set(['position', 'position_look', 'look', 'flying', 'teleport_confirm'])
const BRANDS = ['vanilla', 'forge', 'fabric']
const LOCALES = ['ru_ru', 'en_us']

const DEFAULTS = {
  // Клиентские настройки
  viewDistance: 2,
  enableTextFiltering: false,
  enableServerListing: true,

  // Функции bypass
  spoofEnabled: true,
  swingEnabled: true,
  mountEnabled: true,
  replaySettingsEnabled: true,

  // Spoof параметры
  spoofGroundY: 65,
  spoofOffsetX: 1,
  spoofOffsetZ: 1,
  gravityOffsets: [0.0784000015258789, 0.23363200604248047, 0.4641593749554364, 0.76847620241298],

  // Mount
  mountTickMs: 50,
}

module.exports = function bypass(bot, options = {}) {
  const config = {
    ...DEFAULTS,
    ...options,
    locale: options.locale ?? LOCALES[Math.floor(Math.random() * LOCALES.length)],
    brand: options.brand ?? BRANDS[Math.floor(Math.random() * BRANDS.length)],
  }

  const client = bot._client
  const writeRaw = client.write.bind(client)

  // Состояние плагина
  const state = {
    // Settings/brand
    settingsSent: false,
    pendingBrand: null,

    // Teleport spoof
    firstTeleport: null,
    pendingConfirm: null,
    suppressMovement: false,
    spoofDone: !config.spoofEnabled,
    spoofScheduled: false,

    // Прочее
    swingDone: !config.swingEnabled,
    settingsReplayed: false,
    loginCount: 0,
    mountInterval: null,
    animationCount: 0,
  }

  // Хелперы
  const isAlive = () => !client.ended
  const toYaw = (radians) => Math.fround(180 - radians * RAD_TO_DEG)
  const toPitch = (radians) => Math.fround(-radians * RAD_TO_DEG)

  function getBrandChannel() {
    if (bot.supportFeature('customChannelMCPrefixed')) return 'MC|Brand'
    if (bot.supportFeature('customChannelIdentifier')) return 'minecraft:brand'
    return null
  }

  // ── Mount ────────────────────────────────────────────────────────────────

  function stopMount() {
    if (state.mountInterval) {
      clearInterval(state.mountInterval)
      state.mountInterval = null
    }
  }

  function startMount() {
    if (!config.mountEnabled || state.mountInterval) return

    state.mountInterval = setInterval(() => {
      if (!isAlive() || !bot.vehicle) return stopMount()

      const entity = bot.entity
      writeRaw('look', {
        yaw: Number.isFinite(entity?.yaw) ? toYaw(entity.yaw) : 0,
        pitch: Number.isFinite(entity?.pitch) ? toPitch(entity.pitch) : 0,
        onGround: !!entity?.onGround,
      })
      writeRaw('steer_vehicle', { sideways: 0, forward: 0, jump: 0 })
    }, config.mountTickMs)
  }

  // ── Settings replay ───────────────────────────────────────────────────────

  function replaySettings() {
    if (!config.replaySettingsEnabled || state.settingsReplayed || !isAlive() || state.loginCount > 1) return
    state.settingsReplayed = true

    setTimeout(() => {
      if (!isAlive()) return
      bot.setSettings({
        locale: config.locale,
        viewDistance: config.viewDistance,
        enableTextFiltering: config.enableTextFiltering,
      })
      const channel = getBrandChannel()
      if (channel) client.writeChannel(channel, config.brand)
    }, 10)
  }

  // ── Early swing ───────────────────────────────────────────────────────────

  function earlySwing() {
    if (state.swingDone || !isAlive()) return
    state.swingDone = true
    setTimeout(() => isAlive() && writeRaw('arm_animation', { hand: 0 }), 40)
    setTimeout(() => isAlive() && writeRaw('arm_animation', { hand: 1 }), 80)
  }

  // ── Teleport spoof ────────────────────────────────────────────────────────

  function runSpoof() {
    const { firstTeleport: tp, pendingConfirm: confirm } = state
    if (!tp || !confirm || !isAlive()) {
      state.suppressMovement = false
      return
    }

    const x = tp.x + config.spoofOffsetX
    const y = config.spoofGroundY
    const z = tp.z + config.spoofOffsetZ

    // Симулируем падение на землю
    writeRaw('position_look', { x, y, z, yaw: -180, pitch: 0, onGround: false })
    for (const offset of config.gravityOffsets) {
      writeRaw('position', { x, y: y - offset, z, onGround: false })
    }

    // Подтверждаем телепорт и возвращаемся на реальную позицию
    writeRaw('teleport_confirm', confirm)
    writeRaw('position_look', { x: tp.x, y: tp.y, z: tp.z, yaw: tp.yaw, pitch: tp.pitch, onGround: false })
    writeRaw('position_look', { x: tp.x, y: tp.y, z: tp.z, yaw: tp.yaw, pitch: tp.pitch, onGround: false })

    state.pendingConfirm = null
    state.suppressMovement = false
    state.spoofScheduled = false
    state.spoofDone = true
  }

  function scheduleSpoof() {
    if (state.spoofScheduled || state.spoofDone || !state.firstTeleport || !state.pendingConfirm) return
    state.spoofScheduled = true
    setTimeout(runSpoof, 5)
  }

  // ── Перехват исходящих пакетов ────────────────────────────────────────────

  client.write = (name, params) => {
    // Патчим настройки клиента
    if (name === 'settings' && params) {
      params.locale = config.locale
      params.viewDistance = config.viewDistance
      params.enableTextFiltering = config.enableTextFiltering
      params.enableServerListing = config.enableServerListing
    }

    // Задерживаем brand до отправки settings
    if (name === 'custom_payload' && params?.channel === 'minecraft:brand' && !state.settingsSent) {
      state.pendingBrand = params
      return
    }

    // Блокируем смену слота до завершения spoof
    if (!state.spoofDone && name === 'held_item_slot' && params?.slotId === 0) return

    // Отправляем settings + brand вместе
    if (name === 'settings' && !state.settingsSent) {
      state.settingsSent = true
      writeRaw(name, params)
      if (state.pendingBrand) {
        writeRaw('custom_payload', state.pendingBrand)
        state.pendingBrand = null
      }
      return
    }

    // Во время spoof — перехватываем движение и teleport_confirm
    if (state.suppressMovement && !state.spoofDone) {
      if (name === 'teleport_confirm' && params?.teleportId === state.firstTeleport?.teleportId) {
        state.pendingConfirm = params
        scheduleSpoof()
        return
      }
      if (MOVEMENT_PACKETS.has(name)) return
    }

    writeRaw(name, params)
  }

  // ── Входящие пакеты ───────────────────────────────────────────────────────

  client.on('packet', (data, { name }) => {
    // Запоминаем первый телепорт и начинаем подавлять движение
    if (name === 'position' && !state.firstTeleport && data?.teleportId != null) {
      state.firstTeleport = {
        x: data.x, y: data.y, z: data.z,
        yaw: data.yaw, pitch: data.pitch,
        teleportId: data.teleportId,
      }
      state.suppressMovement = true
    }

    if (name === 'animation' && ++state.animationCount === 2) earlySwing()
    if (name === 'respawn' || name === 'window_items') stopMount()
    if ((name === 'advancements' || name === 'window_items') && !state.settingsReplayed) replaySettings()
  })

  // ── События бота ──────────────────────────────────────────────────────────

  bot.on('login', () => {
    state.loginCount++
    if (state.loginCount > 1) stopMount()
  })
  bot.on('mount', startMount)
  bot.on('dismount', stopMount)
  bot.on('end', stopMount)
}