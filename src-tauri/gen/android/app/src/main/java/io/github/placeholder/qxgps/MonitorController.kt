package io.github.placeholder.qxgps

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object MonitorController {
    private const val WORK_NAME = "qxgps_monitor_backup"

    fun apply(context: Context, enabled: Boolean, intervalSec: Long) {
        if (enabled) {
            val intent = Intent(context, BackgroundMonitorService::class.java).apply {
                putExtra(BackgroundMonitorService.EXTRA_INTERVAL_SEC, intervalSec)
            }
            ContextCompat.startForegroundService(context, intent)
            scheduleBackupWork(context, intervalSec)
        } else {
            context.stopService(Intent(context, BackgroundMonitorService::class.java))
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }

    private fun scheduleBackupWork(context: Context, intervalSec: Long) {
        val minutes = intervalSec.coerceAtLeast(900).coerceAtMost(3600) / 60
        val request = PeriodicWorkRequestBuilder<MonitorPollWorker>(minutes, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    fun requestPostNotifications(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val activity = context as? android.app.Activity
        if (activity != null) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                41001,
            )
        }
    }

    fun openBatteryOptimizationSettings(context: Context) {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    fun runNativePoll(): Int {
        return try {
            QxgpsMonitorNative.pollOnce()
        } catch (_: UnsatisfiedLinkError) {
            -1
        }
    }
}

object QxgpsMonitorNative {
    init {
        System.loadLibrary("qxgps_pwa_lib")
    }

    external fun pollOnce(): Int
}
