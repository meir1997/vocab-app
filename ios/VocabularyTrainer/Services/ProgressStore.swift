import Foundation
import Combine

@MainActor
final class ProgressStore: ObservableObject {
    @Published private(set) var progress: [String: WordProgress]

    private let defaults: UserDefaults
    private let storageKey = "wordProgress.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: storageKey),
           let stored = try? JSONDecoder().decode([String: WordProgress].self, from: data) {
            progress = stored
        } else {
            progress = [:]
        }
    }

    func value(for entry: VocabularyEntry) -> WordProgress {
        progress[entry.id] ?? WordProgress()
    }

    func record(_ result: AnswerResult, for entry: VocabularyEntry, now: Date = Date()) {
        var value = progress[entry.id] ?? WordProgress()
        value.attempts += 1

        switch result {
        case .correct:
            value.successes += 1
            value.consecutiveCorrect += 1
            let intervals = [1, 3, 7, 14, 30]
            let index = min(value.consecutiveCorrect - 1, intervals.count - 1)
            value.nextReview = Calendar.current.date(byAdding: .day, value: intervals[index], to: now) ?? now
        case .incorrect, .unknown:
            value.consecutiveCorrect = 0
            value.nextReview = now
        }

        progress[entry.id] = value
        persist()
    }

    var learnedCount: Int {
        progress.values.filter(\.isLearned).count
    }

    var totalAttempts: Int {
        progress.values.reduce(0) { $0 + $1.attempts }
    }

    var accuracy: Int {
        let attempts = totalAttempts
        guard attempts > 0 else { return 0 }
        let successes = progress.values.reduce(0) { $0 + $1.successes }
        return Int((Double(successes) / Double(attempts) * 100).rounded())
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(progress) else { return }
        defaults.set(data, forKey: storageKey)
    }
}

enum AnswerResult: Equatable, Sendable {
    case correct
    case incorrect
    case unknown
}
