import Foundation

struct QuizQuestion: Identifiable, Equatable {
    let entry: VocabularyEntry
    let options: [String]

    var id: String { entry.id }
    var correctAnswer: String { entry.hebrew }
}

/// Shared with ProgressStore so queue selection and promotion use app.js rules.
/// Bands use source ranks, including gaps left by duplicate vocabulary rows.
enum LevelBandRules {
    static let wordsPerBand = 100
    static let windowSize = 50
    static let minimumAnswers = 30

    static func contains(rank: Int, band: Int) -> Bool {
        guard rank > 0, band > 0 else { return false }
        return (rank - 1) / wordsPerBand == band - 1
    }

    static func maximumBand(highestRank: Int) -> Int {
        guard highestRank > 0 else { return 1 }
        return (highestRank - 1) / wordsPerBand + 1
    }

    static func recording(
        correct: Bool, rank: Int, in bands: WebSyncBands, maximumBand: Int
    ) -> WebSyncBands {
        // Due reviews from other bands still update word progress, but cannot
        // contribute to the current band's accuracy or promote it.
        guard contains(rank: rank, band: bands.current) else { return bands }
        var result = bands
        result.recent = Array((bands.recent + [correct ? 1 : 0]).suffix(windowSize))
        let correctAnswers = result.recent.reduce(0, +)
        // Integer arithmetic makes exactly 70% stay in the current band.
        if result.current < maximumBand, result.recent.count >= minimumAnswers,
           correctAnswers * 10 > result.recent.count * 7 {
            result.current += 1
            result.recent = []
        }
        return result
    }
}

enum QuizEngine {
    static func makeSession(
        entries: [VocabularyEntry],
        progress: [String: WordProgress],
        count: Int,
        currentBand: Int = 1,
        now: Date = Date()
    ) -> [QuizQuestion] {
        guard entries.count >= 4, count > 0 else { return [] }

        let due = entries.filter {
            isDue($0, progress: progress[$0.id], currentBand: currentBand, now: now)
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
            selected.append(contentsOf: entries.filter { LevelBandRules.contains(rank: $0.rank, band: currentBand) && !selectedIDs.contains($0.id) }.prefix(count - selected.count))
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

    static func isDue(
        _ entry: VocabularyEntry, progress: WordProgress?, currentBand: Int, now: Date
    ) -> Bool {
        (progress?.nextReview ?? .distantPast) <= now &&
        isEligible(entry, progress: progress, currentBand: currentBand, now: now)
    }

    /// Fixed-length sessions may fill with any current-band word. Outside the
    /// band, only previously answered words whose review is due are eligible.
    static func isEligible(
        _ entry: VocabularyEntry, progress: WordProgress?, currentBand: Int, now: Date
    ) -> Bool {
        LevelBandRules.contains(rank: entry.rank, band: currentBand) ||
        ((progress?.attempts ?? 0) > 0 && (progress?.nextReview ?? .distantPast) <= now)
    }

    private static func priority(of progress: WordProgress) -> Int {
        if progress.attempts > 0, progress.consecutiveCorrect == 0 { return 0 }
        if progress.attempts == 0 { return 1 }
        return 2
    }
}
