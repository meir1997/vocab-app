import XCTest
@testable import VocabularyTrainer

final class ProgressSyncStoreTests: XCTestCase {
    private let mr = VocabularyEntry(rank: 98, english: "Mr", hebrew: "sir")
    private let dotted = VocabularyEntry(rank: 801, english: "c.", hebrew: "c")
    private let timestamp = Date(timeIntervalSince1970: 1_791_234_567)

    private func isolatedDefaults() -> (UserDefaults, String) {
        let name = "ProgressSyncStoreTests." + UUID().uuidString
        return (UserDefaults(suiteName: name)!, name)
    }

    @MainActor
    func testLegacyMigratesOnceAndNormalizesOriginalCasing() throws {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        var legacy = WordProgress()
        legacy.attempts = 4; legacy.successes = 3; legacy.consecutiveCorrect = 2
        legacy.nextReview = timestamp
        defaults.set(try JSONEncoder().encode(["mr": legacy]), forKey: "wordProgress.v1")
        let store = ProgressStore(defaults: defaults)
        store.registerVocabulary([mr, dotted])
        XCTAssertEqual(store.snapshot.state.progress["Mr"]?.r, 3)
        XCTAssertEqual(store.snapshot.state.progress["Mr"]?.w, 1)
        XCTAssertNil(store.snapshot.state.progress["mr"])
        XCTAssertEqual(store.totalAttempts, 4)
        XCTAssertEqual(store.learnedCount, 1)
        store.record(.correct, for: mr, now: timestamp)
        let reopened = ProgressStore(defaults: defaults)
        reopened.registerVocabulary([mr])
        XCTAssertEqual(reopened.value(for: mr).attempts, 5)
    }

    @MainActor
    func testGuestClaimedByFirstUIDAndAccountSwitchNeverCopiesAnotherAccount() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        store.registerVocabulary([mr, dotted])
        store.record(.correct, for: mr, now: timestamp)
        store.activateAccount(uid: "account-A")
        XCTAssertEqual(store.value(for: mr).attempts, 1)
        store.record(.incorrect, for: mr, now: timestamp)
        store.activateAccount(uid: "account-B")
        XCTAssertEqual(store.totalAttempts, 0)
        XCTAssertTrue(store.progress.isEmpty)
        store.record(.correct, for: dotted, now: timestamp)
        store.activateAccount(uid: "account-A")
        XCTAssertEqual(store.value(for: mr).attempts, 2)
        XCTAssertEqual(store.value(for: dotted).attempts, 0)
        store.activateAccount(uid: nil)
        XCTAssertEqual(store.value(for: mr).attempts, 1)
        XCTAssertEqual(store.value(for: dotted).attempts, 0)
        let reopened = ProgressStore(defaults: defaults)
        reopened.activateAccount(uid: "account-B")
        XCTAssertEqual(reopened.value(for: dotted).attempts, 1)
        XCTAssertEqual(reopened.value(for: mr).attempts, 0)
    }

    @MainActor
    func testIdenticalRemoteSnapshotDoesNotCauseEchoAndSurvivesRestart() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        store.activateAccount(uid: "account-A")
        store.record(.correct, for: mr, now: timestamp)
        let captured = store.revision
        let written = store.snapshot
        store.acknowledge(written, capturedRevision: captured)
        XCTAssertFalse(store.hasPendingChanges)
        store.applyRemote(written)
        XCTAssertFalse(store.hasPendingChanges)
        XCTAssertEqual(store.revision, captured)
        let reopened = ProgressStore(defaults: defaults)
        reopened.activateAccount(uid: "account-A")
        XCTAssertFalse(reopened.hasPendingChanges)
        XCTAssertEqual(reopened.value(for: mr).attempts, 1)
    }

    @MainActor
    func testStaleAcknowledgementRetainsLaterAnswerAndRemoteUnion() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        store.activateAccount(uid: "account-A")
        store.record(.correct, for: mr, now: timestamp)
        let captured = store.revision
        var written = store.snapshot
        written.state.progress["web-only"] = WebWordProgress(r: 2, s: 2, next: 123_000)
        store.record(.incorrect, for: mr, now: timestamp)
        store.acknowledge(written, capturedRevision: captured)
        XCTAssertTrue(store.hasPendingChanges)
        XCTAssertEqual(store.value(for: mr).attempts, 2)
        XCTAssertEqual(store.snapshot.state.progress["web-only"]?.r, 2)
        XCTAssertEqual(store.snapshot.state.progress["Mr"]?.w, 1)
    }

    @MainActor
    func testNewerRemoteUnionCanCoverLaterAnswerWithoutExtraUpload() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        store.activateAccount(uid: "account-A")
        store.record(.correct, for: mr, now: timestamp)
        let captured = store.revision
        store.record(.correct, for: mr, now: timestamp)
        let union = store.snapshot
        store.acknowledge(union, capturedRevision: captured)
        XCTAssertFalse(store.hasPendingChanges)
        XCTAssertEqual(store.value(for: mr).attempts, 2)
    }

    @MainActor
    func testAcknowledgementDoesNotOverwriteALaterLocalSettingsEdit() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        store.activateAccount(uid: "account-A")
        store.record(.correct, for: mr, now: timestamp)
        let captured = store.revision
        var written = store.snapshot
        store.setSessionLength(30, now: timestamp)
        // The upload receives its timestamp after the local preference edit.
        written.updatedAt = store.snapshot.updatedAt + 100
        store.acknowledge(written, capturedRevision: captured)
        XCTAssertEqual(store.snapshot.state.settings.length, .count(30))
        XCTAssertGreaterThan(store.snapshot.updatedAt, written.updatedAt)
        XCTAssertTrue(store.hasPendingChanges)
    }

    @MainActor
    func testRemoteAllAndUnsupportedModeArePreservedUntilExplicitLengthChange() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        var remote = WebSyncDocument(updatedAt: 100)
        remote.state.settings.length = .all
        remote.state.settings.mode = "typing"
        store.applyRemote(remote)
        store.record(.correct, for: mr, now: timestamp)
        XCTAssertEqual(store.snapshot.state.settings.length, .all)
        XCTAssertEqual(store.snapshot.state.settings.mode, "typing")
        store.setSessionLength(30, now: timestamp)
        XCTAssertEqual(store.snapshot.state.settings.length, .count(30))
        XCTAssertEqual(store.snapshot.state.settings.mode, "typing")
    }

    @MainActor
    func testNativeDateClocksUseIntegralEpochMillisecondsLikeDateNow() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        let fractionalDate = Date(timeIntervalSince1970: 1_791_234_567.123456)
        let milliseconds = (fractionalDate.timeIntervalSince1970 * 1_000).rounded(.down)
        store.record(.correct, for: mr, now: fractionalDate)
        XCTAssertEqual(store.snapshot.state.progress["Mr"]?.next, milliseconds + 86_400_000)
        store.record(.unknown, for: mr, now: fractionalDate)
        XCTAssertEqual(store.snapshot.state.progress["Mr"]?.next, milliseconds)
        store.setSessionLength(30, now: fractionalDate)
        XCTAssertEqual(store.snapshot.updatedAt, milliseconds)
        var legacy = WordProgress()
        legacy.nextReview = fractionalDate
        XCTAssertEqual(WebWordProgress(local: legacy).next, milliseconds)
    }

    @MainActor
    func testReviewIntervalIsExactlyTwentyFourHoursAndUnknownResetsStreak() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        store.record(.correct, for: mr, now: timestamp)
        XCTAssertEqual(store.value(for: mr).nextReview.timeIntervalSince(timestamp), 86_400, accuracy: 0.001)
        store.record(.correct, for: mr, now: timestamp)
        XCTAssertEqual(store.value(for: mr).nextReview.timeIntervalSince(timestamp), 259_200, accuracy: 0.001)
        XCTAssertEqual(store.learnedCount, 1)
        store.record(.unknown, for: mr, now: timestamp)
        XCTAssertEqual(store.learnedCount, 0)
        XCTAssertEqual(store.snapshot.state.progress["Mr"]?.w, 1)
        XCTAssertEqual(store.value(for: mr).nextReview, timestamp)
    }

    @MainActor
    func testBandAdvancementRequiresStrictlyAboveSeventyPercentAndDoesNotMarkUnseen() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        let other = VocabularyEntry(rank: 10000, english: "calves", hebrew: "calves")
        store.registerVocabulary([mr, other])
        for _ in 0..<9 { store.record(.incorrect, for: mr, now: timestamp) }
        for _ in 0..<21 { store.record(.correct, for: mr, now: timestamp) }
        XCTAssertEqual(store.currentBand, 1)
        store.record(.correct, for: mr, now: timestamp)
        XCTAssertEqual(store.currentBand, 2)
        XCTAssertEqual(store.snapshot.state.bands.recent, [])
        XCTAssertNil(store.snapshot.state.progress["calves"])
        XCTAssertEqual(store.maxBand, 100)
        store.setBand(100)
        store.record(.correct, for: other, now: timestamp)
        XCTAssertEqual(store.value(for: other).attempts, 1)
        XCTAssertEqual(store.snapshot.state.bands.recent, [1])
    }
}
