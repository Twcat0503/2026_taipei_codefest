package com.example.townpass

import android.os.Handler
import android.os.Looper
import com.example.townpass.llm.LlmConfig
import com.example.townpass.llm.LlmServer
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

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
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

    override fun onDestroy() {
        ttsOwner?.let { TtsServer.detach(it) }
        ttsOwner = null
        worker.shutdown()
        super.onDestroy()
    }
}
