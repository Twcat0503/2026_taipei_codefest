package com.example.townpass.speech

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * 以 Android 系統的語音辨識（SpeechRecognizer）把一句話轉成文字，給安心助手的語音輸入用。
 *
 * 一次只辨識一句：start 開始收音，說完或呼叫 stop 後回傳最終文字。過程中的事件以 [emit]
 * 送出，格式為 `{type, text?, error?}`：
 * - `listening`：麥克風已開始收音
 * - `partial`：辨識中的文字（會被後面的事件取代）
 * - `final`：最終文字，這一次辨識結束
 * - `error`：`permission`（沒有麥克風權限）、`unavailable`（裝置沒有辨識服務）、
 *   `no_speech`（沒聽到話）、`busy` 或 `error`；這一次辨識結束
 *
 * 所有方法都要在主執行緒呼叫（SpeechRecognizer 的限制）。
 */
class SpeechInput(
    private val activity: Activity,
    private val emit: (Map<String, Any?>) -> Unit,
) {
    private var recognizer: SpeechRecognizer? = null
    private var pendingLanguage: String? = null

    fun start(language: String) {
        cancel()
        val granted = activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) {
            listen(language)
            return
        }
        pendingLanguage = language
        activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), PERMISSION_REQUEST_CODE)
    }

    /** 由 Activity 的 onRequestPermissionsResult 轉進來；回傳是否為這個類別發出的請求。 */
    fun onPermissionResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != PERMISSION_REQUEST_CODE) return false
        val language = pendingLanguage ?: return true
        pendingLanguage = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            listen(language)
        } else {
            emit(mapOf("type" to "error", "error" to "permission"))
        }
        return true
    }

    /** 說完了：停止收音，等最終文字。 */
    fun stop() {
        recognizer?.stopListening()
    }

    /** 放棄這一次辨識，不再送出任何事件。 */
    fun cancel() {
        pendingLanguage = null
        recognizer?.let {
            it.setRecognitionListener(null)
            it.cancel()
            it.destroy()
        }
        recognizer = null
    }

    private fun listen(language: String) {
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            emit(mapOf("type" to "error", "error" to "unavailable"))
            return
        }
        val current = SpeechRecognizer.createSpeechRecognizer(activity)
        recognizer = current
        current.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                emit(mapOf("type" to "listening"))
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val text = firstResult(partialResults) ?: return
                emit(mapOf("type" to "partial", "text" to text))
            }

            override fun onResults(results: Bundle?) {
                finish()
                val text = firstResult(results)
                if (text.isNullOrBlank()) {
                    emit(mapOf("type" to "error", "error" to "no_speech"))
                } else {
                    emit(mapOf("type" to "final", "text" to text))
                }
            }

            override fun onError(error: Int) {
                finish()
                emit(mapOf("type" to "error", "error" to errorName(error)))
            }

            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}

            private fun finish() {
                if (recognizer === current) recognizer = null
                current.destroy()
            }
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            // Give the speaker time to think between phrases before ending recognition.
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
        }
        current.startListening(intent)
    }

    private fun firstResult(bundle: Bundle?): String? =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

    private fun errorName(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no_speech"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "unavailable"
        else -> "error"
    }

    companion object {
        const val PERMISSION_REQUEST_CODE = 7301
    }
}
