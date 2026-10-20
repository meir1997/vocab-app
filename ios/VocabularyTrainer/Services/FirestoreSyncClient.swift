import Foundation
import FirebaseCore
import FirebaseAuth
import FirebaseFirestore

/// Keeps SDK-specific values outside the merge model and makes the coordinator
/// testable without Google credentials, a network connection or production data.
@MainActor
final class FirestoreSyncClient: CloudSyncClient {
    private let database: Firestore

    init(database: Firestore) { self.database = database }

    static func configured() -> FirestoreSyncClient? {
        guard FirebaseApp.app() != nil else { return nil }
        return FirestoreSyncClient(database: Firestore.firestore())
    }

    func observe(
        userID: String,
        onChange: @escaping @MainActor (Result<CloudSyncSnapshot, Error>) -> Void
    ) -> any CloudSyncObservation {
        let reference = database.collection("users").document(userID)
        let registration = reference.addSnapshotListener(includeMetadataChanges: true) { @Sendable snapshot, error in
            let result: Result<CloudSyncSnapshot, Error>
            do {
                if let error { throw error }
                guard let snapshot else { throw SyncError.missingSnapshot }
                let document = try snapshot.data().map { try WebSyncDocument(dictionary: $0) }
                result = .success(CloudSyncSnapshot(
                    document: document,
                    isFromCache: snapshot.metadata.isFromCache,
                    hasPendingWrites: snapshot.metadata.hasPendingWrites
                ))
            } catch { result = .failure(error) }
            Task { @MainActor in onChange(result) }
        }
        return FirestoreObservation(registration)
    }

    func mergeAndWrite(userID: String, document: WebSyncDocument, email: String?) async throws -> WebSyncDocument {
        guard Auth.auth().currentUser?.uid == userID else { throw SyncError.accountChanged }
        let reference = database.collection("users").document(userID)
        // Capture values only. Firestore can retry the block, on a background
        // queue, so the block must not mutate the app or the local progress store.
        let writeTime = floor(Date().timeIntervalSince1970 * 1_000)
        let result = try await database.runTransaction { @Sendable transaction, errorPointer in
            do {
                guard Auth.auth().currentUser?.uid == userID else { throw SyncError.accountChanged }
                let server = try transaction.getDocument(reference)
                let remote = try server.data().map { try WebSyncDocument(dictionary: $0) } ?? WebSyncDocument()
                var merged = WebSyncDocument.merging(local: document, remote: remote)
                merged.email = email
                if server.exists, merged.state == remote.state, merged.extra == remote.extra, email == remote.email {
                    return remote.dictionary
                }
                merged.updatedAt = max(writeTime, max(document.updatedAt, remote.updatedAt))
                // Nested dictionaries keep words such as "c." as literal keys;
                // never construct a dotted update path from vocabulary text.
                transaction.setData(merged.dictionary, forDocument: reference, merge: true)
                return merged.dictionary
            } catch {
                errorPointer?.pointee = error as NSError
                return nil
            }
        }
        guard Auth.auth().currentUser?.uid == userID else { throw SyncError.accountChanged }
        guard let values = result as? [String: Any] else { throw SyncError.missingSnapshot }
        return try WebSyncDocument(dictionary: values)
    }

    private enum SyncError: Error {
        case accountChanged, missingSnapshot
    }
}

private final class FirestoreObservation: CloudSyncObservation {
    private var registration: ListenerRegistration?

    init(_ registration: ListenerRegistration) { self.registration = registration }
    func cancel() { registration?.remove(); registration = nil }
    deinit { registration?.remove() }
}
