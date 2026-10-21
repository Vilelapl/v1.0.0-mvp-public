package com.gestorfinanciero.domain

import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.UUID

sealed interface NormalizationResult {
    data class Valid(val transaction: CapturedTransaction) : NormalizationResult
    data class Invalid(val field: InvalidField) : NormalizationResult
}

enum class InvalidField { AMOUNT, CURRENCY, OCCURRED_AT, DESCRIPTION, ACCOUNT }

class TransactionNormalizer(private val newId: () -> UUID = UUID::randomUUID) {
    fun normalize(input: ParsedTransaction, source: NotificationSource): NormalizationResult {
        val amount = input.amount.trim()
        if (!AMOUNT.matches(amount) || amount.none { it in '1'..'9' }) {
            return NormalizationResult.Invalid(InvalidField.AMOUNT)
        }
        val currency = input.currency?.trim()
        if (currency != null && !CURRENCY.matches(currency)) {
            return NormalizationResult.Invalid(InvalidField.CURRENCY)
        }
        if (!INSTANT.matches(input.occurredAt)) {
            return NormalizationResult.Invalid(InvalidField.OCCURRED_AT)
        }
        val occurredAt = try {
            val date = OffsetDateTime.parse(input.occurredAt).withOffsetSameInstant(ZoneOffset.UTC)
            if (date.year !in 1..9999) return NormalizationResult.Invalid(InvalidField.OCCURRED_AT)
            date.format(DateTimeFormatter.ISO_INSTANT)
        } catch (_: DateTimeParseException) {
            return NormalizationResult.Invalid(InvalidField.OCCURRED_AT)
        }
        val description = input.description?.trim()
        val account = input.account?.trim()
        if (!validText(description, 300)) return NormalizationResult.Invalid(InvalidField.DESCRIPTION)
        if (!validText(account, 120)) return NormalizationResult.Invalid(InvalidField.ACCOUNT)

        // UUID is allocated only after validation, before the first Room write.
        // Decimal text is preserved, including trailing zeroes. Never use floating point.
        return NormalizationResult.Valid(CapturedTransaction(
            clientTransactionId = newId().toString(), amount = amount, currency = currency,
            occurredAt = occurredAt, description = description, type = input.type,
            account = account, source = source,
        ))
    }

    private fun validText(value: String?, max: Int): Boolean =
        value == null || (value.length in 1..max && '\u0000' !in value)

    private companion object {
        val AMOUNT = Regex("[0-9]{1,12}(?:\\.[0-9]{1,2})?")
        val CURRENCY = Regex("[A-Z]{3}")
        val INSTANT = Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]{1,9})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})")
    }
}
