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
    func testBandAdvancementRequiresAtLeastSevenOfTenAndDoesNotMarkUnseen() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        let other = VocabularyEntry(rank: 10000, english: "calves", hebrew: "calves")
        store.registerVocabulary([mr, other])
        for _ in 0..<9 { store.record(.incorrect, for: mr, now: timestamp) }
        for _ in 0..<6 { store.record(.correct, for: mr, now: timestamp) }
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

    @MainActor
    func testOutOfBandReviewsUpdateProgressAndStatsWithoutChangingBandWindow() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        store.registerVocabulary([mr, dotted])
        store.setBand(2)
        store.record(.correct, for: mr, now: timestamp)
        store.record(.unknown, for: mr, now: timestamp)
        XCTAssertEqual(store.value(for: mr).attempts, 2)
        XCTAssertEqual(store.value(for: mr).consecutiveCorrect, 0)
        XCTAssertEqual(store.snapshot.state.stats.attempts, 2)
        XCTAssertEqual(store.snapshot.state.stats.correct, 1)
        XCTAssertEqual(store.currentBand, 2)
        XCTAssertEqual(store.snapshot.state.bands.recent, [])
        XCTAssertNil(store.snapshot.state.progress[dotted.english])
    }

    @MainActor
    func testRemoteBandWindowContinuesLocallyPersistsAndUsesExactFirestoreShape() throws {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let entry = VocabularyEntry(rank: 101, english: "boundary", hebrew: "boundary")
        let store = ProgressStore(defaults: defaults)
        store.activateAccount(uid: "bands-account")
        store.registerVocabulary([mr, entry, dotted])
        let remote = try WebSyncDocument(dictionary: ["fw": ["bands": ["current": 2, "recent": [1, 0, 1]]]])
        store.applyRemote(remote)
        XCTAssertFalse(store.hasPendingChanges)
        store.record(.unknown, for: entry, now: timestamp)
        XCTAssertTrue(store.hasPendingChanges)
        XCTAssertEqual(store.currentBand, 2)
        XCTAssertEqual(store.snapshot.state.bands.recent, [1, 0, 1, 0])
        let fw = try XCTUnwrap(store.snapshot.dictionary["fw"] as? [String: Any])
        let bands = try XCTUnwrap(fw["bands"] as? [String: Any])
        XCTAssertEqual(Set(bands.keys), Set(["current", "recent", "thousandRecent"]))
        XCTAssertEqual((bands["current"] as? NSNumber)?.intValue, 2)
        XCTAssertEqual((bands["recent"] as? [NSNumber])?.map(\.intValue), [1, 0, 1, 0])
        XCTAssertEqual(try WebSyncDocument(dictionary: store.snapshot.dictionary).state.bands, store.snapshot.state.bands)
        let reopened = ProgressStore(defaults: defaults)
        reopened.activateAccount(uid: "bands-account")
        XCTAssertEqual(reopened.snapshot.state.bands, store.snapshot.state.bands)
        XCTAssertTrue(reopened.hasPendingChanges)
        XCTAssertNil(reopened.snapshot.state.progress[mr.english])
    }

    @MainActor
    func testRemoteWindowCanPromoteLocallyWithoutMarkingAnyUnseenWordsKnown() throws {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        let entries = [100, 101, 199, 200, 201, 10000].map {
            VocabularyEntry(rank: $0, english: "word\($0)", hebrew: "translation\($0)")
        }
        store.registerVocabulary(entries)
        var remote = WebSyncDocument()
        remote.state.bands.current = 2
        remote.state.bands.recent = Array(repeating: 0, count: 8) + Array(repeating: 1, count: 21)
        store.applyRemote(remote)
        let answered = entries[1]
        store.record(.correct, for: answered, now: timestamp)
        XCTAssertEqual(store.currentBand, 3)
        XCTAssertEqual(store.snapshot.state.bands.recent, [])
        XCTAssertEqual(store.learnedCount, 0)
        XCTAssertEqual(Set(store.snapshot.state.progress.keys), Set([answered.english]))
        let reopened = ProgressStore(defaults: defaults)
        XCTAssertEqual(reopened.currentBand, 3)
        XCTAssertEqual(reopened.snapshot.state.bands.recent, [])
        XCTAssertEqual(reopened.progress.count, 1)
    }

    @MainActor
    func testSessionCountsAndQueueShareOriginalRankEligibility() {
        let (defaults, suite) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        let entries = [1, 100, 101, 200, 201, 202, 10000].map {
            VocabularyEntry(rank: $0, english: "word\($0)", hebrew: "translation\($0)")
        }
        store.registerVocabulary(entries)
        store.record(.incorrect, for: entries[4], now: timestamp) // Due old review outside band 1.
        store.record(.correct, for: entries[5], now: timestamp) // Future outside-band review.
        store.record(.correct, for: entries[1], now: timestamp) // Future current-band filler.
        XCTAssertEqual(store.dueCount(in: entries, now: timestamp), 2)
        store.setAllDueSession(now: timestamp)
        XCTAssertEqual(store.sessionCount(in: entries, now: timestamp), 2)
        let due = QuizEngine.makeSession(entries: entries, progress: store.progress,
                                        count: store.sessionCount(in: entries, now: timestamp), now: timestamp)
        XCTAssertEqual(Set(due.map { $0.entry.rank }), Set([1, 201]))
        store.setSessionLength(20, now: timestamp)
        XCTAssertEqual(store.sessionCount(in: entries, now: timestamp), 3)
        let filled = QuizEngine.makeSession(entries: entries, progress: store.progress,
                                           count: store.sessionCount(in: entries, now: timestamp), now: timestamp)
        XCTAssertEqual(Set(filled.map { $0.entry.rank }), Set([1, 100, 201]))
        // The sparse array must not pull rank 101 into the first hundred.
        XCTAssertFalse(filled.contains { $0.entry.rank == 101 })
    }
}
