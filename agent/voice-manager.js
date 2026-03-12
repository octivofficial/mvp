/**
 * Voice Manager — Discord voice channel connection + TTS queue
 *
 * Manages joining/leaving voice channels and queues TTS messages
 * for sequential playback via @discordjs/voice AudioPlayer.
 */

const { synthesize, voiceForRole } = require('./tts-engine');
const { getLogger } = require('./logger');
const T = require('../config/timeouts');

const log = getLogger();

/** Priority levels for TTS messages */
const Priority = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
};

class VoiceManager {
  /**
   * @param {import('discord.js').Client} client - Discord.js client
   * @param {string} channelId - Voice channel ID to join
   * @param {string} guildId - Guild ID
   * @param {object} [options]
   * @param {number} [options.maxQueue] - Max queued messages
   * @param {object} [options._deps] - Dependency injection for testing
   */
  constructor(client, channelId, guildId, options = {}) {
    this._client = client;
    this._channelId = channelId;
    this._guildId = guildId;
    this._maxQueue = options.maxQueue || T.TTS_QUEUE_MAX;

    // Dependency injection for testing
    this._deps = options._deps || {};

    this._connection = null;
    this._player = this._createPlayer();
    this._queue = [];
    this._playing = false;
    this._muted = false;
    this._destroyed = false;

    // When player finishes, process next item
    this._player.on('idle', () => {
      this._playing = false;
      setTimeout(() => this._processQueue(), T.TTS_SILENCE_BETWEEN_MS);
    });

    this._player.on('error', (err) => {
      log.error('voice', 'audio player error', { error: err.message });
      this._playing = false;
      this._processQueue();
    });
  }

  _createPlayer() {
    if (this._deps.createAudioPlayer) return this._deps.createAudioPlayer();
    const { createAudioPlayer } = require('@discordjs/voice');
    return createAudioPlayer();
  }

  /**
   * Join the configured voice channel.
   * @returns {object|null} VoiceConnection
   */
  join() {
    if (this._connection) return this._connection;
    if (!this._channelId || !this._guildId) {
      log.warn('voice', 'cannot join: missing channelId or guildId');
      return null;
    }

    try {
      const guild = this._client.guilds.cache.get(this._guildId);
      if (!guild) {
        log.error('voice', 'guild not found', { guildId: this._guildId });
        return null;
      }

      if (this._deps.joinVoiceChannel) {
        this._connection = this._deps.joinVoiceChannel({
          channelId: this._channelId,
          guildId: this._guildId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
        });
      } else {
        const { joinVoiceChannel } = require('@discordjs/voice');
        this._connection = joinVoiceChannel({
          channelId: this._channelId,
          guildId: this._guildId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
        });
      }

      this._connection.subscribe(this._player);

      this._connection.on('stateChange', (_old, newState) => {
        if (newState.status === 'destroyed') {
          this._connection = null;
          log.info('voice', 'voice connection destroyed');
        }
      });

      log.info('voice', 'joined voice channel', { channelId: this._channelId });
      return this._connection;
    } catch (err) {
      log.error('voice', 'failed to join voice channel', { error: err.message });
      return null;
    }
  }

  /** Leave the voice channel. */
  leave() {
    this._queue = [];
    this._playing = false;
    this._destroyed = true;
    if (this._connection) {
      this._connection.destroy();
      this._connection = null;
    }
    this._player.stop(true);
    log.info('voice', 'left voice channel');
  }

  /**
   * Queue a TTS message for playback.
   * @param {string} text - Text to speak
   * @param {object} [options]
   * @param {string} [options.voice] - Edge TTS voice name
   * @param {string} [options.role] - Agent role for auto voice selection
   * @param {number} [options.priority] - Priority level (0=low, 1=normal, 2=high)
   * @returns {boolean} Whether the message was queued
   */
  speak(text, options = {}) {
    if (this._muted || this._destroyed) return false;
    if (!text || typeof text !== 'string' || text.trim().length === 0) return false;

    const voice = options.voice || (options.role ? voiceForRole(options.role) : undefined);
    const priority = options.priority ?? Priority.NORMAL;

    // Enforce max queue size
    if (this._queue.length >= this._maxQueue) {
      if (priority === Priority.HIGH) {
        const lowestIdx = this._queue.reduce((minIdx, item, idx, arr) =>
          item.priority < arr[minIdx].priority ? idx : minIdx, 0);
        if (this._queue[lowestIdx].priority < priority) {
          this._queue.splice(lowestIdx, 1);
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

    const item = { text, voice, priority };

    if (priority === Priority.HIGH) {
      const insertIdx = this._queue.findIndex(q => q.priority < Priority.HIGH);
      if (insertIdx === -1) {
        this._queue.push(item);
      } else {
        this._queue.splice(insertIdx, 0, item);
      }
    } else {
      this._queue.push(item);
    }

    // Auto-join if not connected
    if (!this._connection) {
      this.join();
    }

    this._processQueue();
    return true;
  }

  /** Whether the bot is connected to voice. */
  isConnected() {
    return this._connection !== null && !this._destroyed;
  }

  /** Toggle mute state for auto-TTS events. */
  toggleMute() {
    this._muted = !this._muted;
    return this._muted;
  }

  /** Get current mute state. */
  isMuted() {
    return this._muted;
  }

  /** Get current queue length. */
  queueLength() {
    return this._queue.length;
  }

  /** Process the TTS queue — dequeue, synthesize, play. */
  async _processQueue() {
    if (this._playing || this._queue.length === 0 || this._destroyed) return;
    if (!this._connection) return;

    this._playing = true;
    const item = this._queue.shift();

    try {
      const synthFn = this._deps.synthesize || synthesize;
      const stream = await synthFn(item.text, item.voice);
      if (!stream) {
        this._playing = false;
        this._processQueue();
        return;
      }

      let resource;
      if (this._deps.createAudioResource) {
        resource = this._deps.createAudioResource(stream);
      } else {
        const { createAudioResource, StreamType } = require('@discordjs/voice');
        resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
      }
      this._player.play(resource);
    } catch (err) {
      // Downgrade to debug if voice is disabled (e.g. cloud VM without FFmpeg)
      if (process.env.DISCORD_VOICE_ENABLED === 'false') {
        log.debug('voice', 'TTS skipped (DISCORD_VOICE_ENABLED=false)', { error: err.message });
      } else {
        log.error('voice', 'failed to play TTS', { error: err.message });
      }
      this._playing = false;
      this._processQueue();
    }
  }
}

module.exports = { VoiceManager, Priority };
