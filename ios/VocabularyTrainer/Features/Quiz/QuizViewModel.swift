import Foundation
import Combine

@MainActor
final class QuizViewModel: ObservableObject {
    @Published private(set) var questions: [QuizQuestion]
    @Published private(set) var currentIndex = 0
    @Published private(set) var selectedAnswer: String?
    @Published private(set) var lastResult: AnswerResult?
    @Published private(set) var correctCount = 0
    @Published private(set) var streak = 0

    private let progressStore: ProgressStore

    init(entries: [VocabularyEntry], sessionLength: Int, progressStore: ProgressStore) {
        self.progressStore = progressStore
        questions = QuizEngine.makeSession(
            entries: entries,
            progress: progressStore.progress,
            count: sessionLength
        )
    }

    var currentQuestion: QuizQuestion? {
        guard questions.indices.contains(currentIndex) else { return nil }
        return questions[currentIndex]
    }

    var isComplete: Bool {
        currentIndex >= questions.count
    }

    var progress: Double {
        guard !questions.isEmpty else { return 0 }
        return Double(currentIndex) / Double(questions.count)
    }

    func choose(_ answer: String) {
        guard selectedAnswer == nil, let question = currentQuestion else { return }
        selectedAnswer = answer

        if answer == question.correctAnswer {
            lastResult = .correct
            correctCount += 1
            streak += 1
            progressStore.record(.correct, for: question.entry)
        } else {
            lastResult = .incorrect
            streak = 0
            progressStore.record(.incorrect, for: question.entry)
        }
    }

    func markUnknown() {
        guard selectedAnswer == nil, let question = currentQuestion else { return }
        selectedAnswer = ""
        lastResult = .unknown
        streak = 0
        progressStore.record(.unknown, for: question.entry)
    }

    func advance() {
        guard selectedAnswer != nil else { return }
        currentIndex += 1
        selectedAnswer = nil
        lastResult = nil
    }
}
