package com.example.townpass.localserver

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

// ASR 子行程工具；保留獨立模組，避免改動既有 LLM 的生命週期實作。

internal fun isAlive(child: Process): Boolean = try {
    child.exitValue()
    false
} catch (ignored: IllegalThreadStateException) {
    true
}

internal fun waitExit(child: Process, timeoutMs: Long): Boolean {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
        if (!isAlive(child)) return true
        Thread.sleep(100)
    }
    return !isAlive(child)
}

/** 把子行程的輸出寫進日誌檔（背景執行緒）；行程結束後輸出串流會關閉，執行緒自然結束。 */
internal fun pumpOutputTo(child: Process, log: File) {
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

/**
 * 透過反射取得子行程 PID。java.lang.Process.pid() 自 API 33 起才存在，
 * 編譯期的 SDK 不一定公開此方法，所以用反射；取不到時回傳 null，
 * 只會失去孤兒行程清理，不影響正常的啟動與停止。
 */
internal fun pidOf(child: Process): Long? = try {
    child.javaClass.getMethod("pid").invoke(child) as? Long
} catch (ignored: Throwable) {
    null
}

/** 依 PID 檔強制結束上次留下的子行程，並刪除 PID 檔。非本 App 的 PID 會因權限不足而失敗，屬預期。 */
internal fun killByPidFile(pidFile: File) {
    if (!pidFile.exists()) return
    runCatching { pidFile.readText().trim().toInt() }.getOrNull()?.let { pid ->
        runCatching { Os.kill(pid, OsConstants.SIGKILL) }
    }
    pidFile.delete()
}
