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

    let isPlacement: Bool
    let startBand: Int
    @Published private(set) var placementPassed = false

    private let progressStore: ProgressStore
    private let accountUID: String?

    init(entries: [VocabularyEntry], sessionLength: Int, progressStore: ProgressStore, placement: Bool = false) {
        self.progressStore = progressStore
        self.accountUID = progressStore.currentUID
        self.isPlacement = placement
        self.startBand = progressStore.currentBand
        questions = placement ? QuizEngine.makePlacement(entries: entries, band: progressStore.currentBand) : QuizEngine.makeSession(
            entries: entries,
            progress: progressStore.progress,
            count: sessionLength,
            currentBand: progressStore.currentBand
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
        guard progressStore.currentUID == accountUID, selectedAnswer == nil, let question = currentQuestion else { return }
        selectedAnswer = answer

        if answer == question.correctAnswer {
            lastResult = .correct
            correctCount += 1
            streak += 1
            if !isPlacement { progressStore.record(.correct, for: question.entry) }
        } else {
            lastResult = .incorrect
            streak = 0
            if !isPlacement { progressStore.record(.incorrect, for: question.entry) }
        }
    }

    func markUnknown() {
        guard progressStore.currentUID == accountUID, selectedAnswer == nil, let question = currentQuestion else { return }
        selectedAnswer = ""
        lastResult = .unknown
        streak = 0
        if !isPlacement { progressStore.record(.unknown, for: question.entry) }
    }

    func advance() {
        guard progressStore.currentUID == accountUID, selectedAnswer != nil else { return }
        currentIndex += 1
        if isPlacement, isComplete, let target = ThousandPlacement.target(
            startBand: startBand, currentBand: progressStore.currentBand,
            answered: currentIndex, correct: correctCount, maximumBand: progressStore.maxBand
        ) {
            progressStore.setBand(target)
            placementPassed = true
        }
        selectedAnswer = nil
        lastResult = nil
    }
}
