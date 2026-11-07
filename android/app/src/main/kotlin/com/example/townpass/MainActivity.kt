package com.example.townpass

import android.os.Handler
import android.os.Looper
import com.example.townpass.asr.AsrConfig
import com.example.townpass.asr.AsrServer
import com.example.townpass.llm.LlmConfig
import com.example.townpass.llm.LlmServer
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    // 模型下載與子行程啟動很慢，放在背景執行緒；結果回到主執行緒再交給 Flutter。
    private val worker: ExecutorService = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        configureAsrChannel(flutterEngine)
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
    }

    private fun configureAsrChannel(flutterEngine: FlutterEngine) {
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "town_pass/asr").setMethodCallHandler { call, result ->
            when (call.method) {
                "status" -> result.success(AsrServer.status().toMap())
                "start" -> {
                    val config = AsrConfig(threads = call.argument<Int>("threads"))
                    worker.execute {
                        val status = AsrServer.start(applicationContext, config)
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

    override fun onDestroy() {
        worker.shutdown()
        super.onDestroy()
    }
}
