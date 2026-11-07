package com.example.townpass.asr

import android.net.LocalSocket
import android.net.LocalSocketAddress
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * 對外的 OpenAI 相容 HTTP 入口：只綁 127.0.0.1，並以 Bearer API key 保護。
 *
 * whisper-server 沒有 API key，所以它只綁 unix domain socket（路徑在 App 私有目錄，其他 App 連不到）。
 * 本代理是唯一的 TCP 入口，只轉發下列路由，其餘一律 404，因此 whisper-server 的網頁介面不會對外暴露：
 * - GET  /v1/models
 * - POST /v1/audio/transcriptions（multipart/form-data，欄位與 OpenAI 相同）
 *
 * 每個請求處理完即以 `Connection: close` 關閉，不做 keep-alive，實作較單純。
 */
internal class AsrProxy(
    private val upstreamSocketPath: String,
    private val apiKey: String,
    private val modelId: String,
) : Closeable {
    private val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
    // 除了執行中的 worker，最多只保留固定數量的待處理連線。
    private val workers = ThreadPoolExecutor(
        WORKERS,
        WORKERS,
        0L,
        TimeUnit.MILLISECONDS,
        ArrayBlockingQueue<Runnable>(MAX_QUEUED_CLIENTS),
        { r -> Thread(r, "asr-proxy-worker").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    )
    private val acceptor = Thread({ acceptLoop() }, "asr-proxy-accept").apply { isDaemon = true }

    // 接收、上游連線與停止共用此鎖；clients 包含執行中與排隊中的連線。
    private val lifecycleLock = Any()
    private val clients = mutableSetOf<Socket>()
    private var closed = false
    private var upstreamSocket: LocalSocket? = null

    // whisper-server 一次只處理一個推論，串行轉發可避免多個請求同時佔住上游。
    private val upstreamLock = Any()

    /** 實際監聽的 port（由系統指定）。 */
    val port: Int = server.localPort

    val isRunning: Boolean
        get() = synchronized(lifecycleLock) { !closed && !server.isClosed }

    init {
        acceptor.start()
    }

    override fun close() {
        synchronized(lifecycleLock) {
            if (closed) return
            closed = true
            runCatching { server.close() }
            workers.shutdownNow()
            clients.forEach { client -> runCatching { client.close() } }
            clients.clear()
            runCatching { upstreamSocket?.close() }
            upstreamSocket = null
        }
    }

    private fun acceptLoop() {
        try {
            while (isRunning) {
                val client = server.accept()
                synchronized(lifecycleLock) {
                    if (closed) {
                        runCatching { client.close() }
                    } else {
                        clients.add(client)
                        try {
                            workers.execute { serve(client) }
                        } catch (ignored: RejectedExecutionException) {
                            clients.remove(client)
                            runCatching { client.close() }
                        }
                    }
                }
            }
        } catch (ignored: IOException) {
            // 停止或接收失敗時，都必須釋放監聽入口與既有連線。
        } finally {
            close()
        }
    }

    private fun serve(client: Socket) {
        try {
            client.use { sock ->
                sock.soTimeout = CLIENT_TIMEOUT_MS
                val input = sock.getInputStream().buffered()
                val out = sock.getOutputStream()
                try {
                    val head = readHead(input) ?: return
                    handle(parseRequest(head), input, out)
                } catch (e: HttpError) {
                    writeJson(out, e.status, e.reason, errorJson(e.message.orEmpty(), e.type), e.extraHeaders)
                }
            }
        } catch (ignored: IOException) {
            // 客戶端中途斷線、逾時或服務已停止，沒有可回覆的對象。
        } finally {
            synchronized(lifecycleLock) { clients.remove(client) }
        }
    }

    private fun handle(req: Request, input: InputStream, out: OutputStream) {
        // 預檢請求（瀏覽器跨來源呼叫時會先送出）不帶憑證，所以不驗證。
        if (req.method == "OPTIONS") {
            writeRaw(out, 204, "No Content", emptyMap(), ByteArray(0))
            return
        }
        when (req.path) {
            MODELS_PATH -> {
                requireMethod(req, "GET")
                requireAuth(req)
                writeJson(out, 200, "OK", modelsJson())
            }
            TRANSCRIPTION_PATH -> {
                requireMethod(req, "POST")
                requireAuth(req)
                val body = readBody(req, input, out)
                writeUpstream(out, transcribe(req, body))
            }
            else -> throw HttpError(404, "Not Found", "找不到路由：${req.path}", "invalid_request_error")
        }
    }

    private fun requireMethod(req: Request, expected: String) {
        if (req.method != expected) {
            throw HttpError(
                405,
                "Method Not Allowed",
                "${req.path} 只接受 $expected",
                "invalid_request_error",
                mapOf("Allow" to expected),
            )
        }
    }

    private fun requireAuth(req: Request) {
        val given = req.headers["authorization"].orEmpty().toByteArray(Charsets.UTF_8)
        val expected = "Bearer $apiKey".toByteArray(Charsets.UTF_8)
        if (!MessageDigest.isEqual(given, expected)) {
            throw HttpError(
                401,
                "Unauthorized",
                "API key 無效或缺少 Authorization: Bearer 標頭",
                "invalid_request_error",
                mapOf("WWW-Authenticate" to "Bearer"),
            )
        }
    }

    /** 讀取請求本文。要求 Content-Length（不支援 chunked 上傳）；通過大小檢查後才回覆 100 Continue。 */
    private fun readBody(req: Request, input: InputStream, out: OutputStream): ByteArray {
        if (req.headers.containsKey("transfer-encoding")) {
            throw HttpError(411, "Length Required", "不支援 chunked 上傳，請附上 Content-Length", "invalid_request_error")
        }
        val length = req.headers["content-length"]?.toIntOrNull()
            ?: throw HttpError(411, "Length Required", "缺少 Content-Length", "invalid_request_error")
        if (length <= 0) {
            throw HttpError(400, "Bad Request", "請求本文是空的", "invalid_request_error")
        }
        if (length > MAX_UPLOAD_BYTES) {
            throw HttpError(
                413,
                "Payload Too Large",
                "音檔超過 ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB 上限",
                "invalid_request_error",
            )
        }
        if (req.headers["expect"].equals("100-continue", ignoreCase = true)) {
            out.write("HTTP/1.1 100 Continue\r\n\r\n".toByteArray(Charsets.US_ASCII))
            out.flush()
        }
        return ByteArray(length).also { input.readFully(it) }
    }

    private fun transcribe(req: Request, body: ByteArray): UpstreamResponse {
        val contentType = req.headers["content-type"]
            ?.takeIf { it.startsWith("multipart/form-data", ignoreCase = true) }
            ?: throw HttpError(400, "Bad Request", "需要 Content-Type: multipart/form-data", "invalid_request_error")
        val boundary = boundaryOf(contentType)
            ?: throw HttpError(400, "Bad Request", "multipart/form-data 缺少 boundary", "invalid_request_error")
        // whisper.cpp 遇到不在模型語言清單內的代碼（例如 yue）不會報錯，而是默默轉成其他 token，所以在這裡擋下。
        val language = multipartTextField(body, boundary, "language")?.trim()?.takeIf { it.isNotEmpty() } ?: "auto"
        if (language !in SUPPORTED_LANGUAGES) {
            throw HttpError(
                400,
                "Bad Request",
                "不支援的語言代碼：$language（請用小寫的 Whisper 語言代碼，或 auto）",
                "invalid_request_error",
            )
        }
        return synchronized(upstreamLock) { postUpstream(TRANSCRIPTION_PATH, contentType, body) }
    }

    /** 從 Content-Type 取出 multipart 的 boundary。 */
    private fun boundaryOf(contentType: String): String? = contentType
        .split(';')
        .map { it.trim() }
        .firstOrNull { it.startsWith("boundary=", ignoreCase = true) }
        ?.substringAfter('=')
        ?.trim('"')
        ?.takeIf { it.isNotEmpty() }

    /**
     * 取出 multipart 本文中指定名稱的文字欄位（不含檔案欄位）；找不到時回傳 null。
     * 以位元組掃描 boundary，不把音檔整個解碼成字串，所以二進位內容不會干擾解析。
     */
    private fun multipartTextField(body: ByteArray, boundary: String, name: String): String? {
        val delimiter = "--$boundary".toByteArray(Charsets.ISO_8859_1)
        val nameMarker = "name=\"$name\""
        var partStart = indexOf(body, delimiter, 0)
        while (partStart >= 0) {
            val headStart = partStart + delimiter.size
            val nextDelimiter = indexOf(body, delimiter, headStart)
            val partEnd = if (nextDelimiter < 0) body.size else nextDelimiter
            val headEnd = indexOf(body, CRLF_CRLF, headStart)
            if (headEnd in headStart until partEnd) {
                val header = String(body, headStart, headEnd - headStart, Charsets.ISO_8859_1)
                if (header.contains(nameMarker) && !header.contains("filename=")) {
                    val valueStart = headEnd + CRLF_CRLF.size
                    // 欄位內容之後緊接著 CRLF，才是下一個 boundary。
                    var valueEnd = partEnd
                    if (valueEnd - valueStart >= CRLF.size &&
                        body[valueEnd - 2] == CRLF[0] && body[valueEnd - 1] == CRLF[1]
                    ) {
                        valueEnd -= CRLF.size
                    }
                    return String(body, valueStart, valueEnd - valueStart, Charsets.UTF_8)
                }
            }
            partStart = nextDelimiter
        }
        return null
    }

    /** 經 unix socket 把請求轉給 whisper-server，讀到連線關閉為止（請求帶 Connection: close）。 */
    private fun postUpstream(path: String, contentType: String, body: ByteArray): UpstreamResponse {
        val socket = LocalSocket()
        try {
            synchronized(lifecycleLock) {
                // 與停止流程互斥，避免等候中的舊請求連到重啟後的同路徑服務。
                if (closed) throw IOException("語音服務已停止")
                socket.connect(LocalSocketAddress(upstreamSocketPath, LocalSocketAddress.Namespace.FILESYSTEM))
                upstreamSocket = socket
            }
            socket.soTimeout = UPSTREAM_TIMEOUT_MS
            val head = "POST $path HTTP/1.1\r\n" +
                "Host: localhost\r\n" +
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Connection: close\r\n\r\n"
            socket.outputStream.apply {
                write(head.toByteArray(Charsets.US_ASCII))
                write(body)
                flush()
            }
            return parseUpstream(socket.inputStream.readBytes())
        } catch (e: IOException) {
            throw HttpError(502, "Bad Gateway", "語音服務無法回應：${e.message}", "server_error")
        } finally {
            synchronized(lifecycleLock) {
                runCatching { socket.close() }
                if (upstreamSocket === socket) upstreamSocket = null
            }
        }
    }

    private fun writeUpstream(out: OutputStream, resp: UpstreamResponse) {
        writeRaw(
            out,
            resp.status,
            resp.reason,
            mapOf("Content-Type" to (resp.contentType ?: "application/json")),
            resp.body,
        )
    }

    private fun modelsJson(): String = JSONObject()
        .put("object", "list")
        .put(
            "data",
            JSONArray().put(
                JSONObject()
                    .put("id", modelId)
                    .put("object", "model")
                    .put("owned_by", "local"),
            ),
        )
        .toString()

    private fun errorJson(message: String, type: String): String = JSONObject()
        .put(
            "error",
            JSONObject()
                .put("message", message)
                .put("type", type)
                .put("param", JSONObject.NULL)
                .put("code", JSONObject.NULL),
        )
        .toString()

    /** 讀到標頭結束（CRLFCRLF）為止；連線一開始就關閉時回傳 null。 */
    private fun readHead(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        var tail = 0 // 最近 4 個位元組，用來偵測 CRLFCRLF
        while (true) {
            val b = input.read()
            if (b < 0) {
                if (buf.size() == 0) return null
                throw HttpError(400, "Bad Request", "請求標頭不完整", "invalid_request_error")
            }
            buf.write(b)
            if (buf.size() > MAX_HEAD_BYTES) {
                throw HttpError(431, "Request Header Fields Too Large", "請求標頭過大", "invalid_request_error")
            }
            tail = (tail shl 8) or b
            if (tail == CRLF_CRLF_INT) return String(buf.toByteArray(), Charsets.ISO_8859_1)
        }
    }

    private fun parseRequest(head: String): Request {
        val lines = head.removeSuffix("\r\n\r\n").split("\r\n")
        val parts = lines[0].split(' ')
        if (parts.size != 3 || !parts[2].startsWith("HTTP/1.")) {
            throw HttpError(400, "Bad Request", "請求列格式錯誤", "invalid_request_error")
        }
        return Request(
            method = parts[0],
            path = parts[1].substringBefore('?'),
            headers = parseHeaders(lines.drop(1)),
        )
    }

    private fun parseUpstream(raw: ByteArray): UpstreamResponse {
        val headEnd = indexOf(raw, CRLF_CRLF, 0)
        if (headEnd < 0) throw IOException("上游回應缺少標頭")
        val lines = String(raw, 0, headEnd, Charsets.ISO_8859_1).split("\r\n")
        val statusParts = lines[0].split(' ', limit = 3)
        val status = statusParts.getOrNull(1)?.toIntOrNull() ?: throw IOException("上游狀態列無法解析")
        val headers = parseHeaders(lines.drop(1))
        val rawBody = raw.copyOfRange(headEnd + CRLF_CRLF.size, raw.size)
        val chunked = headers["transfer-encoding"]?.contains("chunked", ignoreCase = true) == true
        return UpstreamResponse(
            status = status,
            reason = statusParts.getOrElse(2) { "" },
            contentType = headers["content-type"],
            body = if (chunked) dechunk(rawBody) else rawBody,
        )
    }

    private fun parseHeaders(lines: List<String>): Map<String, String> {
        val headers = HashMap<String, String>()
        for (line in lines) {
            val colon = line.indexOf(':')
            if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
        }
        return headers
    }

    /** 解碼 chunked 傳輸編碼。whisper-server 目前以 Content-Length 回應，這裡只是防禦性處理。 */
    private fun dechunk(data: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var pos = 0
        while (true) {
            val lineEnd = indexOf(data, CRLF, pos)
            if (lineEnd < 0) throw IOException("chunked 格式錯誤")
            val size = String(data, pos, lineEnd - pos, Charsets.US_ASCII)
                .substringBefore(';')
                .trim()
                .toIntOrNull(16) ?: throw IOException("chunked 格式錯誤")
            pos = lineEnd + CRLF.size
            if (size == 0) return out.toByteArray()
            if (pos + size > data.size) throw IOException("chunked 格式錯誤")
            out.write(data, pos, size)
            pos += size + CRLF.size
        }
    }

    private fun writeJson(
        out: OutputStream,
        status: Int,
        reason: String,
        json: String,
        extra: Map<String, String> = emptyMap(),
    ) {
        writeRaw(
            out,
            status,
            reason,
            mapOf("Content-Type" to "application/json; charset=utf-8") + extra,
            json.toByteArray(Charsets.UTF_8),
        )
    }

    private fun writeRaw(
        out: OutputStream,
        status: Int,
        reason: String,
        headers: Map<String, String>,
        body: ByteArray,
    ) {
        val head = StringBuilder("HTTP/1.1 $status $reason\r\n")
        for ((name, value) in CORS_HEADERS + headers) {
            head.append(name).append(": ").append(value).append("\r\n")
        }
        // 204 不可帶 Content-Length（RFC 7230）。
        if (status != 204) head.append("Content-Length: ").append(body.size).append("\r\n")
        head.append("Connection: close\r\n\r\n")
        out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        out.write(body)
        out.flush()
    }

    private class Request(val method: String, val path: String, val headers: Map<String, String>)

    private class UpstreamResponse(
        val status: Int,
        val reason: String,
        val contentType: String?,
        val body: ByteArray,
    )

    private class HttpError(
        val status: Int,
        val reason: String,
        message: String,
        val type: String,
        val extraHeaders: Map<String, String> = emptyMap(),
    ) : Exception(message)

    companion object {
        /** 對外路徑（OpenAI 格式）。whisper-server 的 --inference-path 也設為 [TRANSCRIPTION_PATH]。 */
        const val MODELS_PATH = "/v1/models"
        const val TRANSCRIPTION_PATH = "/v1/audio/transcriptions"

        private const val WORKERS = 4
        private const val MAX_QUEUED_CLIENTS = 4
        private const val CLIENT_TIMEOUT_MS = 30_000
        private const val UPSTREAM_TIMEOUT_MS = 600_000
        private const val MAX_HEAD_BYTES = 16 * 1024

        /** OpenAI 音訊 API 的上限是 25 MB。 */
        private const val MAX_UPLOAD_BYTES = 25 * 1024 * 1024
        private const val CRLF_CRLF_INT = 0x0D0A0D0A
        private val CRLF = byteArrayOf(0x0D, 0x0A)
        private val CRLF_CRLF = byteArrayOf(0x0D, 0x0A, 0x0D, 0x0A)

        private val CORS_HEADERS = linkedMapOf(
            "Access-Control-Allow-Origin" to "*",
            "Access-Control-Allow-Headers" to "Authorization, Content-Type",
            "Access-Control-Allow-Methods" to "GET, POST, OPTIONS",
            "Access-Control-Max-Age" to "600",
        )

        /**
         * Whisper 的 99 種語言代碼（與 whisper.cpp 語言表 id 0–98 相同，即本模型 lang token 50259–50357），加上 auto。
         * 不含 yue：whisper.cpp 的表有它，但 large-v2 的詞彙沒有對應 token。
         */
        private val SUPPORTED_LANGUAGES: Set<String> = setOf(
            "auto",
            "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi",
            "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te",
            "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa",
            "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt",
            "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su",
        )
    }
}

private fun indexOf(haystack: ByteArray, needle: ByteArray, from: Int): Int {
    val last = haystack.size - needle.size
    var i = from
    while (i <= last) {
        var j = 0
        while (j < needle.size && haystack[i + j] == needle[j]) j++
        if (j == needle.size) return i
        i++
    }
    return -1
}

private fun InputStream.readFully(buf: ByteArray) {
    var off = 0
    while (off < buf.size) {
        val n = read(buf, off, buf.size - off)
        if (n < 0) throw IOException("連線提早結束")
        off += n
    }
}
