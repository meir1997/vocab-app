import SwiftUI

struct QuizView: View {
    @StateObject private var viewModel: QuizViewModel
    let onClose: () -> Void

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
            if viewModel.isComplete {
                completion
            } else if let question = viewModel.currentQuestion {
                questionContent(question)
            } else {
                ContentUnavailableView("אין מספיק מילים לתרגול", systemImage: "text.book.closed")
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationBarBackButtonHidden()
    }

    private var topBar: some View {
        VStack(spacing: 12) {
            HStack {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .frame(width: 40, height: 40)
                        .background(.background, in: Circle())
                }
                .accessibilityLabel("סגירת התרגול")

                Spacer()

                if !viewModel.isComplete {
                    Text("\(min(viewModel.currentIndex + 1, viewModel.questions.count)) מתוך \(viewModel.questions.count)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }

            ProgressView(value: viewModel.isComplete ? 1 : viewModel.progress)
                .tint(.indigo)
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
    }

    private func questionContent(_ question: QuizQuestion) -> some View {
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 8) {
                    Text("מה התרגום של")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(question.entry.english)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .minimumScaleFactor(0.65)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .environment(\.layoutDirection, .leftToRight)
                        .accessibilityLabel("המילה באנגלית: \(question.entry.english)")
                    Text("מילה מספר \(question.entry.rank) לפי שכיחות")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, minHeight: 172)
                .padding(20)
                .background(.background, in: RoundedRectangle(cornerRadius: 28, style: .continuous))

                VStack(spacing: 12) {
                    ForEach(question.options, id: \.self) { option in
                        answerButton(option, question: question)
                    }
                }

                Button {
                    viewModel.markUnknown()
                } label: {
                    Label("לא יודע", systemImage: "questionmark.circle")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.roundedRectangle(radius: 16))
                .tint(.secondary)
                .disabled(viewModel.selectedAnswer != nil)

                if viewModel.selectedAnswer != nil {
                    feedback(question)
                }
            }
            .padding(20)
        }
        .scrollIndicators(.hidden)
    }

    private func answerButton(_ option: String, question: QuizQuestion) -> some View {
        Button {
            viewModel.choose(option)
        } label: {
            HStack(spacing: 12) {
                Text(option)
                    .font(.body.weight(.semibold))
                    .multilineTextAlignment(.leading)
                Spacer()
                if let icon = answerIcon(option, question: question) {
                    Image(systemName: icon)
                        .font(.title3)
                }
            }
            .foregroundStyle(answerForeground(option, question: question))
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(answerBackground(option, question: question), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .stroke(answerBorder(option, question: question), lineWidth: 1.5)
            }
        }
        .buttonStyle(.plain)
        .disabled(viewModel.selectedAnswer != nil)
    }

    private func feedback(_ question: QuizQuestion) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: viewModel.lastResult == .correct ? "checkmark.circle.fill" : "arrow.uturn.backward.circle.fill")
                Text(viewModel.lastResult == .correct ? "מצוין!" : "התשובה היא: \(question.correctAnswer)")
                    .font(.headline)
                Spacer()
            }
            .foregroundStyle(viewModel.lastResult == .correct ? .green : .orange)

            Button(action: viewModel.advance) {
                HStack {
                    Text(viewModel.currentIndex + 1 == viewModel.questions.count ? "סיום" : "למילה הבאה")
                    Spacer()
                    Image(systemName: "arrow.left")
                }
                .font(.headline)
                .padding(.horizontal, 18)
                .frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 16))
            .tint(.indigo)
        }
        .padding(.top, 4)
    }

    private var completion: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "sparkles")
                .font(.system(size: 54))
                .foregroundStyle(.indigo)
            Text("סיימנו להיום")
                .font(.system(size: 32, weight: .bold, design: .rounded))
            Text("\(viewModel.correctCount) תשובות נכונות מתוך \(viewModel.questions.count)")
                .font(.title3)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            Button("חזרה למסך הראשי", action: onClose)
                .font(.headline)
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 16))
                .tint(.indigo)
                .controlSize(.large)
            Spacer()
        }
        .padding(24)
    }

    private func answerBackground(_ option: String, question: QuizQuestion) -> Color {
        guard let selected = viewModel.selectedAnswer else { return Color(.secondarySystemGroupedBackground) }
        if option == question.correctAnswer { return .green.opacity(0.16) }
        if option == selected { return .red.opacity(0.14) }
        return Color(.secondarySystemGroupedBackground).opacity(0.6)
    }

    private func answerBorder(_ option: String, question: QuizQuestion) -> Color {
        guard let selected = viewModel.selectedAnswer else { return Color(.separator).opacity(0.45) }
        if option == question.correctAnswer { return .green }
        if option == selected { return .red }
        return .clear
    }

    private func answerForeground(_ option: String, question: QuizQuestion) -> Color {
        guard viewModel.selectedAnswer != nil else { return .primary }
        if option == question.correctAnswer { return .green }
        if option == viewModel.selectedAnswer { return .red }
        return .secondary
    }

    private func answerIcon(_ option: String, question: QuizQuestion) -> String? {
        guard let selected = viewModel.selectedAnswer else { return nil }
        if option == question.correctAnswer { return "checkmark.circle.fill" }
        if option == selected { return "xmark.circle.fill" }
        return nil
    }
}
