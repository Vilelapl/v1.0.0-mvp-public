package com.gestorfinanciero.data.local

import androidx.room.TypeConverter
import com.gestorfinanciero.domain.NotificationSource
import com.gestorfinanciero.domain.TransactionType

class RoomConverters {
    @TypeConverter fun statusToString(value: SyncStatus): String = value.value
    @TypeConverter fun stringToStatus(value: String): SyncStatus = SyncStatus.entries.first { it.value == value }
    @TypeConverter fun typeToString(value: TransactionType): String = value.value
    @TypeConverter fun stringToType(value: String): TransactionType = TransactionType.entries.first { it.value == value }
    @TypeConverter fun sourceToString(value: NotificationSource): String = value.value
    @TypeConverter fun stringToSource(value: String): NotificationSource = NotificationSource.entries.first { it.value == value }
    @TypeConverter fun errorToString(value: LocalErrorCode?): String? = value?.name
    @TypeConverter fun stringToError(value: String?): LocalErrorCode? = value?.let(LocalErrorCode::valueOf)
}
