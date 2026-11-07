package com.example.townpass.localserver

import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom

/** 串流計算檔案的 SHA-256（小寫十六進位），以 1 MB 緩衝讀取，不會整個載入記憶體。 */
internal fun sha256Of(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buf = ByteArray(1 shl 20)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            md.update(buf, 0, n)
        }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
}

/** 產生 32 位元組的隨機 API key（64 個十六進位字元）。 */
internal fun newApiKey(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
}
