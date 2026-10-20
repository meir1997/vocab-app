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
        currentBand: Int = 1,
        now: Date = Date()
    ) -> [QuizQuestion] {
        guard entries.count >= 4 else { return [] }

        let inBand: (VocabularyEntry) -> Bool = { $0.rank >= (currentBand - 1) * 100 + 1 && $0.rank <= currentBand * 100 }
        let due = entries.filter {
            (progress[$0.id]?.nextReview ?? .distantPast) <= now &&
            (inBand($0) || (progress[$0.id]?.attempts ?? 0) > 0)
        }
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
            selected.append(contentsOf: entries.filter { inBand($0) && !selectedIDs.contains($0.id) }.prefix(count - selected.count))
        }

        return selected.map { entry in
            var seen = Set([entry.hebrew])
            var distractors: [String] = []
            // Random probing avoids filtering the entire 9,998-word library
            // for each question in an all-due session. A bounded fallback
            // handles tiny vocabularies or repeated translations.
            for _ in 0..<min(24, entries.count * 2) {
                guard let candidate = entries.randomElement() else { break }
                if candidate.id != entry.id, seen.insert(candidate.hebrew).inserted {
                    distractors.append(candidate.hebrew)
                    if distractors.count == 3 { break }
                }
            }
            if distractors.count < 3 {
                for candidate in entries where candidate.id != entry.id {
                    if seen.insert(candidate.hebrew).inserted { distractors.append(candidate.hebrew) }
                    if distractors.count == 3 { break }
                }
            }
            return QuizQuestion(entry: entry, options: ([entry.hebrew] + distractors).shuffled())
        }
    }

    private static func priority(of progress: WordProgress) -> Int {
        if progress.attempts > 0, progress.consecutiveCorrect == 0 { return 0 }
        if progress.attempts == 0 { return 1 }
        return 2
    }
}
