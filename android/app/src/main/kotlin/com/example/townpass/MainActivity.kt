package com.example.townpass

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import com.example.townpass.asr.AsrConfig
import com.example.townpass.asr.AsrServer
import com.example.townpass.llm.LlmConfig
import com.example.townpass.llm.LlmServer
import com.example.townpass.speech.SpeechInput
import com.example.townpass.tts.TtsConfig
import com.example.townpass.tts.TtsOperations
import com.example.townpass.tts.TtsPhase
import com.example.townpass.tts.TtsServer
import com.example.townpass.tts.TtsStatus
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    // 模型下載與子行程啟動很慢，放在背景執行緒；結果回到主執行緒再交給 Flutter。
    private val worker: ExecutorService = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var ttsOwner: TtsOperations.Owner? = null
    private var microphonePermissionResult: MethodChannel.Result? = null
    private var speechInput: SpeechInput? = null

    // 暫時的 workaround，對應 flutter_inappwebview issue #1694：
    // https://github.com/pichillilorenzo/flutter_inappwebview/issues/1694
    // flutter_inappwebview_android 1.1.3 把 WebView 包在 PullToRefreshLayout 裡，
    // 這個 layout 不可取得焦點，TalkBack 滑動導覽會直接略過整個網頁內容。
    // 上游的修正（commit afe154d，只有 1.2.0-beta.2 之後的版本才有）是在
    // PullToRefreshLayout.prepare() 裡呼叫 setFocusable(true)，這裡用同樣的做法補上。
    // 升級到包含該修正的正式版之後請刪除這個 workaround：
    // pullToRefreshFocusFix、makePullToRefreshLayoutFocusable、
    // PULL_TO_REFRESH_LAYOUT_CLASS，以及 onCreate／onDestroy 裡相關的程式。
    private val pullToRefreshFocusFix = ViewTreeObserver.OnGlobalLayoutListener {
        makePullToRefreshLayoutFocusable(window.decorView)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 每開一個 TPWebView 就會新建一個 PullToRefreshLayout，所以要持續監聽 layout，
        // 不能只在啟動時處理一次。
        window.decorView.viewTreeObserver.addOnGlobalLayoutListener(pullToRefreshFocusFix)
    }

    // 以類別名稱字串比對，不直接 import 外掛的類別；找到之後不再往下找它的子 view。
    private fun makePullToRefreshLayoutFocusable(view: View) {
        if (view.javaClass.name == PULL_TO_REFRESH_LAYOUT_CLASS) {
            if (!view.isFocusable) {
                view.isFocusable = true
            }
            return
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                makePullToRefreshLayoutFocusable(view.getChildAt(i))
            }
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        configureAsrChannel(flutterEngine)
        configureSpeechChannel(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "town_pass/llm").setMethodCallHandler { call, result ->
            when (call.method) {
                "status" -> result.success(LlmServer.status().toMap())
                "start" -> {
                    val defaults = LlmConfig()
                    val config = LlmConfig(
                        threads = call.argument<Int>("threads"),
                        contextSize = call.argument<Int>("contextSize") ?: defaults.contextSize,
                        kvCacheType = call.argument<String>("kvCacheType") ?: defaults.kvCacheType,
                        flashAttention = call.argument<Boolean>("flashAttention") ?: defaults.flashAttention,
                    )
                    val ticket = LlmServer.startTicket()
                    worker.execute {
                        val status = LlmServer.start(applicationContext, config, ticket)
                        mainHandler.post { result.success(status.toMap()) }
                    }
                }
                "stop" -> {
                    LlmServer.cancelPendingStart()
                    worker.execute {
                        val status = LlmServer.stop(applicationContext)
                        mainHandler.post { result.success(status.toMap()) }
                    }
                }
                else -> result.notImplemented()
            }
        }
        val owner = TtsServer.attach()
        ttsOwner = owner
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "town_pass/tts").setMethodCallHandler { call, result ->
            when (call.method) {
                "status" -> result.success(TtsServer.status().toMap())
                "start" -> {
                    val arguments = call.arguments
                    val options = arguments as? Map<*, *>
                    val threads = options?.get("threads")
                    if ((arguments != null && options == null) ||
                        options?.keys?.any { it != "threads" } == true ||
                        (threads != null && threads !is Int)
                    ) {
                        result.success(TtsStatus(TtsPhase.ERROR, error = "TTS_INVALID_CONFIG").toMap())
                    } else {
                        val config = TtsConfig(threads = threads as? Int)
                        TtsServer.start(applicationContext, config, owner) { status, ticket ->
                            mainHandler.post {
                                result.success(TtsServer.startReply(owner, ticket, status).toMap())
                            }
                        }
                    }
                }
                "stop" -> {
                    TtsServer.stop(owner) { status ->
                        mainHandler.post { result.success(status.toMap()) }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun configureAsrChannel(flutterEngine: FlutterEngine) {
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "town_pass/asr").setMethodCallHandler { call, result ->
            when (call.method) {
                "microphonePermission" -> requestMicrophonePermission(result)
                "status" -> result.success(AsrServer.status().toMap())
                "start" -> {
                    val config = AsrConfig(threads = call.argument<Int>("threads"))
                    val ticket = AsrServer.startTicket()
                    worker.execute {
                        val status = AsrServer.start(applicationContext, config, ticket)
                        mainHandler.post { result.success(status.toMap()) }
                    }
                }
                "stop" -> worker.execute {
                    val status = AsrServer.stop(applicationContext)
                    mainHandler.post { result.success(status.toMap()) }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun requestMicrophonePermission(result: MethodChannel.Result) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            result.success(true)
            return
        }
        if (microphonePermissionResult != null) {
            result.success(false)
            return
        }
        microphonePermissionResult = result
        try {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MICROPHONE_PERMISSION_REQUEST)
        } catch (_: Exception) {
            microphonePermissionResult = null
            result.success(false)
        }
    }

    // 安心助手的語音輸入：系統語音辨識，事件以 "event" 回呼送回 Dart。
    private fun configureSpeechChannel(flutterEngine: FlutterEngine) {
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "town_pass/speech")
        val input = SpeechInput(this) { event -> channel.invokeMethod("event", event) }
        speechInput = input
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    input.start(call.argument<String>("language") ?: "zh-TW")
                    result.success(null)
                }
                "stop" -> {
                    input.stop()
                    result.success(null)
                }
                "cancel" -> {
                    input.cancel()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == MICROPHONE_PERMISSION_REQUEST) {
            val pending = microphonePermissionResult
            microphonePermissionResult = null
            pending?.success(grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
        }
        speechInput?.onPermissionResult(requestCode, grantResults)
    }

    override fun onDestroy() {
        microphonePermissionResult?.success(false)
        microphonePermissionResult = null
        speechInput?.cancel()
        speechInput = null
        val observer = window.decorView.viewTreeObserver
        if (observer.isAlive) {
            observer.removeOnGlobalLayoutListener(pullToRefreshFocusFix)
        }
        ttsOwner?.let { TtsServer.detach(it) }
        ttsOwner = null
        // ASR 不綁畫面生命週期，離開時要主動停止，釋放子行程、記憶體與連線埠。
        // 停止最久要等數秒，交給背景執行緒；shutdown 仍會跑完已排入的工作。
        AsrServer.cancelPendingStart()
        val appContext = applicationContext
        worker.execute { AsrServer.stop(appContext) }
        worker.shutdown()
        super.onDestroy()
    }

    private companion object {
        const val MICROPHONE_PERMISSION_REQUEST = 7410
        const val PULL_TO_REFRESH_LAYOUT_CLASS =
            "com.pichillilorenzo.flutter_inappwebview_android.pull_to_refresh.PullToRefreshLayout"
    }
}
