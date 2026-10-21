package com.gestorfinanciero.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(entities = [PendingTransactionEntity::class], version = 1, exportSchema = true)
@TypeConverters(RoomConverters::class)
abstract class FinanceDatabase : RoomDatabase() {
    abstract fun pendingTransactions(): PendingTransactionDao

    companion object {
        fun create(context: Context): FinanceDatabase = Room.databaseBuilder(
            context.applicationContext, FinanceDatabase::class.java, "finance.db",
        ).build()
    }
}
