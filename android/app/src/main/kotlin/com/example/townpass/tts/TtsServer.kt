package com.example.townpass.tts

import android.content.Context
import android.system.Os
import android.system.OsConstants
import com.example.townpass.llm.CpuTopology
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference

/** 模型與網路位置固定，只開放調整 CPU 執行緒數。 */
data class TtsConfig(val threads: Int? = null) {
    fun isValid(): Boolean = threads == null || threads in 1..16
}

enum class TtsPhase { IDLE, STARTING, RUNNING, ERROR }

data class TtsStatus(
    val phase: TtsPhase,
    val baseUrl: String? = null,
    val apiKey: String? = null,
    val model: String? = null,
    val threads: Int? = null,
    val error: String? = null,
) {
    fun toMap(): Map<String, Any?> = buildMap {
        val running = phase == TtsPhase.RUNNING
        put("phase", phase.name.lowercase())
        put("running", running)
        put("baseUrl", if (running) baseUrl else null)
        put("model", if (running) model else null)
        put("threads", if (running) threads else null)
        put("error", error)
        if (running && apiKey != null) put("apiKey", apiKey)
    }
}

/**
 * 管理只在手機 loopback 提供服務的 BlueMagpie 子行程。
 * 模型必須事先安裝在排除系統備份的目錄；不下載模型、不保存金鑰或行程輸出。
 */
internal object TtsServer {
    private const val MODEL_ALIAS = "bluemagpie-q8_0"
    private const val HEALTH_TIMEOUT_MS = 180_000L
    private const val MAX_HEALTH_BYTES = 16 * 1024

    private data class ModelSpec(val name: String, val size: Long, val sha256: String)

    private val backbone = ModelSpec(
        "barbet-q8_0-tokenizer.gguf",
        1_166_805_312L,
        "d86a35697c570bb6d97134f342451ee05b1558440f6f8256938af65afffe0ec9",
    )
    private val codec = ModelSpec(
        "codec-q8_0-lmq8.gguf",
        1_089_524_000L,
        "7b96d4d9ddd1de0b7b646e4ad745844b6c104b5f1223107b82ada4e6622cd10c",
    )

    private data class State(val status: TtsStatus, val child: TtsChild? = null)
    private val state = AtomicReference(State(TtsStatus(TtsPhase.IDLE)))
    private val operations = TtsOperations()
    // 只由服務的永久 FIFO worker 讀寫；即使取消落在 spawn/發布之間，也不遺失 child。
    private var ownedChild: TtsChild? = null

    fun attach(): TtsOperations.Owner = operations.attach()

    /** 查詢只讀快照，不排隊、不等模型載入，也不暴露金鑰。 */
    fun status(): TtsStatus = liveState().status.copy(apiKey = null)

    fun start(
        context: Context,
        config: TtsConfig,
        owner: TtsOperations.Owner,
        reply: (TtsStatus, TtsOperations.Ticket?) -> Unit,
    ) {
        if (!config.isValid()) {
            reply(TtsStatus(TtsPhase.ERROR, error = "TTS_INVALID_CONFIG"), null)
            return
        }
        if (!operations.start(owner) { ticket -> reply(startBlocking(context, config, ticket), ticket) }) {
            reply(status(), null)
        }
    }

    /** 在主執行緒真正交付前再次檢查 owner、generation 與存活快照，撤銷排隊中的舊 key。 */
    fun startReply(owner: TtsOperations.Owner, ticket: TtsOperations.Ticket?, result: TtsStatus): TtsStatus {
        if (ticket == null) return result.copy(apiKey = null)
        if (!operations.canReply(owner, ticket)) return status()
        if (result.phase != TtsPhase.RUNNING) return result.copy(apiKey = null)
        val current = liveState().status
        return if (current.phase == TtsPhase.RUNNING && current.apiKey == result.apiKey) result else status()
    }

    fun stop(owner: TtsOperations.Owner, reply: (TtsStatus) -> Unit) {
        if (!operations.stop(owner, ::invalidate) { ticket -> reply(stopBlocking(ticket)) }) reply(status())
    }

    fun detach(owner: TtsOperations.Owner) {
        operations.detach(owner, ::invalidate) { ticket -> stopBlocking(ticket) }
    }

    // 在接受 stop 的短鎖內立刻撤銷 endpoint；清理完成前不假報 idle。
    private fun invalidate() {
        val previous = state.get()
        state.set(State(TtsStatus(TtsPhase.STARTING), previous.child))
    }

    private fun startBlocking(context: Context, config: TtsConfig, ticket: TtsOperations.Ticket): TtsStatus {
        if (!operations.isActive(ticket)) return status()
        val existing = liveState()
        if (existing.status.phase == TtsPhase.RUNNING) {
            return operations.publish(ticket) { liveState().status } ?: status()
        }
        try {
            if (!terminateOwned()) throw Failure("TTS_STOP_FAILED")
            publish(State(TtsStatus(TtsPhase.STARTING)), ticket)
            val nativeDir = checkedNativeDirectory(context)
            val modelDir = File(context.noBackupFilesDir, "tts/models")
            val backboneFile = checkedModel(modelDir, backbone, ticket)
            val codecFile = checkedModel(modelDir, codec, ticket)
            checkActive(ticket)
            val threads = config.threads ?: CpuTopology.bigCoreCount().coerceAtMost(4)
            val key = newApiKey()
            val builder = ProcessBuilder(
                File(nativeDir, "libtts_server.so").absolutePath,
                "--model", codecFile.absolutePath,
                "--backbone", backboneFile.absolutePath,
                "--n-threads", threads.toString(),
                "--parent-pid", android.os.Process.myPid().toString(),
            ).apply {
                environment()["TOWNPASS_TTS_API_KEY"] = key
                environment()["LD_LIBRARY_PATH"] = nativeDir.absolutePath
                // stdout 僅供私有啟動協定，stderr 獨立定長排空。
                redirectErrorStream(false)
            }
            checkActive(ticket)
            val child = TtsChild(builder.start(), android.os.Process.myPid()) { pid ->
                Os.kill(pid, OsConstants.SIGKILL)
            }
            ownedChild = child
            publish(State(TtsStatus(TtsPhase.STARTING), child), ticket)
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(HEALTH_TIMEOUT_MS)
            val port = waitStartup(child, ticket, deadline)
            // native 自行保留 bound socket 並載入模型後才回報 port；之前絕不送出 Bearer。
            waitHealthy(child, port, key, ticket, deadline)
            checkActive(ticket)
            if (!child.isAlive()) throw Failure("TTS_PROCESS_EXITED")
            val ready = TtsStatus(
                phase = TtsPhase.RUNNING,
                baseUrl = "http://127.0.0.1:$port/v1",
                apiKey = key,
                model = MODEL_ALIAS,
                threads = threads,
            )
            publish(State(ready, child), ticket)
            return ready
        } catch (error: Exception) {
            val terminated = terminateOwned()
            val cancelled = !operations.isActive(ticket) || error is CancellationException
            val failure = when {
                !terminated -> "TTS_STOP_FAILED"
                cancelled -> null
                error is Failure -> error.code
                else -> "TTS_START_FAILED"
            }
            val result = TtsStatus(
                phase = if (failure == null) TtsPhase.IDLE else TtsPhase.ERROR,
                error = failure,
            )
            // 舊操作只能清理自己排程以前的 child，不得發布到已取消的 generation。
            operations.publish(ticket) { state.set(State(result, ownedChild)) }
            return result
        }
    }

    private fun stopBlocking(ticket: TtsOperations.Ticket): TtsStatus {
        // 取消早已在接受時完成一次；FIFO 保證不會讀到排在這次 stop 後的新 child。
        val terminated = terminateOwned()
        val result = if (terminated) TtsStatus(TtsPhase.IDLE)
        else TtsStatus(TtsPhase.ERROR, error = "TTS_STOP_FAILED")
        operations.publish(ticket) { state.set(State(result, ownedChild)) }
        return result
    }

    private fun terminateOwned(): Boolean {
        val child = ownedChild ?: return true
        if (!child.terminate()) return false
        ownedChild = null
        return true
    }

    private fun publish(next: State, ticket: TtsOperations.Ticket) {
        operations.publish(ticket) { state.set(next) } ?: throw CancellationException()
    }

    private fun liveState(): State {
        while (true) {
            val current = state.get()
            if (current.status.phase != TtsPhase.RUNNING) return current
            if (current.child?.isAlive() == true) return current
            val exited = State(TtsStatus(TtsPhase.ERROR, error = "TTS_PROCESS_EXITED"))
            if (state.compareAndSet(current, exited)) return exited
        }
    }

    private fun checkActive(ticket: TtsOperations.Ticket) {
        if (!operations.isActive(ticket)) throw CancellationException()
    }

    private fun checkedNativeDirectory(context: Context): File {
        val path = context.applicationInfo.nativeLibraryDir ?: throw Failure("TTS_BINARY_MISSING")
        val directory = File(path)
        val names = listOf("libtts_server.so", "libttsbackbone.so", "libc++_shared.so")
        if (names.any { !File(directory, it).isFile }) throw Failure("TTS_BINARY_MISSING")
        if (!File(directory, names.first()).canExecute()) throw Failure("TTS_BINARY_NOT_EXECUTABLE")
        return directory
    }

    private fun checkedModel(directory: File, spec: ModelSpec, ticket: TtsOperations.Ticket): File {
        checkActive(ticket)
        val file = File(directory, spec.name)
        if (!file.isFile) throw Failure("TTS_MODEL_MISSING")
        if (file.length() != spec.size) throw Failure("TTS_MODEL_INVALID")
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            file.inputStream().use { input ->
                val magic = ByteArray(4)
                var count = 0
                while (count < magic.size) {
                    checkActive(ticket)
                    val read = input.read(magic, count, magic.size - count)
                    if (read < 0) throw Failure("TTS_MODEL_INVALID")
                    count += read
                }
                if (!magic.contentEquals(byteArrayOf(0x47, 0x47, 0x55, 0x46))) {
                    throw Failure("TTS_MODEL_INVALID")
                }
                digest.update(magic)
                val buffer = ByteArray(1024 * 1024)
                while (true) {
                    checkActive(ticket)
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
        } catch (ignored: IOException) {
            throw Failure("TTS_MODEL_UNREADABLE")
        }
        checkActive(ticket)
        if (file.length() != spec.size || hex(digest.digest()) != spec.sha256) {
            throw Failure("TTS_MODEL_INVALID")
        }
        return file
    }

    private fun newApiKey(): String = hex(ByteArray(32).also { SecureRandom().nextBytes(it) })

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    private fun waitStartup(child: TtsChild, ticket: TtsOperations.Ticket, deadline: Long): Int {
        while (System.nanoTime() < deadline) {
            checkActive(ticket)
            if (!child.isAlive()) throw Failure("TTS_PROCESS_EXITED")
            try {
                return child.startup.ready.get(100, TimeUnit.MILLISECONDS).port
            } catch (ignored: TimeoutException) {
                // reader 的阻塞不占住 lifecycle worker；每 100ms 檢查取消。
            } catch (ignored: ExecutionException) {
                throw Failure("TTS_STARTUP_INVALID")
            }
        }
        throw Failure("TTS_START_TIMEOUT")
    }

    private fun waitHealthy(child: TtsChild, port: Int, key: String, ticket: TtsOperations.Ticket, deadline: Long) {
        while (System.nanoTime() < deadline) {
            checkActive(ticket)
            if (!child.isAlive()) throw Failure("TTS_PROCESS_EXITED")
            if (isHealthy(port, key, ticket, deadline)) {
                checkActive(ticket)
                if (!child.isAlive()) throw Failure("TTS_PROCESS_EXITED")
                return
            }
            Thread.sleep(100)
        }
        throw Failure("TTS_START_TIMEOUT")
    }

    private fun isHealthy(port: Int, key: String, ticket: TtsOperations.Ticket, deadline: Long): Boolean {
        val connection = URL("http://127.0.0.1:$port/v1/models")
            .openConnection(Proxy.NO_PROXY) as HttpURLConnection
        try {
            connection.connectTimeout = 1_000
            connection.readTimeout = 1_000
            connection.instanceFollowRedirects = false
            connection.requestMethod = "GET"
            connection.setRequestProperty("Authorization", "Bearer $key")
            if (connection.responseCode != 200) throw Failure("TTS_READINESS_FAILED")
            val body = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(1024)
                while (true) {
                    checkActive(ticket)
                    if (System.nanoTime() >= deadline) throw Failure("TTS_START_TIMEOUT")
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (body.size() + read > MAX_HEALTH_BYTES) throw Failure("TTS_READINESS_FAILED")
                    body.write(buffer, 0, read)
                }
            }
            val id = try {
                JSONObject(body.toString("UTF-8")).optJSONArray("data")?.optJSONObject(0)?.optString("id")
            } catch (ignored: org.json.JSONException) {
                throw Failure("TTS_READINESS_FAILED")
            }
            if (id != MODEL_ALIAS) throw Failure("TTS_READINESS_FAILED")
            return true
        } catch (ignored: IOException) {
            return false
        } finally {
            connection.disconnect()
        }
    }

    private class Failure(val code: String) : Exception(code)
}
