package com.example.townpass.tts

import java.io.IOException
import java.io.InputStream
import java.util.concurrent.CompletableFuture

/** 私有 stdout 只接受兩行 ASCII record 與 EOF；任何污染、截斷或超長都 fail closed。 */
internal class TtsStartup(private val parentPid: Int) {
    data class Ready(val pid: Int, val port: Int)

    val identity = CompletableFuture<Int>()
    val ready = CompletableFuture<Ready>()
    @Volatile var pid: Int? = null
        private set

    fun read(input: InputStream) {
        try {
            val identityMatch = Regex("TOWNPASS_TTS_V1 PID ([1-9][0-9]{0,9})").matchEntire(line(input))
                ?: throw invalid()
            val processId = identityMatch.groupValues[1].toIntOrNull() ?: throw invalid()
            if (processId <= 1 || processId == parentPid) throw invalid()
            pid = processId
            identity.complete(processId)

            val readyMatch = Regex("TOWNPASS_TTS_V1 READY ([1-9][0-9]{0,9}) ([1-9][0-9]{0,4})")
                .matchEntire(line(input)) ?: throw invalid()
            val readyPid = readyMatch.groupValues[1].toIntOrNull() ?: throw invalid()
            val port = readyMatch.groupValues[2].toIntOrNull() ?: throw invalid()
            if (readyPid != processId || port !in 1..65535 || input.read() != -1) throw invalid()
            ready.complete(Ready(processId, port))
        } catch (ignored: Exception) {
            // 不保留或輸出來自行程的文字，錯誤訊息也不帶 payload。
            identity.completeExceptionally(invalid())
            ready.completeExceptionally(invalid())
        }
    }

    private fun line(input: InputStream): String {
        val bytes = ByteArray(64)
        var size = 0
        while (true) {
            val next = input.read()
            if (next == '\n'.code) return String(bytes, 0, size, Charsets.US_ASCII)
            if (next !in 32..126 || size == bytes.size) throw invalid()
            bytes[size++] = next.toByte()
        }
    }

    private fun invalid() = IOException("TTS_STARTUP_INVALID")
}
