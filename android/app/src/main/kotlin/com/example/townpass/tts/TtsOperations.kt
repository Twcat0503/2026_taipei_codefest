package com.example.townpass.tts

import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * 接受操作、取消 generation 與排入 FIFO 必須共用同一個短鎖。
 * executor 屬於服務而非 Activity；建立 native child 的執行緒不可因閒置而回收，
 * 否則 Linux PR_SET_PDEATHSIG 會在該執行緒退出時殺掉仍在服務的 child。
 */
internal class TtsOperations {
    class Owner internal constructor()
    class Ticket internal constructor(val generation: Long)

    private val gate = Any()
    private val generation = AtomicLong(0)
    private var owner: Owner? = null
    private val worker = Executors.newSingleThreadExecutor { task ->
        Thread(task, "tts-lifecycle").apply { isDaemon = true }
    }

    fun attach(): Owner = synchronized(gate) { Owner().also { owner = it } }

    fun start(requester: Owner, action: (Ticket) -> Unit): Boolean = synchronized(gate) {
        if (owner !== requester) return@synchronized false
        val ticket = Ticket(generation.get())
        worker.execute { action(ticket) }
        true
    }

    fun stop(requester: Owner, invalidate: () -> Unit, action: (Ticket) -> Unit): Boolean =
        synchronized(gate) { enqueueStop(requester, invalidate, action) }

    fun detach(requester: Owner, invalidate: () -> Unit, action: (Ticket) -> Unit): Boolean =
        synchronized(gate) {
            if (!enqueueStop(requester, invalidate, action)) return@synchronized false
            owner = null
            true
        }

    // 僅在 gate 內呼叫；取消僅在接受操作時發生一次，背景 cleanup 不再次取消。
    private fun enqueueStop(requester: Owner, invalidate: () -> Unit, action: (Ticket) -> Unit): Boolean {
        if (owner !== requester) return false
        val ticket = Ticket(generation.incrementAndGet())
        invalidate()
        worker.execute { action(ticket) }
        return true
    }

    fun isActive(ticket: Ticket): Boolean = generation.get() == ticket.generation

    fun canReply(requester: Owner, ticket: Ticket): Boolean = synchronized(gate) {
        owner === requester && isActive(ticket)
    }

    /** action 只能發布記憶體快照，不可在鎖內執行 I/O 或等待行程。 */
    fun <T : Any> publish(ticket: Ticket, action: () -> T): T? = synchronized(gate) {
        if (isActive(ticket)) action() else null
    }
}
