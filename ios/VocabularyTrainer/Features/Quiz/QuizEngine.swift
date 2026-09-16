import Foundation

struct QuizQuestion: Identifiable, Equatable {
    let entry: VocabularyEntry
    let options: [String]

    var id: String { entry.id }
    var correctAnswer: String { entry.hebrew }
}

enum QuizEngine {
    static func makeSession(
        entries: [VocabularyEntry],
        progress: [String: WordProgress],
        count: Int,
        now: Date = Date()
    ) -> [QuizQuestion] {
        guard entries.count >= 4 else { return [] }

        let due = entries.filter { (progress[$0.id]?.nextReview ?? .distantPast) <= now }
        let ordered = due.sorted { lhs, rhs in
            let lhsProgress = progress[lhs.id] ?? WordProgress()
            let rhsProgress = progress[rhs.id] ?? WordProgress()
            let lhsPriority = priority(of: lhsProgress)
            let rhsPriority = priority(of: rhsProgress)
            if lhsPriority != rhsPriority {
                return lhsPriority < rhsPriority
            }
            if lhsProgress.attempts != rhsProgress.attempts {
                return lhsProgress.attempts < rhsProgress.attempts
            }
            return lhs.rank < rhs.rank
        }

        var selected = Array(ordered.prefix(count))
        if selected.count < count {
            let selectedIDs = Set(selected.map(\.id))
            selected.append(contentsOf: entries.filter { !selectedIDs.contains($0.id) }.prefix(count - selected.count))
        }

        return selected.map { entry in
            var seen = Set([entry.hebrew])
            let distractors = entries.shuffled().compactMap { candidate -> String? in
                guard candidate.id != entry.id, seen.insert(candidate.hebrew).inserted else { return nil }
                return candidate.hebrew
            }
            .prefix(3)
            return QuizQuestion(entry: entry, options: ([entry.hebrew] + Array(distractors)).shuffled())
        }
    }

    private static func priority(of progress: WordProgress) -> Int {
        if progress.attempts > 0, progress.consecutiveCorrect == 0 { return 0 }
        if progress.attempts == 0 { return 1 }
        return 2
    }
}
