package com.example.townpass.tts

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** 不需 Android、模型或 JUnit；與正式 lifecycle helper 一起以 Kotlin/JVM 執行。 */
fun main(args: Array<String>) {
    stopThenStartIsFifo()
    destroyedActivityCannotCancelReplacement()
    delayedReplyIsRevoked()
    startupRecordsAreStrictAndBounded()
    forcedStopUsesOnlyLivePrivateIdentity()
    if (args.contains("--idle")) workerSurvivesIdle()
    println("TTS lifecycle helper tests passed")
}

private fun CountDownLatch.awaitChecked() {
    check(await(5, TimeUnit.SECONDS)) { "lifecycle task timed out" }
}

private fun stopThenStartIsFifo() {
    val operations = TtsOperations()
    val owner = operations.attach()
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val pendingTicket = AtomicReference<TtsOperations.Ticket>()
    val events = mutableListOf<String>()
    val failure = AtomicReference<Throwable?>()
    check(operations.start(owner) { ticket ->
        pendingTicket.set(ticket)
        entered.countDown()
        release.awaitChecked()
        try {
            check(!operations.isActive(ticket)) { "stop must cancel before the worker is released" }
            check(operations.publish(ticket) { events.add("stale-publication") } == null)
            events.add("cancelled-A")
        } catch (error: Throwable) { failure.set(error) }
    })
    entered.awaitChecked()
    var invalidated = 0
    check(operations.stop(owner, { invalidated++ }) { ticket ->
        try {
            check(operations.isActive(ticket))
            events.add("stop-A")
        } catch (error: Throwable) { failure.set(error) }
    })
    // stop 的取消在接受時發生，不等候 hash/loading 或背景清理。
    check(invalidated == 1)
    check(!operations.isActive(pendingTicket.get()))
    check(operations.start(owner) { ticket ->
        try {
            check(operations.isActive(ticket)) { "old stop cancelled the following start" }
            events.add("start-B")
        } catch (error: Throwable) { failure.set(error) }
        finished.countDown()
    })
    release.countDown()
    finished.awaitChecked()
    failure.get()?.let { throw it }
    check(events == listOf("cancelled-A", "stop-A", "start-B"))
    check(invalidated == 1)
}

private fun destroyedActivityCannotCancelReplacement() {
    val operations = TtsOperations()
    val old = operations.attach()
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val events = mutableListOf<String>()
    check(operations.start(old) { entered.countDown(); release.awaitChecked() })
    entered.awaitChecked()
    // 舊 onDestroy 已接受、但 cleanup 尚未執行；新 Activity 的 start 必須排在後面。
    check(operations.detach(old, {}) { events.add("old-cleanup") })
    val replacement = operations.attach()
    check(operations.start(replacement) { ticket ->
        if (operations.isActive(ticket)) events.add("new-child")
        finished.countDown()
    })
    // 延遲或重複的舊 onDestroy 不能再取消新 Activity。
    check(!operations.detach(old, { error("stale owner invalidated replacement") }) {
        error("stale cleanup terminated replacement")
    })
    check(!operations.start(old) { error("destroyed owner started a child") })
    release.countDown()
    finished.awaitChecked()
    check(events == listOf("old-cleanup", "new-child"))

    val latestTicket = AtomicReference<TtsOperations.Ticket>()
    val ready = CountDownLatch(1)
    check(operations.start(replacement) { latestTicket.set(it); ready.countDown() })
    ready.awaitChecked()
    val newest = operations.attach()
    check(!operations.detach(replacement, { error("old Activity cancelled newest") }) {})
    check(operations.isActive(latestTicket.get()))
    check(!operations.canReply(replacement, latestTicket.get()))
    check(operations.canReply(newest, latestTicket.get()))
}

private fun delayedReplyIsRevoked() {
    val operations = TtsOperations()
    val owner = operations.attach()
    val ticket = AtomicReference<TtsOperations.Ticket>()
    val ready = CountDownLatch(1)
    check(operations.start(owner) { ticket.set(it); ready.countDown() })
    ready.awaitChecked()
    check(operations.canReply(owner, ticket.get()))
    check(operations.stop(owner, {}) {})
    check(!operations.canReply(owner, ticket.get()))
}

private fun startupRecordsAreStrictAndBounded() {
    val valid = "TOWNPASS_TTS_V1 PID 4321\nTOWNPASS_TTS_V1 READY 4321 32123\n"
    val startup = TtsStartup(1234)
    startup.read(ByteArrayInputStream(valid.toByteArray(Charsets.US_ASCII)))
    check(startup.pid == 4321)
    check(startup.ready.get(1, TimeUnit.SECONDS).port == 32123)

    val invalid = listOf(
        "",
        "TOWNPASS_TTS_V1 PID 4321",
        "TOWNPASS_TTS_V1 PID 4321\n",
        "x".repeat(4096) + "\n",
        valid.replace("PID 4321", "PID 0"),
        valid.replace("PID 4321", "PID 1"),
        valid.replace("PID 4321", "PID 1234"),
        valid.replace("PID 4321", "PID 2147483648"),
        valid.replace("PID 4321", "PID 04321"),
        valid.replace("READY 4321", "READY 4322"),
        valid.replace("32123", "0"),
        valid.replace("32123", "65536"),
        valid.replace("32123", "-1"),
        valid.replace("32123", "032123"),
        valid.replace("32123", "2147483648"),
        valid.replace("\n", "\r\n"),
        valid.replace("READY", "RUNNING"),
        valid + "unexpected output\n",
    )
    for (record in invalid) {
        val rejected = TtsStartup(1234)
        rejected.read(ByteArrayInputStream(record.toByteArray(Charsets.US_ASCII)))
        check(rejected.ready.isCompletedExceptionally) { "malformed startup record accepted" }
    }
    var bytesRead = 0
    val endlessLine = object : java.io.InputStream() {
        override fun read(): Int { bytesRead++; return 'x'.code }
    }
    val bounded = TtsStartup(1234)
    bounded.read(endlessLine)
    check(bounded.ready.isCompletedExceptionally)
    check(bytesRead <= 65) { "startup reader consumed an unbounded record" }

    for (port in listOf(1, 65535)) {
        val boundary = TtsStartup(1234)
        boundary.read(ByteArrayInputStream(valid.replace("32123", "$port").toByteArray()))
        check(boundary.ready.get().port == port)
    }
}

private class UncooperativeProcess(record: String) : Process() {
    val stdout = ByteArrayInputStream(record.toByteArray())
    var alive = true
    var destroys = 0
    var waits = 0
    override fun getInputStream() = stdout
    override fun getErrorStream() = ByteArrayInputStream(byteArrayOf())
    override fun getOutputStream() = ByteArrayOutputStream()
    override fun destroy() { destroys++ } // 與 SIGSTOP child 相同：SIGTERM 不使它退出。
    override fun destroyForcibly(): Process = error("Android does not implement a real force kill here")
    override fun exitValue(): Int = if (alive) throw IllegalThreadStateException() else 0
    override fun waitFor(): Int = error("unbounded wait is forbidden")
    override fun waitFor(timeout: Long, unit: TimeUnit): Boolean {
        check(unit.toMillis(timeout) in 1..2000)
        waits++
        return !alive
    }
}

private fun forcedStopUsesOnlyLivePrivateIdentity() {
    val record = "TOWNPASS_TTS_V1 PID 4321\nTOWNPASS_TTS_V1 READY 4321 32123\n"
    val process = UncooperativeProcess(record)
    val signals = mutableListOf<Int>()
    val child = TtsChild(process, 1234) { pid -> signals.add(pid); process.alive = false }
    child.startup.ready.get(1, TimeUnit.SECONDS)
    check(child.terminate())
    check(process.destroys == 1 && process.waits == 2)
    check(signals == listOf(4321))
    check(child.terminate())
    check(signals.size == 1) // 已退出的 PID 絕不重用。

    val unknown = UncooperativeProcess("TOWNPASS_TTS_V1 PID 1\n")
    val noIdentity = TtsChild(unknown, 1234) { error("unknown PID was signalled") }
    runCatching { noIdentity.startup.ready.get(1, TimeUnit.SECONDS) }
    check(!noIdentity.terminate()) // 不能假報 idle。

    // READY 之前的載入失敗仍可依第一筆私有 identity 清理，無須公開 HTTP health。
    val loading = UncooperativeProcess("TOWNPASS_TTS_V1 PID 5678\n")
    var loadingPid: Int? = null
    val notReady = TtsChild(loading, 1234) { pid -> loadingPid = pid; loading.alive = false }
    notReady.startup.identity.get(1, TimeUnit.SECONDS)
    check(notReady.terminate())
    check(loadingPid == 5678)

    val stubborn = UncooperativeProcess(record)
    val cannotKill = TtsChild(stubborn, 1234) { throw SecurityException() }
    cannotKill.startup.ready.get(1, TimeUnit.SECONDS)
    check(!cannotKill.terminate())
}

private fun workerSurvivesIdle() {
    val operations = TtsOperations()
    val owner = operations.attach()
    val original = AtomicReference<Thread>()
    val first = CountDownLatch(1)
    check(operations.start(owner) { original.set(Thread.currentThread()); first.countDown() })
    first.awaitChecked()
    // 真的跨過 cached executor 的 60 秒回收點；不是僅比對 executor 型別。
    CountDownLatch(1).await(65, TimeUnit.SECONDS)
    check(original.get().isAlive) { "native child's creating thread died while idle" }
    val second = CountDownLatch(1)
    val reused = AtomicReference<Thread>()
    check(operations.start(owner) { reused.set(Thread.currentThread()); second.countDown() })
    second.awaitChecked()
    check(original.get() === reused.get()) { "child-owning worker was replaced" }
}
