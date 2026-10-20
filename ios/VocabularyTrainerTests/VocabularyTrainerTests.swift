import XCTest
@testable import VocabularyTrainer

final class VocabularyTrainerTests: XCTestCase {
    func testCSVParserHandlesQuotedCommasAndNewlines() {
        let text = "a,b,c\n1,\"two, too\",3\n4,\"five\nfive\",6"
        let rows = CSVParser.rows(from: text)

        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[1][1], "two, too")
        XCTAssertEqual(rows[2][1], "five\nfive")
    }

    func testRepositoryUsesEnglishAndHebrewColumns() {
        let csv = "Rank,B,C,D,E,F,G,H,I\n1,x,the,x,x,x,x,1 the,את\n2,x,of,x,x,x,x,2 of,של"
        let entries = VocabularyRepository.entries(fromCSV: csv)

        XCTAssertEqual(entries.map(\.english), ["the", "of"])
        XCTAssertEqual(entries.map(\.hebrew), ["את", "של"])
    }

    func testQuizCreatesFourUniqueAnswers() {
        let entries = [
            VocabularyEntry(rank: 1, english: "one", hebrew: "אחד"),
            VocabularyEntry(rank: 2, english: "two", hebrew: "שתיים"),
            VocabularyEntry(rank: 3, english: "three", hebrew: "שלוש"),
            VocabularyEntry(rank: 4, english: "four", hebrew: "ארבע")
        ]

        let questions = QuizEngine.makeSession(entries: entries, progress: [:], count: 4)

        XCTAssertEqual(questions.count, 4)
        XCTAssertTrue(questions.allSatisfy { $0.options.count == 4 })
        XCTAssertTrue(questions.allSatisfy { Set($0.options).count == 4 })
        XCTAssertTrue(questions.allSatisfy { $0.options.contains($0.correctAnswer) })
    }

    func testPreviouslyMissedWordIsPrioritized() {
        let entries = (1...5).map {
            VocabularyEntry(rank: $0, english: "word\($0)", hebrew: "תרגום\($0)")
        }
        var missed = WordProgress()
        missed.attempts = 1
        missed.nextReview = .distantPast

        let questions = QuizEngine.makeSession(
            entries: entries,
            progress: [entries[4].id: missed],
            count: 1
        )

        XCTAssertEqual(questions.first?.entry, entries[4])
    }
}

final class LevelBandRulesTests: XCTestCase {
    func testMembershipUsesOriginalRanksAndPreservesGaps() {
        for (rank, band) in [(1, 1), (100, 1), (101, 2), (200, 2), (201, 3), (9999, 100), (10000, 100)] {
            XCTAssertTrue(LevelBandRules.contains(rank: rank, band: band))
            XCTAssertFalse(LevelBandRules.contains(rank: rank, band: band + 1))
        }
        XCTAssertFalse(LevelBandRules.contains(rank: 101, band: 1))
        XCTAssertFalse(LevelBandRules.contains(rank: 0, band: 1))
        XCTAssertFalse(LevelBandRules.contains(rank: 1, band: 0))
        XCTAssertEqual(LevelBandRules.maximumBand(highestRank: 100), 1)
        XCTAssertEqual(LevelBandRules.maximumBand(highestRank: 101), 2)
        XCTAssertEqual(LevelBandRules.maximumBand(highestRank: 10000), 100)
    }

    func testNinePerfectAnswersCannotAdvance() {
        var bands = WebSyncBands()
        for _ in 0..<9 {
            bands = LevelBandRules.recording(correct: true, rank: 100, in: bands, maximumBand: 100)
        }
        XCTAssertEqual(bands.current, 1)
        XCTAssertEqual(bands.recent, Array(repeating: 1, count: 9))
    }

    func testExactlySevenOfTenAdvancesOneBandAndClearsWindow() {
        var bands = WebSyncBands()
        bands.recent = Array(repeating: 1, count: 6) + Array(repeating: 0, count: 3)
        bands.extra["future"] = .string("preserved")
        let promoted = LevelBandRules.recording(correct: true, rank: 100, in: bands, maximumBand: 100)
        XCTAssertEqual(promoted.current, 2)
        XCTAssertEqual(promoted.recent, [])
        XCTAssertEqual(promoted.extra, bands.extra)
    }

    func testRollingWindowDropsOldestAndAdvancesAtSevenOfTen() {
        var bands = WebSyncBands()
        bands.recent = Array(repeating: 0, count: 5) + Array(repeating: 1, count: 4)
        bands = LevelBandRules.recording(correct: true, rank: 1, in: bands, maximumBand: 100)
        XCTAssertEqual(bands.current, 1) // 5/10 stays below 7.
        XCTAssertEqual(bands.recent, Array(repeating: 0, count: 5) + Array(repeating: 1, count: 5))
        bands = LevelBandRules.recording(correct: true, rank: 1, in: bands, maximumBand: 100)
        XCTAssertEqual(bands.current, 1) // 6/10 still below 7.
        XCTAssertEqual(bands.recent, Array(repeating: 0, count: 4) + Array(repeating: 1, count: 6))
        bands = LevelBandRules.recording(correct: true, rank: 1, in: bands, maximumBand: 100)
        XCTAssertEqual(bands.current, 2) // Oldest 0 drops out: 7/10 advances.
        XCTAssertEqual(bands.recent, [])
    }

    func testFinalBandNeverAdvancesButStillKeepsLatestTenAnswersInOrder() {
        var bands = WebSyncBands()
        bands.current = 100
        for answer in 0..<75 {
            bands = LevelBandRules.recording(correct: answer % 5 != 0, rank: 10000, in: bands, maximumBand: 100)
        }
        XCTAssertEqual(bands.current, 100)
        XCTAssertEqual(bands.recent, (65..<75).map { $0 % 5 != 0 ? 1 : 0 })
    }

    func testOtherBandAnswersCannotChangeOrPromoteCurrentBand() {
        var bands = WebSyncBands()
        bands.current = 2
        bands.recent = Array(repeating: 1, count: 29)
        XCTAssertEqual(LevelBandRules.recording(correct: true, rank: 100, in: bands, maximumBand: 100), bands)
        XCTAssertEqual(LevelBandRules.recording(correct: false, rank: 201, in: bands, maximumBand: 100), bands)
    }

    func testNonpositiveSessionLengthsAreEmpty() {
        let entries = (1...4).map { VocabularyEntry(rank: $0, english: "word\($0)", hebrew: "translation\($0)") }
        for count in [0, -1] {
            XCTAssertTrue(QuizEngine.makeSession(entries: entries, progress: [:], count: count).isEmpty)
        }
    }
    func testThousandPlacementUsesUniqueWordsAndOriginalRankRange() {
        let entries = (1...2000).map { VocabularyEntry(rank: $0, english: "w\($0)", hebrew: "t\($0)") }
        for band in [1, 5, 10, 11, 20] {
            let sample = ThousandPlacement.sample(entries: entries, band: band)
            let thousand = (band - 1) / 10
            XCTAssertEqual(sample.count, 100)
            XCTAssertEqual(Set(sample.map(\.id)).count, 100)
            XCTAssertTrue(sample.allSatisfy { $0.rank > thousand * 1000 && $0.rank <= (thousand + 1) * 1000 })
        }
        XCTAssertTrue(ThousandPlacement.sample(entries: Array(entries.prefix(99)), band: 1).isEmpty)
        XCTAssertTrue(ThousandPlacement.sample(entries: Array(repeating: entries[0], count: 110), band: 1).isEmpty)
    }

    func testThousandPlacementRequiresCompleteTestAndSeventyCorrect() {
        XCTAssertEqual(ThousandPlacement.target(startBand: 5, currentBand: 5, answered: 100, correct: 70, maximumBand: 100), 11)
        XCTAssertNil(ThousandPlacement.target(startBand: 5, currentBand: 5, answered: 100, correct: 69, maximumBand: 100))
        XCTAssertNil(ThousandPlacement.target(startBand: 5, currentBand: 5, answered: 99, correct: 99, maximumBand: 100))
        XCTAssertNil(ThousandPlacement.target(startBand: 5, currentBand: 6, answered: 100, correct: 100, maximumBand: 100))
        XCTAssertNil(ThousandPlacement.target(startBand: 95, currentBand: 95, answered: 100, correct: 100, maximumBand: 100))
    }

    @MainActor
    func testPlacementViewModelPromotesOnlyAtCompletionWithoutWritingWordProgress() {
        let suite = "placement-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ProgressStore(defaults: defaults)
        let entries = (1...1100).map { VocabularyEntry(rank: $0, english: "w\($0)", hebrew: "t\($0)") }
        store.registerVocabulary(entries)
        let model = QuizViewModel(entries: entries, sessionLength: 10, progressStore: store, placement: true)
        XCTAssertEqual(model.questions.count, 100)
        for index in 0..<100 {
            if index < 70 { model.choose(model.currentQuestion!.correctAnswer) }
            else { model.markUnknown() }
            XCTAssertEqual(store.currentBand, 1)
            if index == 99 { break }
            model.advance()
        }
        model.advance()
        XCTAssertTrue(model.placementPassed)
        XCTAssertEqual(store.currentBand, 11)
        XCTAssertTrue(store.progress.isEmpty)
        XCTAssertEqual(store.snapshot.state.stats.attempts, 0)
        XCTAssertTrue(store.snapshot.state.bands.recent.isEmpty)
        let reopened = ProgressStore(defaults: defaults)
        XCTAssertEqual(reopened.currentBand, 11)
    }

}
