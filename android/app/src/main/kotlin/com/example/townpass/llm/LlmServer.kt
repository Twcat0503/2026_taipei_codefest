package com.example.townpass.llm

import android.content.Context
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.CancellationException

/** 一個需要下載並驗證的模型檔。[sizeBytes] 與 [sha256] 取自 Hugging Face 的 LFS 中繼資料。 */
data class ModelFile(
    val fileName: String,
    val url: String,
    val sizeBytes: Long,
    val sha256: String,
)

/**
 * 本地 LLM 服務設定。模型不隨 APK 發佈，第一次啟動時從 Hugging Face 下載並驗證大小與 SHA-256。
 * 預設為多模態的 LiquidAI/LFM3-VL-2B-GGUF：語言模型 LFM3-VL-2B-QAD-Q4_0.gguf，
 * 加上視覺投影檔 mmproj-LFM3-VL-2B-Q8_0.gguf（已於 2026-11-08 用 HF 的 LFS 雜湊核對）。
 * [mmproj] 設為 null 時不載入視覺部分，只做文字推論。
 *
 * 調校預設（2026-11-07 於 x86_64 模擬器以 LFM3-1.7B 量測，只用於相對比較，手機需實測）：
 * - KV cache 用 q8_0：4096 上下文 KV 為 25.5 MiB（f16 為 48 MiB）；深度 2048 的解碼也較快。
 * - flash attention 開啟：V 量化需要它，prefill 也較快。非 f16 的 KV 會強制開啟。
 * - contextSize 預設 4096，上限 16384（q8_0 時 KV 約 102 MiB）。解碼速度隨深度下降。
 * - threads 為 null 時依大核數自動決定（見 [CpuTopology]）。
 */
data class LlmConfig(
    val model: ModelFile = DEFAULT_MODEL,
    /** 視覺投影檔（mmproj）；null 表示只做文字推論。 */
    val mmproj: ModelFile? = DEFAULT_MMPROJ,
    val modelAlias: String = "lfm3-vl-2b-q4_0",
    val contextSize: Int = 4096,
    /** 執行緒數；null 表示依大核數自動決定。 */
    val threads: Int? = null,
    /** KV cache 型別，支援 f16 與 q8_0（q4_0 量化誤差較大，未開放）。 */
    val kvCacheType: String = "q8_0",
    val flashAttention: Boolean = true,
) {
    /** 參數範圍檢查；不合法時丟出 IllegalArgumentException，start 會把它轉成 error 狀態。 */
    fun validate() {
        require(contextSize in MIN_CONTEXT..MAX_CONTEXT) { "contextSize 必須在 $MIN_CONTEXT..$MAX_CONTEXT 之間" }
        threads?.let { require(it in 1..MAX_THREADS) { "threads 必須在 1..$MAX_THREADS 之間" } }
        require(kvCacheType in SUPPORTED_KV_TYPES) { "kvCacheType 只支援 ${SUPPORTED_KV_TYPES.joinToString()}" }
    }

    companion object {
        const val MIN_CONTEXT = 512
        const val MAX_CONTEXT = 16_384
        const val MAX_THREADS = 16
        val SUPPORTED_KV_TYPES = setOf("f16", "q8_0")

        private const val HF_REPO = "https://huggingface.co/LiquidAI/LFM3-VL-2B-GGUF/resolve/main"

        val DEFAULT_MODEL = ModelFile(
            fileName = "LFM3-VL-2B-QAD-Q4_0.gguf",
            url = "$HF_REPO/LFM3-VL-2B-QAD-Q4_0.gguf",
            sizeBytes = 1_049_615_648L,
            sha256 = "621c455376cb96a20891697deb9975c6fb47dd5ea98ed3ad1f3b7e8f24f0b1e6",
        )

        val DEFAULT_MMPROJ = ModelFile(
            fileName = "mmproj-LFM3-VL-2B-Q8_0.gguf",
            url = "$HF_REPO/mmproj-LFM3-VL-2B-Q8_0.gguf",
            sizeBytes = 203_031_872L,
            sha256 = "c5c5b58d544a18da919172d2d0368090ea1a4a351b6feb7f8a326a264a5918ab",
        )
    }
}

enum class LlmPhase { IDLE, DOWNLOADING, STARTING, RUNNING, ERROR }

data class LlmStatus(
    val phase: LlmPhase,
    val baseUrl: String? = null,
    val apiKey: String? = null,
    val model: String? = null,
    val error: String? = null,
    /** 實際採用的設定（只有 running 時有值）。 */
    val threads: Int? = null,
    val contextSize: Int? = null,
    val kvCacheType: String? = null,
    val flashAttention: Boolean? = null,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "phase" to phase.name.lowercase(),
        "running" to (phase == LlmPhase.RUNNING),
        "baseUrl" to baseUrl,
        "apiKey" to apiKey,
        "model" to model,
        "error" to error,
        "threads" to threads,
        "contextSize" to contextSize,
        "kvCacheType" to kvCacheType,
        "flashAttention" to flashAttention,
    )
}

/**
 * 依 CPU 最大頻率估計大核數，作為 llama.cpp 的預設執行緒數。
 *
 * 只統計「存在 cpufreq 資訊」的核心（離線核心沒有）。頻率 ≥ 最高頻率 × 0.8 的算大核。
 * 以下情況退回 min(4, 可用核心數)：讀不到頻率、頻率值無效（低於 100 MHz，例如虛擬機的占位值），
 * 或所有核心頻率相同（無法分辨大核與小核）。
 */
internal object CpuTopology {
    private const val BIG_CORE_RATIO = 0.8
    private const val MIN_VALID_KHZ = 100_000L
    private val CPU_DIR_PATTERN = Regex("cpu\\d+")

    fun bigCoreCount(): Int {
        val freqs = maxFrequenciesKhz().filter { it >= MIN_VALID_KHZ }
        if (freqs.distinct().size < 2) return fallback()
        val top = freqs.maxOrNull() ?: return fallback()
        return freqs.count { it >= top * BIG_CORE_RATIO }.coerceIn(1, LlmConfig.MAX_THREADS)
    }

    private fun maxFrequenciesKhz(): List<Long> {
        val cpuDirs = File("/sys/devices/system/cpu").listFiles { f -> CPU_DIR_PATTERN.matches(f.name) }
            ?: return emptyList()
        return cpuDirs.mapNotNull { cpu ->
            runCatching { File(cpu, "cpufreq/cpuinfo_max_freq").readText().trim().toLong() }.getOrNull()
        }
    }

    private fun fallback(): Int = minOf(4, Runtime.getRuntime().availableProcessors()).coerceAtLeast(1)
}

/**
 * 管理本機 llama-server 子行程：下載模型、啟動、等待就緒、停止。
 *
 * 執行檔是 jniLibs 內的 libllama_server.so（由 tools/llm-android/build_llama_server.sh 產生），
 * 位於 nativeLibraryDir，可以直接執行。服務只綁 127.0.0.1，並以隨機 API key 保護。
 */
object LlmServer {
    private const val PID_FILE = "llm/llama-server.pid"
    private const val LOG_FILE = "llm/llama-server.log"
    private const val HEALTH_TIMEOUT_MS = 180_000L

    private val generation = AtomicLong(0)
    @Volatile private var downloadConnection: HttpURLConnection? = null
    fun startTicket(): Long = generation.get()
    fun cancelPendingStart() { generation.incrementAndGet() }
    private fun checkActive(ticket: Long) {
        if (generation.get() != ticket) throw CancellationException("LLM_START_CANCELLED")
    }

    private val opLock = Any() // 串行化 start / stop
    @Volatile private var phase = LlmPhase.IDLE
    @Volatile private var lastError: String? = null
    @Volatile private var process: Process? = null
    @Volatile private var port = 0
    @Volatile private var apiKey: String? = null
    @Volatile private var modelAlias: String? = null
    @Volatile private var usedThreads: Int? = null
    @Volatile private var usedContext: Int? = null
    @Volatile private var usedKv: String? = null
    @Volatile private var usedFlashAttn: Boolean? = null

    /** 只回報狀態，不回傳 API key（key 只在 start 時給呼叫端）。 */
    fun status(): LlmStatus = snapshot(includeKey = false)

    /** 啟動服務。已在執行則直接回傳目前狀態（含 key）。失敗時 phase 為 ERROR，不拋例外。 */
    fun start(context: Context, config: LlmConfig, ticket: Long = startTicket()): LlmStatus = synchronized(opLock) {
        if (generation.get() != ticket) return@synchronized snapshot(includeKey = false)
        val current = process
        if (phase == LlmPhase.RUNNING && current != null && isAlive(current)) {
            return@synchronized snapshot(includeKey = true)
        }
        lastError = null
        try {
            config.validate()
            killLeftover(context)
            phase = LlmPhase.DOWNLOADING
            pruneStaleModels(context, listOfNotNull(config.model, config.mmproj))
            val model = ensureModel(context, config.model, ticket)
            val mmproj = config.mmproj?.let { ensureModel(context, it, ticket) }
            checkActive(ticket)
            phase = LlmPhase.STARTING
            launch(context, config, model, mmproj, ticket)
            checkActive(ticket)
            phase = LlmPhase.RUNNING
        } catch (e: Exception) {
            val cancelled = generation.get() != ticket
            lastError = if (cancelled) null else (e.message ?: e.javaClass.simpleName)
            phase = if (cancelled) LlmPhase.IDLE else LlmPhase.ERROR
            terminate(context)
        }
        snapshot(includeKey = true)
    }

    /** 停止服務並釋放記憶體。未在執行時也安全。 */
    fun stop(context: Context): LlmStatus {
        downloadConnection?.disconnect()
        return synchronized(opLock) {
            terminate(context)
            phase = LlmPhase.IDLE
            lastError = null
            snapshot(includeKey = false)
        }
    }

    private fun snapshot(includeKey: Boolean): LlmStatus {
        if (phase == LlmPhase.RUNNING && process?.let { !isAlive(it) } != false) {
            phase = LlmPhase.ERROR
            lastError = "LLM_PROCESS_EXITED"
        }
        val running = phase == LlmPhase.RUNNING
        return LlmStatus(
            phase = phase,
            baseUrl = if (running) "http://127.0.0.1:$port/v1" else null,
            apiKey = if (running && includeKey) apiKey else null,
            model = if (running) modelAlias else null,
            error = lastError,
            threads = if (running) usedThreads else null,
            contextSize = if (running) usedContext else null,
            kvCacheType = if (running) usedKv else null,
            flashAttention = if (running) usedFlashAttn else null,
        )
    }

    private fun launch(context: Context, config: LlmConfig, model: File, mmproj: File?, ticket: Long) {
        val bin = File(context.applicationInfo.nativeLibraryDir, "libllama_server.so")
        if (!bin.exists()) {
            throw IOException("缺少 libllama_server.so，請先執行 tools/llm-android/build_llama_server.sh")
        }
        val threads = config.threads ?: CpuTopology.bigCoreCount()
        // V 量化需要 flash attention，所以非 f16 的 KV 一律開啟。
        val flashAttn = config.flashAttention || config.kvCacheType != "f16"
        val listenPort = freePort()
        val key = newApiKey()
        appendLog(
            context,
            "[launch] model=${model.name} mmproj=${mmproj?.name ?: "none"} threads=$threads " +
                "ctx=${config.contextSize} kv=${config.kvCacheType} fa=${if (flashAttn) "on" else "off"}",
        )
        val args = mutableListOf(
            bin.absolutePath,
            "-m", model.absolutePath,
            "--host", "127.0.0.1",
            "--port", listenPort.toString(),
            "-c", config.contextSize.toString(),
            "-np", "1",
            "-t", threads.toString(),
            "-fa", if (flashAttn) "on" else "off",
            "-ctk", config.kvCacheType,
            "-ctv", config.kvCacheType,
            "--alias", config.modelAlias,
            "--jinja",
            "--reasoning", "off",
            "--no-webui",
            "--api-key", key,
        )
        // 視覺投影檔：載入後 /v1/chat/completions 接受 OpenAI 格式的 image_url（data URI）內容。
        if (mmproj != null) args += listOf("--mmproj", mmproj.absolutePath)
        val child = ProcessBuilder(args).apply {
            environment()["LD_LIBRARY_PATH"] = context.applicationInfo.nativeLibraryDir
            redirectErrorStream(true)
        }.start()

        pumpOutputTo(child, File(context.filesDir, LOG_FILE).apply { parentFile?.mkdirs() })
        process = child
        port = listenPort
        apiKey = key
        modelAlias = config.modelAlias
        usedThreads = threads
        usedContext = config.contextSize
        usedKv = config.kvCacheType
        usedFlashAttn = flashAttn
        pidOf(child)?.let { File(context.filesDir, PID_FILE).writeText(it.toString()) }
        waitHealthy(child, listenPort, ticket)
    }

    private fun waitHealthy(child: Process, listenPort: Int, ticket: Long) {
        val deadline = System.currentTimeMillis() + HEALTH_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            checkActive(ticket)
            if (!isAlive(child)) {
                throw IOException("llama-server 已結束（exit=${child.exitValue()}），請查看 llm/llama-server.log")
            }
            if (isHealthy(listenPort)) return
            Thread.sleep(500)
        }
        throw IOException("llama-server 在 ${HEALTH_TIMEOUT_MS / 1000} 秒內未就緒")
    }

    private fun isHealthy(listenPort: Int): Boolean = try {
        val conn = URL("http://127.0.0.1:$listenPort/health").openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 1_000
            conn.readTimeout = 1_000
            conn.responseCode == 200
        } finally {
            conn.disconnect()
        }
    } catch (ignored: IOException) {
        false
    }

    private fun terminate(context: Context) {
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
        port = 0
        apiKey = null
        modelAlias = null
        usedThreads = null
        usedContext = null
        usedKv = null
        usedFlashAttn = null
        File(context.filesDir, PID_FILE).delete()
    }

    /** 上次 App 被系統殺掉時，llama-server 可能還活著並佔用資源；依 PID 檔清掉它。 */
    private fun killLeftover(context: Context) {
        val pidFile = File(context.filesDir, PID_FILE)
        if (!pidFile.exists()) return
        pidFile.readText().trim().toIntOrNull()?.let { pid ->
            runCatching { Os.kill(pid, OsConstants.SIGKILL) } // 非本 App 的 PID 會因權限不足而失敗，屬預期
        }
        pidFile.delete()
    }

    /**
     * 刪掉 llm/models 內不屬於目前設定的檔案（例如換模型後留下的舊 GGUF 與其 .part），
     * 避免舊模型長期佔用約 1 GB 的空間。
     */
    private fun pruneStaleModels(context: Context, keep: List<ModelFile>) {
        val names = keep.flatMap { listOf(it.fileName, it.fileName + ".part") }.toSet()
        File(context.filesDir, "llm/models").listFiles()?.forEach { file ->
            if (file.isFile && file.name !in names) file.delete()
        }
    }

    private fun ensureModel(context: Context, file: ModelFile, ticket: Long): File {
        val dir = File(context.filesDir, "llm/models").apply { mkdirs() }
        val target = File(dir, file.fileName)
        if (target.exists() && target.length() == file.sizeBytes) return target

        val part = File(dir, file.fileName + ".part")
        if (part.length() > file.sizeBytes) part.delete()
        if (part.length() != file.sizeBytes) download(file.url, part, ticket)
        val actual = sha256(part, ticket)
        if (part.length() != file.sizeBytes || !actual.equals(file.sha256, ignoreCase = true)) {
            part.delete()
            throw IOException("模型檔驗證失敗（${file.fileName} 大小或 SHA-256 不符）")
        }
        if (target.exists()) target.delete()
        if (!part.renameTo(target)) throw IOException("無法寫入模型檔：${target.absolutePath}")
        return target
    }

    private fun download(url: String, dest: File, ticket: Long) {
        for (attempt in 0..2) {
            checkActive(ticket)
            try {
                downloadAttempt(url, dest, ticket)
                return
            } catch (error: IOException) {
                checkActive(ticket)
                if (attempt == 2) throw error
                Thread.sleep(500)
            }
        }
    }

    private fun downloadAttempt(url: String, dest: File, ticket: Long) {
        val offset = if (dest.exists()) dest.length() else 0L
        val conn = URL(url).openConnection() as HttpURLConnection
        downloadConnection = conn
        try {
            checkActive(ticket)
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 30_000
            conn.readTimeout = 60_000
            if (offset > 0) conn.setRequestProperty("Range", "bytes=$offset-")
            val code = conn.responseCode
            if (code !in listOf(200, 206)) {
                throw IOException("下載模型失敗：HTTP $code")
            }
            val append = code == 206
            if (append && conn.getHeaderField("Content-Range")?.startsWith("bytes $offset-") != true) {
                throw IOException("模型續傳回應範圍不符")
            }
            conn.inputStream.use { input -> FileOutputStream(dest, append).use { out ->
                val buffer = ByteArray(1 shl 20)
                while (true) {
                    checkActive(ticket)
                    val size = input.read(buffer)
                    if (size < 0) break
                    out.write(buffer, 0, size)
                }
            } }
        } finally {
            downloadConnection = null
            conn.disconnect()
        }
    }

    private fun sha256(file: File, ticket: Long): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(1 shl 20)
            while (true) {
                checkActive(ticket)
                val n = input.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun freePort(): Int =
        ServerSocket(0, 0, InetAddress.getByName("127.0.0.1")).use { it.localPort }

    private fun newApiKey(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /** 在日誌檔寫入一行 App 端的資訊（例如實際採用的執行緒數與 KV 設定）。 */
    private fun appendLog(context: Context, line: String) {
        File(context.filesDir, LOG_FILE).apply { parentFile?.mkdirs() }.appendText(line + "\n")
    }

    /** 把子行程的輸出寫進日誌檔（背景執行緒）；行程結束後輸出串流會關閉，執行緒自然結束。 */
    private fun pumpOutputTo(child: Process, log: File) {
        Thread {
            try {
                child.inputStream.use { input ->
                    FileOutputStream(log, true).use { out -> input.copyTo(out) }
                }
            } catch (ignored: IOException) {
                // 行程結束或日誌無法寫入時忽略；錯誤訊息已透過 exitValue 回報
            }
        }.apply { isDaemon = true }.start()
    }

    private fun isAlive(child: Process): Boolean = try {
        child.exitValue()
        false
    } catch (ignored: IllegalThreadStateException) {
        true
    }

    private fun waitExit(child: Process, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (!isAlive(child)) return true
            Thread.sleep(100)
        }
        return !isAlive(child)
    }

    /**
     * 透過反射取得子行程 PID。java.lang.Process.pid() 自 API 33 起才存在，
     * 編譯期的 SDK 不一定公開此方法，所以用反射；取不到時回傳 null，
     * 只會失去孤兒行程清理，不影響正常的啟動與停止。
     */
    private fun pidOf(child: Process): Long? = try {
        child.javaClass.getMethod("pid").invoke(child) as? Long
    } catch (ignored: Throwable) {
        null
    }
}
