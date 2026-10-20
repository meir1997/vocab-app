import SwiftUI

@main
@MainActor
struct VocabularyTrainerApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var repository: VocabularyRepository
    @StateObject private var progressStore: ProgressStore
    @StateObject private var auth: GoogleAuthManager
    @StateObject private var sync: CloudSyncCoordinator

    init() {
        let repository = VocabularyRepository()
        let progressStore = ProgressStore()
        // Auth validates native configuration before initializing Firebase. The
        // offline app must never call Firestore's default accessor without it.
        let auth = GoogleAuthManager()
        let client = auth.configurationIssue == nil ? FirestoreSyncClient.configured() : nil
        _repository = StateObject(wrappedValue: repository)
        _progressStore = StateObject(wrappedValue: progressStore)
        _auth = StateObject(wrappedValue: auth)
        _sync = StateObject(wrappedValue: CloudSyncCoordinator(store: progressStore, client: client))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(repository)
                .environmentObject(progressStore)
                .environmentObject(auth)
                .environmentObject(sync)
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "he_IL"))
                .onOpenURL { url in _ = auth.handle(url: url) }
                .onReceive(auth.$user) { user in
                    // Canonical source spelling must be registered before a
                    // legacy lowercase progress key can reach the cloud.
                    if user == nil || !repository.entries.isEmpty { sync.setUser(user) }
                }
                .onChange(of: repository.entries) { _, entries in
                    progressStore.registerVocabulary(entries)
                    sync.setUser(auth.user)
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await sync.synchronizeNow() } }
                }
                .task {
                    await repository.load()
                    progressStore.registerVocabulary(repository.entries)
                    sync.setUser(auth.user)
                }
        }
    }
}
