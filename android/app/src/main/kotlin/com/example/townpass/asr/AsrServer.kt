package com.example.townpass.asr

import android.content.Context
import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.system.Os
import android.system.OsConstants
import com.example.townpass.llm.CpuTopology
import com.example.townpass.llm.LlmConfig
import com.example.townpass.localserver.isAlive
import com.example.townpass.localserver.killByPidFile
import com.example.townpass.localserver.newApiKey
import com.example.townpass.localserver.pidOf
import com.example.townpass.localserver.pumpOutputTo
import com.example.townpass.localserver.sha256Of
import com.example.townpass.localserver.waitExit
import java.io.File
import java.io.IOException

/**
 * 本機 ASR 服務設定。模型不隨 APK 發佈，須先放到 [AsrServer.modelDir]（做法見 tools/asr-android/README.md）。
 *
 * 模型是 adi-gov-tw/Taiwan-Tongues-ASR-CE-v1.0（Whisper large-v2 微調）的 int4 量化版：
 * 由 tools/asr-android/convert_ct2_to_ggml.py 轉成 whisper.cpp 的 GGML，再以 whisper-quantize 量化為 q4_0。
 * [modelSizeBytes] 與 [modelSha256] 是該產物的大小與雜湊，用來確認檔案完整。
 */
data class AsrConfig(
    val modelFileName: String = "ggml-taiwan-tongues-q4_0.bin",
    val modelSizeBytes: Long = 888_932_891L,
    val modelSha256: String = "b0c0e9b3bb90f515ea45cd2bb01a06bc45c4a04693b25af23b8b96ab12de79d7",
    val modelAlias: String = "taiwan-tongues-asr-ce-v1.0-q4_0",
    /** 執行緒數；null 表示依大核數自動決定（與 LLM 相同的 [CpuTopology]）。 */
    val threads: Int? = null,
) {
    fun validate() {
        threads?.let { require(it in 1..LlmConfig.MAX_THREADS) { "threads 必須在 1..${LlmConfig.MAX_THREADS} 之間" } }
    }
}

enum class AsrPhase { IDLE, STARTING, RUNNING, ERROR }

/** ASR 服務狀態。baseUrl、apiKey、model 只在 running 時有值；apiKey 只有 start 會回傳。 */
data class AsrStatus(
    val phase: AsrPhase,
    val baseUrl: String? = null,
    val apiKey: String? = null,
    val model: String? = null,
    val error: String? = null,
    val threads: Int? = null,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "phase" to phase.name.lowercase(),
        "running" to (phase == AsrPhase.RUNNING),
        "baseUrl" to baseUrl,
        "apiKey" to apiKey,
        "model" to model,
        "error" to error,
        "threads" to threads,
    )
}

/**
 * 管理本機 ASR 服務：whisper-server 子行程（只綁 unix socket）加上 [AsrProxy]（127.0.0.1、Bearer 驗證）。
 *
 * 執行檔是 jniLibs 內的 libwhisper_server.so（由 tools/asr-android/build_whisper_server.sh 產生），
 * 位於 nativeLibraryDir。與 [com.example.townpass.llm.LlmServer] 相同：start / stop 串行化，失敗不拋例外。
 */
object AsrServer {
    private const val MODEL_DIR = "asr/models"
    private const val SOCKET_FILE = "asr/run/whisper.sock"
    private const val PID_FILE = "asr/whisper-server.pid"
    private const val LOG_FILE = "asr/whisper-server.log"
    private const val READY_TIMEOUT_MS = 120_000L

    /** 預設語言為自動偵測（與 OpenAI 的預設一致）；每個請求的 language 欄位可覆寫。 */
    private const val DEFAULT_LANGUAGE = "auto"

    private val opLock = Any()
    @Volatile private var phase = AsrPhase.IDLE
    @Volatile private var lastError: String? = null
    @Volatile private var process: Process? = null
    @Volatile private var proxy: AsrProxy? = null
    @Volatile private var apiKey: String? = null
    @Volatile private var modelAlias: String? = null
    @Volatile private var usedThreads: Int? = null

    /** 模型應放置的目錄（App 私有目錄）。 */
    fun modelDir(context: Context): File = File(context.filesDir, MODEL_DIR)

    /** 只回報狀態，不回傳 API key（key 只在 start 時給呼叫端）。 */
    fun status(): AsrStatus = snapshot(includeKey = false)

    /** 啟動服務。已在執行則直接回傳目前狀態（含 key）。失敗時 phase 為 ERROR，不拋例外。 */
    fun start(context: Context, config: AsrConfig): AsrStatus = synchronized(opLock) {
        val current = process
        if (phase == AsrPhase.RUNNING && current != null && isAlive(current) && proxy?.isRunning == true) {
            return@synchronized snapshot(includeKey = true)
        }
        lastError = null
        try {
            config.validate()
            // 子行程或代理已結束時，先釋放舊入口，不能讓舊 key 連到重啟後的服務。
            if (current != null || proxy != null) {
                terminate(context)
            } else {
                killByPidFile(File(context.filesDir, PID_FILE))
            }
            phase = AsrPhase.STARTING
            val model = resolveModel(context, config)
            launch(context, config, model)
            phase = AsrPhase.RUNNING
        } catch (e: Exception) {
            lastError = e.message ?: e.javaClass.simpleName
            phase = AsrPhase.ERROR
            terminate(context)
        }
        snapshot(includeKey = true)
    }

    /** 停止服務並釋放記憶體。未在執行時也安全。 */
    fun stop(context: Context): AsrStatus = synchronized(opLock) {
        terminate(context)
        phase = AsrPhase.IDLE
        lastError = null
        snapshot(includeKey = false)
    }

    private fun snapshot(includeKey: Boolean): AsrStatus {
        val running = phase == AsrPhase.RUNNING
        val port = proxy?.port
        return AsrStatus(
            phase = phase,
            baseUrl = if (running && port != null) "http://127.0.0.1:$port/v1" else null,
            apiKey = if (running && includeKey) apiKey else null,
            model = if (running) modelAlias else null,
            error = lastError,
            threads = if (running) usedThreads else null,
        )
    }

    private fun launch(context: Context, config: AsrConfig, model: File) {
        val bin = File(context.applicationInfo.nativeLibraryDir, "libwhisper_server.so")
        if (!bin.exists()) {
            throw IOException("缺少 libwhisper_server.so，請先執行 tools/asr-android/build_whisper_server.sh")
        }
        val workDir = File(context.filesDir, "asr").apply { mkdirs() }
        val socket = File(context.filesDir, SOCKET_FILE).apply {
            parentFile?.mkdirs()
            delete() // 上次異常結束留下的 socket 檔會讓 bind 失敗
        }
        val threads = config.threads ?: CpuTopology.bigCoreCount()
        val child = ProcessBuilder(
            bin.absolutePath,
            "-m", model.absolutePath,
            "--host", socket.absolutePath,
            "--inference-path", AsrProxy.TRANSCRIPTION_PATH,
            "-t", threads.toString(),
            "-l", DEFAULT_LANGUAGE,
        ).apply {
            directory(workDir)
            environment()["LD_LIBRARY_PATH"] = context.applicationInfo.nativeLibraryDir
            redirectErrorStream(true)
        }.start()

        pumpOutputTo(child, File(context.filesDir, LOG_FILE).apply { parentFile?.mkdirs() })
        process = child
        pidOf(child)?.let { File(context.filesDir, PID_FILE).writeText(it.toString()) }
        waitReady(child, socket)

        val key = newApiKey()
        proxy = AsrProxy(socket.absolutePath, key, config.modelAlias)
        apiKey = key
        modelAlias = config.modelAlias
        usedThreads = threads
    }

    /** 等 whisper-server 的 unix socket 能完成一次 HTTP 往返，代表模型已載入並開始接受連線。 */
    private fun waitReady(child: Process, socket: File) {
        val deadline = System.currentTimeMillis() + READY_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (!isAlive(child)) {
                throw IOException("whisper-server 已結束（exit=${child.exitValue()}），請查看 asr/whisper-server.log")
            }
            if (socket.exists() && probe(socket)) return
            Thread.sleep(300)
        }
        throw IOException("whisper-server 在 ${READY_TIMEOUT_MS / 1000} 秒內未就緒")
    }

    private fun probe(socket: File): Boolean {
        val local = LocalSocket()
        return try {
            local.connect(LocalSocketAddress(socket.absolutePath, LocalSocketAddress.Namespace.FILESYSTEM))
            local.soTimeout = 2_000
            local.outputStream.apply {
                write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
                flush()
            }
            val statusLine = ByteArray(5)
            local.inputStream.read(statusLine) == 5 && String(statusLine, Charsets.US_ASCII) == "HTTP/"
        } catch (ignored: IOException) {
            false
        } finally {
            runCatching { local.close() }
        }
    }

    private fun terminate(context: Context) {
        proxy?.close()
        proxy = null
        val child = process
        if (child != null && isAlive(child)) {
            child.destroy() // SIGTERM
            if (!waitExit(child, 5_000L)) {
                pidOf(child)?.let { runCatching { Os.kill(it.toInt(), OsConstants.SIGKILL) } }
                child.destroy()
                waitExit(child, 2_000L)
            }
        }
        process = null
        apiKey = null
        modelAlias = null
        usedThreads = null
        File(context.filesDir, SOCKET_FILE).delete()
        File(context.filesDir, PID_FILE).delete()
    }

    private fun resolveModel(context: Context, config: AsrConfig): File {
        val dir = modelDir(context)
        val model = File(dir, config.modelFileName)
        if (!model.isFile) {
            throw IOException("缺少 ASR 模型 ${config.modelFileName}，請放到 ${dir.absolutePath}")
        }
        if (model.length() != config.modelSizeBytes) {
            throw IOException("ASR 模型大小不符（${model.length()} / ${config.modelSizeBytes} 位元組），檔案可能不完整")
        }
        verifySha256Once(model, config.modelSha256)
        return model
    }

    /** 雜湊約需數秒，只在檔案第一次出現或內容變動時計算，結果記在旁邊的標記檔。 */
    private fun verifySha256Once(model: File, expected: String) {
        val marker = File(model.parentFile, "${model.name}.verified")
        val stamp = "$expected:${model.length()}:${model.lastModified()}"
        if (marker.exists() && marker.readText() == stamp) return
        if (!sha256Of(model).equals(expected, ignoreCase = true)) {
            throw IOException("ASR 模型 SHA-256 不符，請重新放入檔案")
        }
        marker.writeText(stamp)
    }
}
