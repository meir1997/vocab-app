import Foundation

struct VocabularyEntry: Codable, Hashable, Identifiable, Sendable {
    let rank: Int
    let english: String
    let hebrew: String

    var id: String { english.lowercased() }
}

struct WordProgress: Codable, Hashable, Sendable {
    var attempts = 0
    var successes = 0
    var consecutiveCorrect = 0
    var nextReview = Date.distantPast

    var isLearned: Bool {
        consecutiveCorrect >= 3
    }
}
