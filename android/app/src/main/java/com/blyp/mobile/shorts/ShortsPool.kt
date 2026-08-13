package com.blyp.mobile.shorts

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Ground-up For You pool (DESIGN §2). Not the storm FeedPlayer.
 * 3 slots: prev | active | next. Never touches Android audio mode / focus for LIVE safety —
 * JS claimFeedAudio + livePublishAudioGuard owns audible mode.
 */
object ShortsPool {
  private const val TAG = "BlypShorts"
  const val POOL_SIZE = 3
  private const val CACHE_BYTES = 256L * 1024L * 1024L
  /** ~512KB opening warm — enough for first GOP without saturating IO. */
  private const val OPENING_DEFAULT_BYTES = 512L * 1024L

  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newFixedThreadPool(3)

  @Volatile private var appContext: Context? = null
  @Volatile private var simpleCache: SimpleCache? = null
  @Volatile private var cacheFactory: CacheDataSource.Factory? = null

  private data class Slot(
    var player: ExoPlayer? = null,
    var uri: String? = null,
    var view: ShortsSurfaceView? = null,
    var muted: Boolean = true,
    var playing: Boolean = false,
    var role: String = "neighbor",
    var ready: Boolean = false,
    /** Neighbor decoded one frame at t≈0 — promote can unmute+play with no wait. */
    var firstFramePrimed: Boolean = false,
  )

  private val slots = Array(POOL_SIZE) { Slot() }
  private val openingJobs = ConcurrentHashMap<String, Boolean>()

  fun init(context: Context) {
    if (appContext != null) return
    val app = context.applicationContext
    appContext = app
    val dir = File(app.cacheDir, "blyp_shorts_cache")
    if (!dir.exists()) dir.mkdirs()
    val db = StandaloneDatabaseProvider(app)
    val cache = SimpleCache(dir, LeastRecentlyUsedCacheEvictor(CACHE_BYTES), db)
    simpleCache = cache
    val http = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(8_000)
      .setReadTimeoutMs(12_000)
      .setUserAgent("BlypShorts/1.0")
    val upstream = DefaultDataSource.Factory(app, http)
    cacheFactory = CacheDataSource.Factory()
      .setCache(cache)
      .setUpstreamDataSourceFactory(upstream)
      .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    Log.i(TAG, "init pool=$POOL_SIZE")
  }

  private fun ensurePlayer(slotIndex: Int): ExoPlayer {
    val ctx = appContext ?: throw IllegalStateException("ShortsPool not init")
    val slot = slots[slotIndex]
    slot.player?.let { return it }

    val trackSelector = DefaultTrackSelector(ctx).apply {
      setParameters(
        buildUponParameters()
          // Fold decode budget: keep neighbors light (540p cap).
          .setMaxVideoSize(960, 540)
          .setForceHighestSupportedBitrate(false),
      )
    }
    val loadControl = DefaultLoadControl.Builder()
      // Short buffers — 3 concurrent players must not stall the UI thread.
      // bufferForPlaybackMs kept low so a primed neighbor promotes instantly.
      .setBufferDurationsMs(500, 2_000, 80, 250)
      .setPrioritizeTimeOverSizeThresholds(true)
      .build()
    val factory = cacheFactory ?: DefaultDataSource.Factory(ctx)
    val mediaSourceFactory = DefaultMediaSourceFactory(ctx).setDataSourceFactory(factory)

    val player = ExoPlayer.Builder(ctx)
      .setTrackSelector(trackSelector)
      .setLoadControl(loadControl)
      .setMediaSourceFactory(mediaSourceFactory)
      .build()

    player.repeatMode = Player.REPEAT_MODE_ONE
    player.volume = 0f
    player.playWhenReady = false
    try {
      player.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING)
    } catch (_: Throwable) {
    }
    player.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_READY) {
          slot.ready = true
          // Repark only before first paint — never seek an already-playing active mid-clip.
          if (!slot.firstFramePrimed) {
            try {
              val pos = slot.player?.currentPosition ?: 0L
              if (pos > 40L) {
                slot.player?.seekTo(0)
                Log.i(TAG, "ready-repark0 slot=$slotIndex wasPos=$pos")
              }
            } catch (_: Throwable) {
            }
          }
          slot.view?.emitReady()
          applyPlayback(slotIndex)
        }
      }

      override fun onRenderedFirstFrame() {
        slot.firstFramePrimed = true
        slot.view?.emitFirstFrame()
        // Neighbor warm: park immediately after first paint so promote is unmute+play.
        if (slot.role != "active") {
          try {
            slot.player?.playWhenReady = false
            val pos = slot.player?.currentPosition ?: 0L
            if (pos > 40L) {
              slot.player?.seekTo(0)
              Log.i(TAG, "neighbor-park0 slot=$slotIndex wasPos=$pos")
            }
          } catch (_: Throwable) {
          }
        }
      }

      override fun onVideoSizeChanged(videoSize: VideoSize) {
        if (videoSize.width > 0 && videoSize.height > 0) {
          // Apply cover matrix before first visible frame (TextureView ignores Exo crop mode).
          slot.view?.onVideoSize(videoSize.width, videoSize.height)
        }
      }

      override fun onPlayerError(error: PlaybackException) {
        Log.w(TAG, "slot=$slotIndex ${error.errorCodeName} ${error.message}")
        slot.view?.emitError(error.errorCodeName, error.message ?: "playback_error")
      }
    })
    slot.player = player
    return player
  }

  private fun pickSlot(uri: String, preferView: ShortsSurfaceView?): Int {
    for (i in slots.indices) if (slots[i].uri == uri) return i
    for (i in slots.indices) if (slots[i].view === preferView) return i
    for (i in slots.indices) if (slots[i].uri == null && slots[i].view == null) return i
    for (i in slots.indices) if (!slots[i].playing && slots[i].view == null) return i
    for (i in slots.indices) if (!slots[i].playing) return i
    // Last resort: never steal the audible active slot while a neighbor exists.
    for (i in slots.indices) if (slots[i].role != "active") return i
    return 0
  }

  fun bind(
    view: ShortsSurfaceView,
    uri: String,
    playing: Boolean,
    muted: Boolean,
    role: String,
    resizeMode: String,
  ) {
    runOnMain {
      if (uri.isBlank()) {
        unbindInternal(view)
        return@runOnMain
      }
      init(view.context)
      for (i in slots.indices) {
        if (slots[i].view === view && slots[i].uri != uri) {
          clearSurface(i)
          slots[i].view = null
        }
      }
      val idx = pickSlot(uri, view)
      val slot = slots[idx]
      if (slot.view != null && slot.view !== view) {
        clearSurface(idx)
        slot.view = null
      }
      val player = ensurePlayer(idx)
      val uriChanged = slot.uri != uri
      slot.view = view
      slot.muted = muted
      slot.playing = playing
      slot.role = if (role == "active") "active" else "neighbor"
      view.attachSlot(idx)
      view.applyResizeMode(resizeMode)

      if (uriChanged) {
        slot.ready = false
        slot.firstFramePrimed = false
        slot.uri = uri
        // Hold audible play until STATE_READY + parked at 0 (see applyPlayback / listener).
        player.playWhenReady = false
        player.stop()
        player.clearMediaItems()
        player.setMediaItem(buildMediaItem(uri))
        try {
          player.seekTo(0)
          Log.i(TAG, "bind-seek0 slot=$idx uriChanged=1 held")
        } catch (_: Throwable) {
        }
        player.prepare()
      } else {
        Log.i(TAG, "bind-reuse promote-seek=0 slot=$idx role=${slot.role} primed=${slot.firstFramePrimed}")
      }
      attachSurface(idx, view)
      applyPlayback(idx)
    }
  }

  fun seekView(view: ShortsSurfaceView, ms: Long) {
    runOnMain {
      for (i in slots.indices) {
        if (slots[i].view === view) {
          try {
            Log.i(TAG, "promote-seek slot=$i ms=$ms")
            slots[i].player?.seekTo(ms.coerceAtLeast(0L))
          } catch (_: Throwable) {
          }
          return@runOnMain
        }
      }
    }
  }

  fun unbind(view: ShortsSurfaceView) {
    runOnMain { unbindInternal(view) }
  }

  private fun unbindInternal(view: ShortsSurfaceView) {
    for (i in slots.indices) {
      if (slots[i].view === view) {
        clearSurface(i)
        slots[i].view = null
        slots[i].playing = false
        slots[i].player?.playWhenReady = false
        view.attachSlot(-1)
        return
      }
    }
  }

  /** Instant promote: same URI already decoding on this view — mute/role only. */
  fun uriMatches(idx: Int, uri: String): Boolean {
    if (idx < 0 || idx >= slots.size) return false
    return slots[idx].uri == uri
  }

  fun hasBoundUri(view: ShortsSurfaceView, uri: String): Boolean {
    for (i in slots.indices) {
      if (slots[i].view === view && slots[i].uri == uri) return true
    }
    return false
  }

  fun updatePlayback(view: ShortsSurfaceView, playing: Boolean, muted: Boolean, role: String) {
    runOnMain {
      for (i in slots.indices) {
        if (slots[i].view === view) {
          slots[i].playing = playing
          slots[i].muted = muted
          slots[i].role = if (role == "active") "active" else "neighbor"
          // Neighbor→active promote: unmute only — promote-seek=0.
          Log.i(TAG, "promote-seek=0 slot=$i playing=$playing muted=$muted role=${slots[i].role}")
          applyPlayback(i)
          return@runOnMain
        }
      }
    }
  }

  private fun applyPlayback(idx: Int) {
    val slot = slots[idx]
    val player = slot.player ?: return
    val wantAudible = slot.playing && !slot.muted && slot.role == "active"
    player.volume = if (slot.muted || !wantAudible) 0f else 1f
    if (!slot.ready) {
      // Hold until STATE_READY — prepare+play races paint ~300ms then seek snap.
      player.playWhenReady = false
      return
    }
    if (slot.role != "active") {
      // Neighbor: muted decode until first frame, then park at 0 (surface ready).
      if (!slot.firstFramePrimed) {
        player.playWhenReady = true
      } else {
        player.playWhenReady = false
      }
      return
    }
    // Active: primed neighbor → instant; cold land waits for ready (above).
    player.playWhenReady = slot.playing
  }

  private fun attachSurface(idx: Int, view: ShortsSurfaceView) {
    val player = slots[idx].player ?: return
    val surface = view.surface
    if (surface != null && surface.isValid) {
      player.setVideoSurface(surface)
    } else {
      player.clearVideoSurface()
    }
  }

  fun onSurfaceAvailable(view: ShortsSurfaceView, surface: Surface) {
    runOnMain {
      for (i in slots.indices) {
        if (slots[i].view === view) {
          slots[i].player?.setVideoSurface(surface)
          return@runOnMain
        }
      }
    }
  }

  fun onSurfaceDestroyed(view: ShortsSurfaceView) {
    runOnMain {
      for (i in slots.indices) {
        if (slots[i].view === view) {
          clearSurface(i)
          return@runOnMain
        }
      }
    }
  }

  private fun clearSurface(idx: Int) {
    slots[idx].player?.clearVideoSurface()
  }

  private fun buildMediaItem(uri: String): MediaItem {
    val lower = uri.lowercase()
    val builder = MediaItem.Builder().setUri(Uri.parse(uri))
    if (lower.contains(".m3u8") || lower.contains("format=m3u8") || lower.contains("/hls/")) {
      builder.setMimeType(MimeTypes.APPLICATION_M3U8)
    } else if (lower.contains(".mp4")) {
      builder.setMimeType(MimeTypes.VIDEO_MP4)
    }
    return builder.build()
  }

  /** Range-prefetch into the same SimpleCache ExoPlayer reads. */
  fun prefetchOpening(uri: String, bytes: Long = OPENING_DEFAULT_BYTES): Boolean {
    if (uri.isBlank()) return false
    if (!(uri.startsWith("http://") || uri.startsWith("https://"))) return false
    if (openingJobs.putIfAbsent(uri, true) != null) return false
    val factory = cacheFactory
    if (factory == null) {
      openingJobs.remove(uri)
      return false
    }
    val limit = bytes.coerceIn(64_000L, 2_000_000L)
    var dataSource: androidx.media3.datasource.DataSource? = null
    return try {
      val ds = factory.createDataSource()
      dataSource = ds
      val spec = androidx.media3.datasource.DataSpec.Builder()
        .setUri(Uri.parse(uri))
        .setPosition(0)
        .setLength(limit)
        .build()
      ds.open(spec)
      val buf = ByteArray(64 * 1024)
      var readTotal = 0L
      while (readTotal < limit) {
        val n = ds.read(buf, 0, buf.size)
        if (n == C.RESULT_END_OF_INPUT || n < 0) break
        readTotal += n
      }
      readTotal >= 16_384L
    } catch (t: Throwable) {
      Log.w(TAG, "prefetch fail: ${t.message}")
      false
    } finally {
      try {
        dataSource?.close()
      } catch (_: Throwable) {
      }
      openingJobs.remove(uri)
    }
  }

  fun prefetchOpeningAsync(uri: String, bytes: Long = OPENING_DEFAULT_BYTES) {
    if (uri.isBlank()) return
    io.execute { prefetchOpening(uri, bytes) }
  }

  fun diagnostics(): Map<String, Any?> {
    return mapOf(
      "poolSize" to POOL_SIZE,
      "engine" to "BlypShorts",
      "openingJobs" to openingJobs.size,
      "cacheBytes" to (simpleCache?.cacheSpace ?: 0L),
      "slots" to slots.mapIndexed { i, s ->
        mapOf(
          "index" to i,
          "uri" to s.uri,
          "playing" to s.playing,
          "muted" to s.muted,
          "role" to s.role,
          "ready" to s.ready,
          "firstFramePrimed" to s.firstFramePrimed,
        )
      },
    )
  }

  fun releaseAll() {
    runOnMain {
      for (i in slots.indices) {
        clearSurface(i)
        slots[i].player?.release()
        slots[i] = Slot()
      }
    }
  }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block()
    else main.post(block)
  }
}
