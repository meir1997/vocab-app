import SwiftUI

struct RootView: View {
    @EnvironmentObject private var repository: VocabularyRepository
    @EnvironmentObject private var progressStore: ProgressStore

    @State private var isPracticing = false
    @State private var sessionLength = 10

    var body: some View {
        NavigationStack {
            if isPracticing {
                QuizView(
                    entries: repository.entries,
                    sessionLength: sessionLength,
                    progressStore: progressStore,
                    onClose: { isPracticing = false }
                )
            } else {
                HomeView(isPracticing: $isPracticing, sessionLength: $sessionLength)
            }
        }
        .tint(.indigo)
    }
}
