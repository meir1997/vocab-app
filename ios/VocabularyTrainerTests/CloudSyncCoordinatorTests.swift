import XCTest
@testable import VocabularyTrainer

@MainActor
final class CloudSyncCoordinatorTests: XCTestCase {
    private let word = VocabularyEntry(rank: 98, english: "Mr", hebrew: "אדון")
    private let dotted = VocabularyEntry(rank: 801, english: "c.", hebrew: "סימון")
    private let userA = SyncUser(uid: "account-A", email: "a@example.test", displayName: "A")
    private let userB = SyncUser(uid: "account-B", email: "b@example.test", displayName: "B")
    private let now = Date(timeIntervalSince1970: 1_791_234_567)

    private func environment() -> (ProgressStore, FakeCloudClient, CloudSyncCoordinator) {
        let name = "CloudSyncCoordinatorTests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        let store = ProgressStore(defaults: defaults)
        store.registerVocabulary([word, dotted])
        let client = FakeCloudClient()
        let coordinator = CloudSyncCoordinator(
            store: store, client: client,
            debounceNanoseconds: 600_000_000_000,
            reconnectNanoseconds: nil
        )
        return (store, client, coordinator)
    }

    func testNeverUploadsBeforeAuthoritativeReadAndMergesBothDirections() async {
        let (store, client, coordinator) = environment()
        store.record(.correct, for: word, now: now)
        coordinator.setUser(userA)
        client.emit(document: nil, fromCache: true)
        XCTAssertEqual(coordinator.status, .offline)
        await coordinator.synchronizeNow()
        XCTAssertTrue(client.writes.isEmpty)

        var remote = WebSyncDocument(updatedAt: 100)
        remote.state.progress["c."] = WebWordProgress(r: 2, s: 2, next: 1_791_300_000_000)
        client.emit(document: remote)
        XCTAssertEqual(store.value(for: dotted).successes, 2)
        await coordinator.synchronizeNow()

        XCTAssertEqual(client.writes.count, 1)
        XCTAssertEqual(client.documents[userA.uid]?.state.progress["Mr"]?.r, 1)
        XCTAssertEqual(client.documents[userA.uid]?.state.progress["c."]?.r, 2)
        XCTAssertNil(client.documents[userA.uid]?.state.progress["mr"])
        XCTAssertFalse(store.hasPendingChanges)
        XCTAssertEqual(coordinator.status, .synced)
    }

    func testIdenticalServerSnapshotsDoNotCreateUploadLoop() async {
        let (store, client, coordinator) = environment()
        coordinator.setUser(userA)
        var remote = WebSyncDocument(updatedAt: 100)
        remote.state.progress["Mr"] = WebWordProgress(r: 2, s: 2, next: 100_000)
        remote.state.settings.length = .all
        remote.state.bands.current = 9
        client.emit(document: remote)
        let revision = store.revision
        client.emit(document: remote)
        await coordinator.synchronizeNow()
        XCTAssertEqual(store.revision, revision)
        XCTAssertEqual(store.learnedCount, 1)
        XCTAssertEqual(store.currentBand, 9)
        XCTAssertEqual(store.snapshot.state.settings.length, .all)
        XCTAssertFalse(store.hasPendingChanges)
        XCTAssertTrue(client.writes.isEmpty)
    }

    func testOldAccountListenerCannotChangeNewAccount() {
        let (store, client, coordinator) = environment()
        coordinator.setUser(userA)
        let old = client.listeners.last!
        coordinator.setUser(userB)
        XCTAssertTrue(old.canceled)
        var privateA = WebSyncDocument()
        privateA.state.progress["Mr"] = WebWordProgress(r: 99, s: 2)
        old.emit(document: privateA)
        XCTAssertEqual(store.currentUID, userB.uid)
        XCTAssertTrue(store.progress.isEmpty)
        XCTAssertEqual(store.totalAttempts, 0)
    }

    func testReconnectedSameAccountIgnoresDetachedListener() async {
        let (store, client, coordinator) = environment()
        coordinator.setUser(userA)
        let old = client.listeners.last!
        await coordinator.synchronizeNow() // reconnect before the first server read
        XCTAssertTrue(old.canceled)
        var stale = WebSyncDocument()
        stale.state.progress["Mr"] = WebWordProgress(r: 99, s: 2)
        old.emit(document: stale)
        XCTAssertTrue(store.progress.isEmpty)
        client.emit(document: nil)
        XCTAssertEqual(coordinator.status, .synced)
    }

    func testOldUploadCompletionCannotAcknowledgeAnotherAccount() async {
        let (store, client, coordinator) = environment()
        store.record(.correct, for: word, now: now)
        coordinator.setUser(userA)
        client.emit(document: nil)
        client.suspendNextWrite = true
        let upload = Task { await coordinator.synchronizeNow() }
        await waitForWrite(client)
        coordinator.setUser(userB)
        client.finishWrite(emitEcho: true)
        await upload.value
        client.emit(document: nil)
        XCTAssertEqual(store.currentUID, userB.uid)
        XCTAssertTrue(store.progress.isEmpty)
        XCTAssertEqual(coordinator.status, .synced)
        coordinator.setUser(userA)
        XCTAssertEqual(store.value(for: word).attempts, 1)
        XCTAssertTrue(store.hasPendingChanges)
    }

    func testLaterAnswerAndSettingsSurviveServerEchoBeforeWriteAcknowledgement() async {
        let (store, client, coordinator) = environment()
        store.record(.correct, for: word, now: now)
        store.setSessionLength(10, now: now)
        coordinator.setUser(userA)
        client.emit(document: nil)
        client.suspendNextWrite = true
        let upload = Task { await coordinator.synchronizeNow() }
        await waitForWrite(client)
        store.record(.incorrect, for: word, now: now)
        store.setSessionLength(30, now: now.addingTimeInterval(1))
        client.finishWrite(emitEcho: true)
        await upload.value
        XCTAssertEqual(store.value(for: word).attempts, 2)
        XCTAssertEqual(store.snapshot.state.settings.length, .count(30))
        XCTAssertTrue(store.hasPendingChanges)
        await coordinator.synchronizeNow()
        XCTAssertEqual(client.documents[userA.uid]?.state.progress["Mr"]?.w, 1)
        XCTAssertEqual(client.documents[userA.uid]?.state.settings.length, .count(30))
        XCTAssertFalse(store.hasPendingChanges)
    }

    func testNetworkFailureKeepsPendingDataUntilRetry() async {
        let (store, client, coordinator) = environment()
        store.record(.correct, for: word, now: now)
        coordinator.setUser(userA)
        client.emit(document: nil)
        client.nextFailure = URLError(.notConnectedToInternet)
        await coordinator.synchronizeNow()
        XCTAssertEqual(coordinator.status, .failed)
        XCTAssertTrue(store.hasPendingChanges)
        XCTAssertEqual(store.value(for: word).attempts, 1)
        await coordinator.synchronizeNow() // reattach, do not blindly write
        client.emit(document: nil)
        await coordinator.synchronizeNow()
        XCTAssertFalse(store.hasPendingChanges)
        XCTAssertEqual(client.documents[userA.uid]?.state.progress["Mr"]?.r, 1)
    }

    func testPendingSDKWriteIsNotReportedAsOfflineOrAppliedPrematurely() {
        let (store, client, coordinator) = environment()
        coordinator.setUser(userA)
        var speculative = WebSyncDocument()
        speculative.state.progress["Mr"] = WebWordProgress(r: 8, s: 2)
        client.emit(document: speculative, pending: true)
        XCTAssertEqual(coordinator.status, .pending)
        XCTAssertTrue(store.progress.isEmpty)
        client.emit(document: speculative)
        XCTAssertEqual(store.value(for: word).successes, 8)
        XCTAssertEqual(coordinator.status, .synced)
    }

    func testQuizFromPreviousAccountCannotRecordIntoCurrentAccount() {
        let (store, _, coordinator) = environment()
        coordinator.setUser(userA)
        let entries = [word, dotted,
                       VocabularyEntry(rank: 99, english: "three", hebrew: "שלוש"),
                       VocabularyEntry(rank: 100, english: "four", hebrew: "ארבע")]
        let quiz = QuizViewModel(entries: entries, sessionLength: 1, progressStore: store)
        XCTAssertNotNil(quiz.currentQuestion)
        coordinator.setUser(userB)
        quiz.choose(quiz.currentQuestion!.correctAnswer)
        quiz.markUnknown()
        XCTAssertEqual(store.totalAttempts, 0)
        XCTAssertTrue(store.progress.isEmpty)
    }

    private func waitForWrite(_ client: FakeCloudClient) async {
        for _ in 0..<100 where !client.hasSuspendedWrite { await Task.yield() }
        XCTAssertTrue(client.hasSuspendedWrite, "The fake transaction should have reached its suspension point")
    }
}

@MainActor
private final class FakeCloudClient: CloudSyncClient {
    struct Write { let uid: String; let document: WebSyncDocument }
    var documents: [String: WebSyncDocument] = [:]
    var listeners: [FakeObservation] = []
    var writes: [Write] = []
    var nextFailure: Error?
    var suspendNextWrite = false
    private var suspended: (String, WebSyncDocument, CheckedContinuation<WebSyncDocument, Error>)?
    var hasSuspendedWrite: Bool { suspended != nil }

    func observe(userID: String, onChange: @escaping @MainActor (Result<CloudSyncSnapshot, Error>) -> Void) -> any CloudSyncObservation {
        let observation = FakeObservation(uid: userID, onChange: onChange)
        listeners.append(observation)
        return observation
    }

    func mergeAndWrite(userID: String, document: WebSyncDocument, email: String?) async throws -> WebSyncDocument {
        writes.append(Write(uid: userID, document: document))
        if let failure = nextFailure { nextFailure = nil; throw failure }
        var merged = WebSyncDocument.merging(local: document, remote: documents[userID] ?? WebSyncDocument())
        merged.email = email
        // Deliberately use a clock ahead of the device to exercise stale-ack protection.
        merged.updatedAt = max(2_000_000_000_000, merged.updatedAt)
        if suspendNextWrite {
            suspendNextWrite = false
            return try await withCheckedThrowingContinuation { suspended = (userID, merged, $0) }
        }
        documents[userID] = merged
        return merged
    }

    func emit(document: WebSyncDocument?, fromCache: Bool = false, pending: Bool = false) {
        guard let listener = listeners.last else { return }
        if !fromCache, !pending { documents[listener.uid] = document }
        listener.emit(document: document, fromCache: fromCache, pending: pending)
    }

    func finishWrite(emitEcho: Bool) {
        guard let (uid, document, continuation) = suspended else { return }
        suspended = nil
        documents[uid] = document
        if emitEcho { listeners.first(where: { $0.uid == uid })?.emit(document: document) }
        continuation.resume(returning: document)
    }
}

private final class FakeObservation: CloudSyncObservation {
    let uid: String
    private let onChange: @MainActor (Result<CloudSyncSnapshot, Error>) -> Void
    private(set) var canceled = false
    init(uid: String, onChange: @escaping @MainActor (Result<CloudSyncSnapshot, Error>) -> Void) {
        self.uid = uid; self.onChange = onChange
    }
    func cancel() { canceled = true }
    @MainActor
    func emit(document: WebSyncDocument?, fromCache: Bool = false, pending: Bool = false) {
        // Intentionally allow delivery after cancellation to simulate SDK races.
        onChange(.success(CloudSyncSnapshot(document: document, isFromCache: fromCache, hasPendingWrites: pending)))
    }
}
