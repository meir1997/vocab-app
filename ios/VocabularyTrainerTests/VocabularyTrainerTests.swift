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
