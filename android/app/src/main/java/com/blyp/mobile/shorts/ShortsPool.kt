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
  private const val OPENING_DEFAULT_BYTES = 1_024L * 1024L

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
    var didSeekOnActivate: Boolean = false,
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
          .setMaxVideoSize(1280, 720)
          .setForceHighestSupportedBitrate(false),
      )
    }
    val loadControl = DefaultLoadControl.Builder()
      .setBufferDurationsMs(1_200, 6_000, 200, 400)
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
    player.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_READY) {
          slot.ready = true
          slot.view?.emitReady()
          // Neighbor: park at t=0 after prime so audible swipe hears the opening.
          if (slot.role == "neighbor" && slot.muted) {
            try {
              player.seekTo(0)
            } catch (_: Throwable) {
            }
            if (!slot.playing) player.playWhenReady = false
          }
        }
      }

      override fun onRenderedFirstFrame() {
        slot.view?.emitFirstFrame()
      }

      override fun onVideoSizeChanged(videoSize: VideoSize) {
        if (videoSize.width > 0 && videoSize.height > 0) {
          slot.view?.emitVideoSize(videoSize.width, videoSize.height)
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
        slot.didSeekOnActivate = false
        slot.uri = uri
        player.stop()
        player.clearMediaItems()
        player.setMediaItem(buildMediaItem(uri))
        player.prepare()
      }
      attachSurface(idx, view)
      // Active bind always parks at t=0 (promote / remount with same warm URI).
      if (slot.role == "active") {
        try {
          player.seekTo(0)
          slot.didSeekOnActivate = true
        } catch (_: Throwable) {
        }
      }
      applyPlayback(idx)
    }
  }

  fun seekView(view: ShortsSurfaceView, ms: Long) {
    runOnMain {
      for (i in slots.indices) {
        if (slots[i].view === view) {
          try {
            slots[i].player?.seekTo(ms.coerceAtLeast(0L))
            if (ms <= 0L && slots[i].role == "active") {
              slots[i].didSeekOnActivate = true
            }
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

  fun updatePlayback(view: ShortsSurfaceView, playing: Boolean, muted: Boolean, role: String) {
    runOnMain {
      for (i in slots.indices) {
        if (slots[i].view === view) {
          slots[i].playing = playing
          slots[i].muted = muted
          slots[i].role = if (role == "active") "active" else "neighbor"
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
    // Seek-to-0 on every activate (muted or unmuted) — TikTok settle bar.
    if (slot.role == "active" && slot.playing && !slot.didSeekOnActivate) {
      try {
        player.seekTo(0)
      } catch (_: Throwable) {
      }
      slot.didSeekOnActivate = true
    } else if (slot.role != "active") {
      slot.didSeekOnActivate = false
    }
    player.volume = if (slot.muted || !wantAudible) 0f else 1f
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
