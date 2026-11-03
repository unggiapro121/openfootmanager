package com.sturdyrobot.openfootmanager

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * The app draws edge to edge (behind the status and navigation bars), so the page has to know
 * where the bars are (phase 5 M1):
 *
 * - The bars and the display cutout are handed to the page as CSS variables on `<html>`:
 *   `--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left`, in CSS px. `App.css` defaults
 *   them to `env(safe-area-inset-*)` on `:root`; the inline style set here wins, so Android gets
 *   the real insets whatever its WebView reports for `env()`, and iOS keeps WebKit's.
 * - The keyboard: with edge to edge, `adjustResize` no longer shrinks the window, so the
 *   WebView's container is padded by the keyboard's height instead, and the page's viewport
 *   shrinks with it. While the keyboard is up, `--safe-bottom` is 0 (the padding covers the
 *   navigation bar).
 *
 * The values are set again on every change of the insets (rotation, keyboard), and kept as a
 * document-start script so a reload starts with them.
 */
class MainActivity : TauriActivity() {
  private var insetsScript: ScriptHandler? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    val container = webView.parent as? ViewGroup ?: return
    ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val keyboardUp = ime.bottom > bars.bottom
      view.setPadding(0, 0, 0, if (keyboardUp) ime.bottom else 0)
      handInsets(
        webView,
        top = bars.top,
        right = bars.right,
        bottom = if (keyboardUp) 0 else bars.bottom,
        left = bars.left,
      )
      insets
    }
    ViewCompat.requestApplyInsets(container)
  }

  private fun handInsets(webView: WebView, top: Int, right: Int, bottom: Int, left: Int) {
    val density = resources.displayMetrics.density
    fun css(px: Int) = "${px / density}px"
    val script = "(function(){var s=document.documentElement.style;" +
      "s.setProperty('--safe-top','${css(top)}');" +
      "s.setProperty('--safe-right','${css(right)}');" +
      "s.setProperty('--safe-bottom','${css(bottom)}');" +
      "s.setProperty('--safe-left','${css(left)}');})();"
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      insetsScript?.remove()
      insetsScript = WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))
    }
    webView.evaluateJavascript(script, null)
  }
}
