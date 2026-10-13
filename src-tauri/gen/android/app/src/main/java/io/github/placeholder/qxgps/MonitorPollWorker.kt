package io.github.placeholder.qxgps

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Doze-friendly backup poll (minimum 15 minutes). Primary cadence is the
 * foreground service + Rust thread while monitoring is enabled.
 */
class MonitorPollWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val code = MonitorController.runNativePoll()
        return if (code == 0) Result.success() else Result.retry()
    }
}
