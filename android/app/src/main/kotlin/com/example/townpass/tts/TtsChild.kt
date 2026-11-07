package com.example.townpass.tts

import java.io.IOException
import java.util.concurrent.TimeUnit

/** PID 僅來自這個 Process 的私有 pipe，與 Process 一起持有，絕不持久化或搜尋其他行程。 */
internal class TtsChild(
    private val process: Process,
    parentPid: Int,
    private val kill: (Int) -> Unit,
) {
    val startup = TtsStartup(parentPid)

    init {
        Thread({
            runCatching { process.inputStream.use { startup.read(it) } }
        }, "tts-startup-pipe").apply { isDaemon = true }.start()
        Thread({
            try {
                process.errorStream.use { input ->
                    val buffer = ByteArray(8192)
                    while (input.read(buffer) >= 0) { /* 定長排空，不保存或輸出內容。 */ }
                }
            } catch (ignored: IOException) {
                // 行程退出或停止時管線會關閉。
            }
        }, "tts-stderr-drain").apply { isDaemon = true }.start()
        runCatching { process.outputStream.close() }
    }

    fun isAlive(): Boolean = try {
        process.exitValue()
        false
    } catch (ignored: IllegalThreadStateException) {
        true
    }

    /**
     * Android 的 UNIXProcess.destroyForcibly() 不保證 SIGKILL，不能當作 fallback。
     * kill 由 Android 層實作 Os.kill(pid, SIGKILL)，且只對仍存活的當次 child 呼叫。
     * 未能取得可信 PID 或訊號遭拒時回 false，呼叫端必須保留 child 並回報失敗。
     */
    fun terminate(): Boolean {
        var interrupted = false
        try {
            if (!isAlive()) return true
            // Android destroy 也會關閉 stdout；先給啟動 reader 有界時間取得 PID。
            if (startup.pid == null) {
                try {
                    startup.identity.get(EXIT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                } catch (ignored: InterruptedException) {
                    interrupted = true
                } catch (ignored: Exception) {
                    // 沒有可信 identity 時只能嘗試正常終止，不猜測 PID。
                }
            }
            if (!isAlive()) return true
            runCatching { process.destroy() }
            val exited = try {
                process.waitFor(EXIT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            } catch (ignored: InterruptedException) {
                interrupted = true
                false
            }
            if (!exited && isAlive()) {
                val pid = startup.pid
                if (pid != null && isAlive()) kill(pid)
                try {
                    process.waitFor(EXIT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                } catch (ignored: InterruptedException) {
                    interrupted = true
                }
            }
            return !isAlive()
        } catch (ignored: Exception) {
            return !isAlive()
        } finally {
            if (interrupted) Thread.currentThread().interrupt()
        }
    }

    private companion object {
        const val EXIT_TIMEOUT_MS = 2_000L
    }
}
