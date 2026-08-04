package com.blyp.mobile.notifications

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.ConcurrentLinkedDeque

/**
 * On-device notification glance for the Blyp Hub ("Needs you").
 *
 * Privacy contract (BLYP_CHARTER.md): notifications are held ONLY in memory on
 * the user's own device, capped to a small ring buffer, and are never persisted
 * to disk or sent to any server. The user must explicitly grant notification
 * access in system settings, and can revoke it at any time.
 */
class BlypNotificationListenerService : NotificationListenerService() {

  data class Item(
    val key: String,
    val pkg: String,
    val title: String,
    val text: String,
    val postTime: Long
  )

  companion object {
    private const val MAX = 100
    // In-memory only. Cleared on process death; never written anywhere.
    val recent = ConcurrentLinkedDeque<Item>()

    fun snapshot(): List<Item> = recent.toList()
    fun clearAll() = recent.clear()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val n = sbn ?: return
    val pkg = n.packageName ?: return
    // Never mirror our own notifications.
    if (pkg == applicationContext.packageName) return

    val extras = n.notification?.extras
    val title = extras?.getCharSequence("android.title")?.toString().orEmpty()
    val text = extras?.getCharSequence("android.text")?.toString().orEmpty()
    if (title.isBlank() && text.isBlank()) return

    val item = Item(
      key = n.key ?: (pkg + n.postTime.toString()),
      pkg = pkg,
      title = title,
      text = text,
      postTime = n.postTime
    )
    // Newest first; drop oldest beyond the cap.
    recent.remove(item)
    recent.addFirst(item)
    while (recent.size > MAX) recent.pollLast()
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification?) {
    val key = sbn?.key ?: return
    val iterator = recent.iterator()
    while (iterator.hasNext()) {
      if (iterator.next().key == key) iterator.remove()
    }
  }
}
