import XCTest
import CoreFoundation
@testable import VocabularyTrainer

final class WebSyncStateTests: XCTestCase {
    private func document(_ progress: [String: [String: Any]], updatedAt: Double = 0) throws -> WebSyncDocument {
        try WebSyncDocument(dictionary: [
            "fw": ["progress": progress], "fwUpdatedAt": updatedAt
        ])
    }

    func testExactWebShapeUsesNumericMillisecondsAndOriginalWordKeys() throws {
        let timestamp = 1_791_234_567_890.0
        let source: [String: Any] = [
            "email": "learner@example.com", "fwUpdatedAt": timestamp,
            "fw": [
                "progress": ["Mr": ["r": 3, "w": 2, "s": 2, "next": timestamp],
                             "c.": ["r": 1, "w": 0, "s": 1, "next": timestamp]],
                "settings": ["length": "all", "mode": "typing", "goal": 40],
                "stats": ["attempts": 6, "correct": 4, "days": ["2026-10-20": ["a": 6, "c": 4]]],
                "bands": ["current": 100, "recent": [1, 0, 1]]
            ]
        ]
        let value = try WebSyncDocument(dictionary: source)
        XCTAssertEqual(value.updatedAt, timestamp)
        XCTAssertEqual(value.state.progress["Mr"]?.attempts, 5)
        XCTAssertEqual(value.state.progress["Mr"]?.local.nextReview.timeIntervalSince1970, timestamp / 1_000)
        XCTAssertEqual(value.state.settings.length, .all)
        XCTAssertEqual(value.state.settings.mode, "typing")
        let fw = try XCTUnwrap(value.dictionary["fw"] as? [String: Any])
        let progress = try XCTUnwrap(fw["progress"] as? [String: Any])
        XCTAssertNotNil(progress["c."])
        XCTAssertNil(progress["c"])
        XCTAssertEqual(try WebSyncDocument(dictionary: value.dictionary), value)
    }

    func testIntegralFirestoreFieldsSerializeAsIntegersLikeTheWeb() throws {
        var value = WebSyncDocument(updatedAt: 1_791_234_567_890)
        value.state.progress["Mr"] = WebWordProgress(r: 3, w: 1, s: 2, next: 1_791_300_000_000)
        value.state.bands.current = 8
        value.state.bands.recent = [1, 0]
        value.state.stats.attempts = 4
        value.state.stats.correct = 3
        let dictionary = value.dictionary
        let fw = try XCTUnwrap(dictionary["fw"] as? [String: Any])
        let progress = try XCTUnwrap(fw["progress"] as? [String: Any])
        let word = try XCTUnwrap(progress["Mr"] as? [String: Any])
        let settings = try XCTUnwrap(fw["settings"] as? [String: Any])
        let stats = try XCTUnwrap(fw["stats"] as? [String: Any])
        let bands = try XCTUnwrap(fw["bands"] as? [String: Any])
        let recent = try XCTUnwrap(bands["recent"] as? [Any])
        let fields: [Any?] = [word["r"], word["w"], word["s"], word["next"], settings["goal"],
                    stats["attempts"], stats["correct"], bands["current"], dictionary["fwUpdatedAt"]] + recent.map { Optional<Any>.some($0) }
        for raw in fields {
            let number = try XCTUnwrap(raw as? NSNumber)
            XCTAssertTrue(["q", "i", "s", "l", "I", "S", "L", "Q"].contains(String(cString: number.objCType)))
            XCTAssertNotEqual(CFGetTypeID(number), CFBooleanGetTypeID())
        }
    }

    func testSafeIntegerBoundariesKeepFractionsAndUnsafeValuesAsDoubles() throws {
        for value in [9_007_199_254_740_991.0, -9_007_199_254_740_991.0, 0.0, 1.0] {
            let raw = SyncJSONValue.number(value).any
            XCTAssertTrue(type(of: raw) == Int64.self)
            XCTAssertEqual(try SyncJSONValue(any: raw), .number(value))
        }
        for value in [1_791_234_567_890.25, 9_007_199_254_740_992.0, -9_007_199_254_740_992.0] {
            let raw = SyncJSONValue.number(value).any
            XCTAssertTrue(type(of: raw) == Double.self)
            let number = try XCTUnwrap(raw as? NSNumber)
            XCTAssertEqual(String(cString: number.objCType), "d")
            XCTAssertEqual(try SyncJSONValue(any: raw), .number(value))
        }
        let negativeZero = try XCTUnwrap(SyncJSONValue.number(-0.0).any as? Double)
        XCTAssertEqual(negativeZero.sign, .minus)
    }

    func testBooleanSerializationStaysDistinctFromIntegerZeroAndOne() throws {
        for value in [false, true] {
            let raw = SyncJSONValue.bool(value).any
            let number = try XCTUnwrap(raw as? NSNumber)
            XCTAssertEqual(CFGetTypeID(number), CFBooleanGetTypeID())
            XCTAssertEqual(try SyncJSONValue(any: raw), .bool(value))
        }
        XCTAssertEqual(try SyncJSONValue(any: SyncJSONValue.number(1).any), .number(1))
        XCTAssertEqual(try SyncJSONValue(any: SyncJSONValue.number(0).any), .number(0))
    }

    func testMoreAttemptsWinsEvenWithEarlierNextReviewAndNeverAddsCounters() throws {
        let local = try document(["the": ["r": 2, "w": 1, "s": 2, "next": 9_000]])
        let remote = try document(["the": ["r": 1, "w": 3, "s": 0, "next": 1_000]])
        let merged = WebSyncDocument.merging(local: local, remote: remote)
        XCTAssertEqual(merged.state.progress["the"]?.r, 1)
        XCTAssertEqual(merged.state.progress["the"]?.w, 3)
        XCTAssertEqual(merged.state.progress["the"]?.attempts, 4)
        XCTAssertEqual(WebSyncDocument.merging(local: merged, remote: remote), merged)
    }

    func testEqualAttemptTieUsesLaterReviewAndMissingRemotePreservesLocalWords() throws {
        let local = try document(["the": ["r": 2, "w": 0, "s": 2, "next": 100],
                                  "local-only": ["r": 1, "w": 0, "s": 1, "next": 10]])
        let remote = try document(["the": ["r": 1, "w": 1, "s": 0, "next": 200],
                                   "future-word": ["r": 1, "w": 0, "s": 1, "next": 10]])
        let merged = WebSyncDocument.merging(local: local, remote: remote)
        XCTAssertEqual(merged.state.progress["the"]?.next, 200)
        XCTAssertEqual(merged.state.progress["the"]?.s, 0)
        XCTAssertNotNil(merged.state.progress["local-only"])
        XCTAssertNotNil(merged.state.progress["future-word"])
    }

    func testUnknownRootAndNestedFieldsSurviveMergeAndCodablePersistence() throws {
        var local = WebSyncDocument()
        local.extra["nativeUnknown"] = .array([.bool(true), .null])
        local.extra["webUnknown"] = .object(["localSibling": .string("preserve")])
        let remote = try WebSyncDocument(dictionary: [
            "webUnknown": ["color": "blue"], "fwUpdatedAt": 100,
            "fw": ["futureFeature": ["enabled": true],
                   "progress": ["UnknownFutureWord": ["r": 2, "w": 1, "s": 2, "next": 8_000, "ease": 2.5]],
                   "settings": ["length": 20, "mode": "future-mode", "goal": 20, "sound": false],
                   "bands": ["current": 2, "recent": [1], "futureBand": "x"]]
        ])
        let merged = WebSyncDocument.merging(local: local, remote: remote)
        XCTAssertEqual(merged.extra["nativeUnknown"], local.extra["nativeUnknown"])
        XCTAssertEqual(merged.extra["webUnknown"], .object(["color": .string("blue"), "localSibling": .string("preserve")]))
        XCTAssertEqual(merged.state.progress["UnknownFutureWord"]?.extra["ease"], .number(2.5))
        XCTAssertEqual(merged.state.settings.extra["sound"], .bool(false))
        XCTAssertEqual(merged.state.settings.mode, "future-mode")
        XCTAssertEqual(merged.state.extra["futureFeature"], .object(["enabled": .bool(true)]))
        let persisted = try JSONDecoder().decode(WebSyncDocument.self, from: JSONEncoder().encode(merged))
        XCTAssertEqual(persisted, merged)
        XCTAssertEqual(try WebSyncDocument(dictionary: persisted.dictionary).state, merged.state)
    }

    func testNewerSettingsWinAndMissingSettingsCannotReplaceLocalPreferences() throws {
        var local = WebSyncDocument(updatedAt: 100)
        local.state.settings.length = .all
        local.state.settings.mode = "reverse"
        let missing = try WebSyncDocument(dictionary: ["fw": ["progress": [:]], "fwUpdatedAt": 500])
        XCTAssertEqual(WebSyncDocument.merging(local: local, remote: missing).state.settings.length, .all)
        let partial = try WebSyncDocument(dictionary: ["fw": ["settings": ["mode": "typing", "goal": 99]], "fwUpdatedAt": 900])
        XCTAssertFalse(partial.settingsPresent)
        let partialMerge = WebSyncDocument.merging(local: local, remote: partial)
        XCTAssertEqual(partialMerge.state.settings.length, .all)
        XCTAssertEqual(partialMerge.state.settings.mode, "reverse")
        var remote = WebSyncDocument(updatedAt: 101)
        remote.state.settings.length = .count(30)
        XCTAssertEqual(WebSyncDocument.merging(local: local, remote: remote).state.settings.length, .count(30))
        XCTAssertEqual(WebSyncDocument.merging(local: remote, remote: local).state.settings.length, .count(30))
    }

    func testStatsKeepBothDaysAndTakePerDayMaximumWithoutSumming() {
        var local = WebSyncDocument()
        local.state.stats.attempts = 5
        local.state.stats.correct = 4
        local.state.stats.days = ["2026-10-19": WebDayStats(a: 2, c: 2), "2026-10-20": WebDayStats(a: 3, c: 2)]
        var remote = WebSyncDocument()
        remote.state.stats.attempts = 6
        remote.state.stats.correct = 3
        remote.state.stats.days = ["2026-10-20": WebDayStats(a: 4, c: 1)]
        let merged = WebSyncDocument.merging(local: local, remote: remote)
        XCTAssertEqual(merged.state.stats.attempts, 6)
        XCTAssertEqual(merged.state.stats.correct, 3)
        XCTAssertEqual(merged.state.stats.days["2026-10-19"]?.a, 2)
        XCTAssertEqual(merged.state.stats.days["2026-10-20"]?.a, 4)
        XCTAssertEqual(merged.state.stats.days["2026-10-20"]?.c, 2)
    }

    func testHigherBandAndLongerSameBandWindowWinWithFiftyAnswerLimit() throws {
        var local = WebSyncDocument()
        local.state.bands.current = 3
        local.state.bands.recent = [1, 0]
        var remote = WebSyncDocument()
        remote.state.bands.current = 2
        remote.state.bands.recent = Array(repeating: 1, count: 50)
        XCTAssertEqual(WebSyncDocument.merging(local: local, remote: remote).state.bands.current, 3)
        remote.state.bands.current = 3
        XCTAssertEqual(WebSyncDocument.merging(local: local, remote: remote).state.bands.recent.count, 50)
        let parsed = try WebSyncDocument(dictionary: ["fw": ["bands": ["current": 4, "recent": Array(repeating: 1, count: 80)]]])
        XCTAssertEqual(parsed.state.bands.recent.count, 50)
    }

    func testMalformedCountersAndTimestampsAreRejected() {
        for invalid in [true, "2", -1, 0.5] as [Any] {
            XCTAssertThrowsError(try document(["the": ["r": invalid, "w": 0, "s": 0, "next": 0]]))
        }
        XCTAssertThrowsError(try document(["the": ["r": 0, "w": 0, "s": 0, "next": Double.infinity]]))
    }

    func testTwoCorrectAnswersAreKnownLikeTheWeb() {
        var progress = WordProgress()
        progress.consecutiveCorrect = 1
        XCTAssertFalse(progress.isLearned)
        progress.consecutiveCorrect = 2
        XCTAssertTrue(progress.isLearned)
    }

    func testBandEligibilityKeepsUnseenOutsideWordsUntouchedAndIncludesSerial10000() {
        let entries = [
            VocabularyEntry(rank: 100, english: "men", hebrew: "a"),
            VocabularyEntry(rank: 101, english: "own", hebrew: "b"),
            VocabularyEntry(rank: 9999, english: "wench", hebrew: "c"),
            VocabularyEntry(rank: 10000, english: "calves", hebrew: "d")
        ]
        let firstBand = QuizEngine.makeSession(entries: entries, progress: [:], count: 20, currentBand: 1)
        XCTAssertEqual(firstBand.map(\.entry.rank), [100])
        let lastBand = QuizEngine.makeSession(entries: entries, progress: [:], count: 20, currentBand: 100)
        XCTAssertEqual(Set(lastBand.map(\.entry.rank)), [9999, 10000])
        var failed = WordProgress()
        failed.attempts = 1
        let withReview = QuizEngine.makeSession(entries: entries, progress: ["own": failed], count: 20, currentBand: 1)
        XCTAssertEqual(Set(withReview.map(\.entry.rank)), [100, 101])
    }
}
