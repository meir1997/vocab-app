import SwiftUI

@main
struct VocabularyTrainerApp: App {
    @StateObject private var repository = VocabularyRepository()
    @StateObject private var progressStore = ProgressStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(repository)
                .environmentObject(progressStore)
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "he_IL"))
                .task {
                    await repository.load()
                }
        }
    }
}
