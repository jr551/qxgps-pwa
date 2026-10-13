package io.github.placeholder.qxgps

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

/**
 * Minimal FOSS shell: bundled PWA assets served via [WebViewAssetLoader]
 * (https://appassets.androidplatform.net) so hash routing and fetch() behave
 * like a secure origin. No Play Services, analytics, or proprietary SDKs.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/public/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = LocalAssetClient(assetLoader)
        }

        setContentView(webView)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(START_URL)
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            },
        )
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    private class LocalAssetClient(
        private val assetLoader: WebViewAssetLoader,
    ) : WebViewClientCompat() {

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (url.startsWith(APP_ASSET_PREFIX) || url.startsWith("https://www.gps666.net")) {
                return false
            }
            // External links (e.g. OSM attribution) open in the default browser.
            if (request.isForMainFrame && url.startsWith("http")) {
                view.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                return true
            }
            return false
        }

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ) = assetLoader.shouldInterceptRequest(request.url)
    }

    companion object {
        private const val APP_ASSET_PREFIX = "https://appassets.androidplatform.net"
        private const val START_URL = "$APP_ASSET_PREFIX/public/index.html"
    }
}
