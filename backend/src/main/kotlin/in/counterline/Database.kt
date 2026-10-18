package `in`.counterline

import java.sql.Connection
import java.util.UUID
import javax.sql.DataSource

internal fun <T> databaseTransaction(source: DataSource, block: (Connection) -> T): T = source.connection.use { connection ->
    connection.autoCommit = false
    try { block(connection).also { connection.commit() } }
    catch (failure: Throwable) {
        try { connection.rollback() } catch (rollbackFailure: Throwable) { failure.addSuppressed(rollbackFailure) }
        throw failure
    }
}

internal fun audit(connection: Connection, actor: String?, action: String, target: String) {
    connection.prepareStatement("INSERT INTO audit_events(actor_id, action, target_id) VALUES (?, ?, ?)").use {
        it.setObject(1, actor?.let(UUID::fromString)); it.setString(2, action); it.setString(3, target); it.executeUpdate()
    }
}
