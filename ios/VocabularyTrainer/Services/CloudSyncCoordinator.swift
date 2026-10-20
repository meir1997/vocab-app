import Foundation
import Combine

struct CloudSyncSnapshot: Sendable {
    let document: WebSyncDocument?
    let isFromCache: Bool
    let hasPendingWrites: Bool
}

protocol CloudSyncObservation: AnyObject {
    func cancel()
}

@MainActor
protocol CloudSyncClient: AnyObject {
    func observe(
        userID: String,
        onChange: @escaping @MainActor (Result<CloudSyncSnapshot, Error>) -> Void
    ) -> any CloudSyncObservation

    func mergeAndWrite(userID: String, document: WebSyncDocument, email: String?) async throws -> WebSyncDocument
}

/// Owns one user's listener and pending work. The store is durable; a network
/// transaction is only an attempt to deliver that state, never its only copy.
@MainActor
final class CloudSyncCoordinator: ObservableObject {
    enum Status: Equatable {
        case local, unavailable, connecting, offline, pending, uploading, synced
        case failed
    }

    @Published private(set) var status: Status = .local
    @Published private(set) var userID: String?
    @Published private(set) var lastSyncedAt: Date?

    private let store: ProgressStore
    private let client: (any CloudSyncClient)?
    private let debounceNanoseconds: UInt64
    private let reconnectNanoseconds: UInt64?
    private var user: SyncUser?
    private var generation = 0
    private var listenerGeneration = 0
    private var deferredSnapshot: CloudSyncSnapshot?
    private var serverReady = false
    private var observation: (any CloudSyncObservation)?
    private var debounceTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var uploadTask: Task<Void, Never>?
    private var changes: AnyCancellable?

    init(
        store: ProgressStore,
        client: (any CloudSyncClient)?,
        debounceNanoseconds: UInt64 = 750_000_000,
        reconnectNanoseconds: UInt64? = 30_000_000_000
    ) {
        self.store = store
        self.client = client
        self.debounceNanoseconds = debounceNanoseconds
        self.reconnectNanoseconds = reconnectNanoseconds
        changes = store.$revision.dropFirst().sink { [weak self] _ in
            // Published values emit before assignment; inspect the finished store
            // on the next actor turn rather than capturing an outdated revision.
            Task { @MainActor [weak self] in self?.localStateChanged() }
        }
    }

    deinit {
        observation?.cancel()
        debounceTask?.cancel()
        reconnectTask?.cancel()
        uploadTask?.cancel()
    }

    func setUser(_ newUser: SyncUser?) {
        if userID == newUser?.uid, user != nil || newUser == nil {
            user = newUser
            return
        }
        generation += 1
        listenerGeneration += 1
        deferredSnapshot = nil
        observation?.cancel()
        observation = nil
        debounceTask?.cancel()
        debounceTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        uploadTask?.cancel()
        uploadTask = nil
        serverReady = false
        lastSyncedAt = nil
        user = newUser
        userID = newUser?.uid
        store.activateAccount(uid: newUser?.uid)
        guard newUser != nil else { status = .local; return }
        guard client != nil else { status = .unavailable; return }
        attachListener()
    }

    /// Also called on foreground entry. A fresh server observation is required
    /// after disconnect/error; cached data alone is never called "synced".
    func synchronizeNow() async {
        debounceTask?.cancel()
        debounceTask = nil
        guard let user, let client else { return }
        guard serverReady else { attachListener(); return }
        guard store.hasPendingChanges else { status = .synced; return }
        guard uploadTask == nil else { return }

        let ticket = generation
        let capturedRevision = store.revision
        let document = store.snapshot
        status = .uploading
        let task = Task { @MainActor [weak self] in
            do {
                let written = try await client.mergeAndWrite(userID: user.uid, document: document, email: user.email)
                guard let self, self.isCurrent(user.uid, generation: ticket) else { return }
                self.uploadTask = nil
                self.store.acknowledge(written, capturedRevision: capturedRevision)
                self.lastSyncedAt = Date()
                self.status = self.store.hasPendingChanges ? .pending : .synced
                if let deferred = self.deferredSnapshot {
                    self.deferredSnapshot = nil
                    self.receive(deferred)
                } else if self.store.hasPendingChanges { self.scheduleUpload() }
            } catch {
                guard let self, self.isCurrent(user.uid, generation: ticket) else { return }
                self.uploadTask = nil
                self.deferredSnapshot = nil
                self.serverReady = false
                self.status = .failed
                self.scheduleReconnect()
            }
        }
        uploadTask = task
        await task.value
    }

    var statusText: String {
        switch status {
        case .local: return "ההתקדמות נשמרת במכשיר"
        case .unavailable: return "נדרשת השלמת הגדרת הסנכרון"
        case .connecting: return "מתחברים לספרייה שבחשבון…"
        case .offline: return "ממתינים לרשת. השינויים נשמרים במכשיר"
        case .pending: return "השינויים נשמרו וממתינים לסנכרון"
        case .uploading: return "מסנכרנים את ההתקדמות…"
        case .synced: return "מסונכרן עם אותו חשבון באתר"
        case .failed: return "לא הצלחנו לסנכרן. ההתקדמות נשמרה במכשיר"
        }
    }

    private func isCurrent(_ uid: String, generation ticket: Int) -> Bool {
        ticket == generation && userID == uid && store.currentUID == uid
    }

    private func attachListener() {
        guard let user, let client else { return }
        observation?.cancel()
        debounceTask?.cancel()
        reconnectTask?.cancel()
        reconnectTask = nil
        serverReady = false
        status = .connecting
        let ticket = generation
        listenerGeneration += 1
        let listenerTicket = listenerGeneration
        observation = client.observe(userID: user.uid) { [weak self] result in
            guard let self, self.isCurrent(user.uid, generation: ticket),
                  listenerTicket == self.listenerGeneration else { return }
            switch result {
            case .failure:
                self.serverReady = false
                self.debounceTask?.cancel()
                self.status = .failed
                self.scheduleReconnect()
            case .success(let snapshot):
                self.receive(snapshot)
            }
        }
    }

    private func receive(_ snapshot: CloudSyncSnapshot) {
        // A server echo can arrive before the transaction completion. Delay it
        // until acknowledge() protects preferences edited during that write.
        if uploadTask != nil {
            if !snapshot.hasPendingWrites { deferredSnapshot = snapshot }
            return
        }
        serverReady = !snapshot.isFromCache && !snapshot.hasPendingWrites
        if let document = snapshot.document, !snapshot.hasPendingWrites {
            store.applyRemote(document)
        }
        if snapshot.hasPendingWrites {
            status = .pending
        } else if snapshot.isFromCache {
            debounceTask?.cancel()
            status = .offline
            scheduleReconnect()
        } else {
            reconnectTask?.cancel()
            reconnectTask = nil
            status = store.hasPendingChanges ? .pending : .synced
            if store.hasPendingChanges { scheduleUpload() }
        }
    }

    private func localStateChanged() {
        guard user != nil, store.hasPendingChanges else { return }
        if serverReady { status = .pending; scheduleUpload() }
    }

    private func scheduleUpload() {
        guard serverReady, user != nil, store.hasPendingChanges else { return }
        debounceTask?.cancel()
        let ticket = generation
        let delay = debounceNanoseconds
        debounceTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: delay) }
            catch { return }
            guard let self, ticket == self.generation, !Task.isCancelled else { return }
            await self.synchronizeNow()
        }
    }

    private func scheduleReconnect() {
        guard reconnectTask == nil, let delay = reconnectNanoseconds, user != nil else { return }
        let ticket = generation
        reconnectTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: delay) }
            catch { return }
            guard let self, ticket == self.generation, !Task.isCancelled else { return }
            self.reconnectTask = nil
            self.attachListener()
        }
    }
}
