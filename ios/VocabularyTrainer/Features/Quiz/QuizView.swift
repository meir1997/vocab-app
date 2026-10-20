import SwiftUI
import UIKit

struct QuizView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .largeTitle) private var wordFontSize: CGFloat = 46

    @StateObject private var viewModel: QuizViewModel
    @AccessibilityFocusState private var accessibilityFocus: FocusTarget?
    let onClose: () -> Void

    private enum FocusTarget: Hashable {
        case word, feedback, completion
    }

    init(entries: [VocabularyEntry], sessionLength: Int, progressStore: ProgressStore, onClose: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: QuizViewModel(
            entries: entries,
            sessionLength: sessionLength,
            progressStore: progressStore
        ))
        self.onClose = onClose
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if viewModel.questions.isEmpty {
                emptyState
            } else if viewModel.isComplete {
                completion
            } else if let question = viewModel.currentQuestion {
                questionContent(question)
            }
        }
        .background(WordTheme.canvas)
        .foregroundStyle(WordTheme.ink)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if viewModel.selectedAnswer != nil, !viewModel.isComplete {
                continueButton
            }
        }
        .navigationBarBackButtonHidden()
        .onChange(of: viewModel.currentIndex) { _, _ in
            accessibilityFocus = viewModel.isComplete ? .completion : .word
        }
        .onChange(of: viewModel.lastResult) { _, result in
            if result != nil {
                accessibilityFocus = .feedback
            }
        }
    }

    private var topBar: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(WordTheme.ink)
                        .frame(width: 48, height: 48)
                        .background(WordTheme.paper, in: Circle())
                        .overlay {
                            Circle().stroke(WordTheme.line, lineWidth: 1)
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("חזרה למסך הראשי")
                .accessibilityHint("התשובות שכבר נענו נשמרות")

                if !viewModel.isComplete {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("רגע למילים")
                            .font(.subheadline.weight(.semibold))
                        Text("שאלה \(viewModel.currentIndex + 1) מתוך \(viewModel.questions.count)")
                            .font(.caption)
                            .foregroundStyle(WordTheme.muted)
                            .monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                }
                Spacer(minLength: 0)
                Image(systemName: "leaf")
                    .font(.title3)
                    .foregroundStyle(WordTheme.forest)
                    .accessibilityHidden(true)
            }

            ProgressView(value: answeredProgress)
                .tint(WordTheme.forest)
                .accessibilityLabel("התקדמות התרגול")
                .accessibilityValue("\(answeredCount) תשובות מתוך \(viewModel.questions.count)")
        }
        .frame(maxWidth: 640)
        .padding(.horizontal, 22)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
    }

    private func questionContent(_ question: QuizQuestion) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(spacing: 12) {
                        Text("מה התרגום של המילה?")
                            .font(.subheadline)
                            .foregroundStyle(WordTheme.muted)
                        Text(englishWord(question.entry.english))
                            .font(.system(size: wordFontSize, weight: .semibold, design: .serif))
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .environment(\.layoutDirection, .leftToRight)
                            .accessibilityFocused($accessibilityFocus, equals: .word)
                        Text("מילה מספר \(question.entry.rank) לפי שכיחות")
                            .font(.caption)
                            .foregroundStyle(WordTheme.muted)
                    }
                    .frame(maxWidth: .infinity, minHeight: 158)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 26)
                    .background(WordTheme.paper, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(WordTheme.line, lineWidth: 1)
                    }
                    .id("question")

                    VStack(alignment: .leading, spacing: 12) {
                        Text(viewModel.selectedAnswer == nil ? "בוחרים תרגום אחד" : "התשובה נשמרה")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(WordTheme.muted)
                            .padding(.horizontal, 4)

                        ForEach(Array(question.options.enumerated()), id: \.element) { index, option in
                            answerButton(option, number: index + 1, question: question)
                        }
                    }

                    if viewModel.selectedAnswer == nil {
                        Button {
                            viewModel.markUnknown()
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "questionmark.circle")
                                    .accessibilityHidden(true)
                                Text("לא בטוחים? הצגת התשובה")
                                    .multilineTextAlignment(.leading)
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(WordTheme.muted)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 12)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("מסמן שהמילה עדיין לא מוכרת ומציג את התרגום הנכון")
                    } else {
                        feedback(question)
                            .id("feedback")
                    }
                }
                .frame(maxWidth: 640)
                .padding(.horizontal, 22)
                .padding(.top, 10)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .onChange(of: viewModel.currentIndex) { _, _ in
                proxy.scrollTo("question", anchor: .top)
            }
            .onChange(of: viewModel.lastResult) { _, result in
                guard result != nil else { return }
                if reduceMotion {
                    proxy.scrollTo("feedback", anchor: .bottom)
                } else {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("feedback", anchor: .bottom)
                    }
                }
            }
        }
    }

    private func answerButton(_ option: String, number: Int, question: QuizQuestion) -> some View {
        Button {
            viewModel.choose(option)
        } label: {
            HStack(spacing: 12) {
                Text(option)
                    .font(.body.weight(.semibold))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if let icon = answerIcon(option, question: question) {
                    Image(systemName: icon)
                        .font(.title3)
                        .accessibilityHidden(true)
                } else {
                    Text(number.formatted())
                        .font(.caption.weight(.semibold))
                        .frame(width: 28, height: 28)
                        .background(WordTheme.canvas, in: Circle())
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(answerForeground(option, question: question))
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, minHeight: 62)
            .background(answerBackground(option, question: question), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(answerBorder(option, question: question), lineWidth: 1.5)
            }
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(viewModel.selectedAnswer != nil)
        .accessibilityLabel(option)
        .accessibilityValue(answerAccessibilityValue(option, question: question))
        .accessibilityHint(viewModel.selectedAnswer == nil ? "בחירת התרגום ושמירת התשובה" : "")
    }

    private func feedback(_ question: QuizQuestion) -> some View {
        let isCorrect = viewModel.lastResult == .correct
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: isCorrect ? "checkmark.circle.fill" : "lightbulb")
                .font(.title2)
                .foregroundStyle(isCorrect ? WordTheme.forest : WordTheme.coral)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 8) {
                Text(feedbackTitle)
                    .font(.headline)
                Text("התרגום הנכון: \(question.correctAnswer)")
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
                if !isCorrect {
                    Text("נפגוש את המילה שוב בתרגולים הבאים.")
                        .font(.footnote)
                        .foregroundStyle(WordTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isCorrect ? WordTheme.softGreen : WordTheme.softCoral, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityFocused($accessibilityFocus, equals: .feedback)
    }

    private var continueButton: some View {
        Button(action: viewModel.advance) {
            HStack(spacing: 12) {
                Text(viewModel.currentIndex + 1 == viewModel.questions.count ? "לסיכום התרגול" : "למילה הבאה")
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                Image(systemName: "arrow.left")
                    .accessibilityHidden(true)
            }
        }
        .buttonStyle(WordPrimaryButtonStyle())
        .frame(maxWidth: 640)
        .padding(.horizontal, 22)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .background(WordTheme.canvas)
    }

    private var completion: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: "checkmark.seal")
                    .font(.system(size: 50, weight: .light))
                    .foregroundStyle(WordTheme.forest)
                    .padding(22)
                    .background(WordTheme.softGreen, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 12) {
                    Text("עוד צעד קדימה.")
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($accessibilityFocus, equals: .completion)
                    Text("תרגלתם \(viewModel.questions.count) מילים. כל מפגש כזה הופך את האנגלית לקצת יותר מוכרת.")
                        .font(.body)
                        .foregroundStyle(WordTheme.muted)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                }

                let layout = (dynamicTypeSize >= .xxLarge)
                    ? AnyLayout(VStackLayout(spacing: 12))
                    : AnyLayout(HStackLayout(spacing: 12))

                layout {
                    completionMetric(value: "\(viewModel.correctCount)", label: "תשובות נכונות")
                    completionMetric(value: "\(viewModel.questions.count - viewModel.correctCount)", label: "מילים לחיזוק")
                }

                Label("התשובות נשמרו במכשיר. אפשר לחזור מתי שמתאים.", systemImage: "checkmark.circle")
                    .font(.footnote)
                    .foregroundStyle(WordTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)

                Button(action: onClose) {
                    HStack(spacing: 12) {
                        Text("חזרה למסך הראשי")
                        Spacer(minLength: 8)
                        Image(systemName: "arrow.left")
                            .accessibilityHidden(true)
                    }
                }
                .buttonStyle(WordPrimaryButtonStyle())
            }
            .frame(maxWidth: 640)
            .padding(.horizontal, 24)
            .padding(.vertical, 30)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
    }

    private func completionMetric(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(value)
                .font(.largeTitle.bold())
                .monospacedDigit()
            Text(label)
                .font(.subheadline)
                .foregroundStyle(WordTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(WordTheme.paper, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("אין מספיק מילים לתרגול", systemImage: "text.book.closed")
        } description: {
            Text("כדי לתרגל נדרשות לפחות ארבע מילים. חזרו למסך הראשי ונסו לעדכן את הספרייה.")
        } actions: {
            Button("חזרה למסך הראשי", action: onClose)
                .buttonStyle(WordPrimaryButtonStyle())
        }
    }

    private func englishWord(_ word: String) -> AttributedString {
        AttributedString(
            word,
            attributes: AttributeContainer([.accessibilitySpeechLanguage: "en-US"])
        )
    }

    private var answeredCount: Int {
        min(viewModel.currentIndex + (viewModel.selectedAnswer == nil ? 0 : 1), viewModel.questions.count)
    }

    private var answeredProgress: Double {
        guard !viewModel.questions.isEmpty else { return 0 }
        return Double(answeredCount) / Double(viewModel.questions.count)
    }

    private var feedbackTitle: String {
        switch viewModel.lastResult {
        case .correct: return "בדיוק!"
        case .incorrect: return "עוד הזדמנות ללמוד."
        case .unknown, .none: return "מכאן לומדים."
        }
    }

    private func answerBackground(_ option: String, question: QuizQuestion) -> Color {
        guard let selected = viewModel.selectedAnswer else { return WordTheme.paper }
        if option == question.correctAnswer { return WordTheme.softGreen }
        if option == selected { return WordTheme.softCoral }
        return WordTheme.paper
    }

    private func answerBorder(_ option: String, question: QuizQuestion) -> Color {
        guard let selected = viewModel.selectedAnswer else { return WordTheme.line }
        if option == question.correctAnswer { return WordTheme.forest }
        if option == selected { return WordTheme.coral }
        return WordTheme.line.opacity(0.6)
    }

    private func answerForeground(_ option: String, question: QuizQuestion) -> Color {
        guard viewModel.selectedAnswer != nil else { return WordTheme.ink }
        if option == question.correctAnswer { return WordTheme.forest }
        if option == viewModel.selectedAnswer { return WordTheme.coral }
        return WordTheme.muted
    }

    private func answerIcon(_ option: String, question: QuizQuestion) -> String? {
        guard let selected = viewModel.selectedAnswer else { return nil }
        if option == question.correctAnswer { return "checkmark.circle.fill" }
        if option == selected { return "xmark.circle.fill" }
        return nil
    }

    private func answerAccessibilityValue(_ option: String, question: QuizQuestion) -> String {
        guard let selected = viewModel.selectedAnswer else { return "" }
        if option == question.correctAnswer {
            return option == selected ? "בחרתם בתשובה הנכונה" : "התשובה הנכונה"
        }
        return option == selected ? "התשובה שבחרתם, תשובה שגויה" : ""
    }
}
