import Foundation
import Combine

@MainActor
final class ProgressStore: ObservableObject {
    @Published private(set) var progress: [String: WordProgress] = [:]
    @Published private(set) var revision = 0
    @Published private(set) var currentUID: String?
    @Published private(set) var snapshot = WebSyncDocument()
    @Published private(set) var hasPendingChanges = false

    private struct SavedAccount: Codable {
        var document: WebSyncDocument
        var pending: Bool
        var revision: Int
        var settingsRevision: Int?
    }

    private let defaults: UserDefaults
    private var canonicalWords: [String: String] = [:]
    private var highestRank = 10_000
    private var lastSettingsRevision = 0
    private let prefix = "fourWords.sync.v1."

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        migrateLegacyProgressOnce()
        loadAccount(uid: nil)
    }

    var currentBand: Int { snapshot.state.bands.current }
    var maxBand: Int { LevelBandRules.maximumBand(highestRank: highestRank) }

    func dueCount(in entries: [VocabularyEntry], now: Date = Date()) -> Int {
        entries.filter {
            QuizEngine.isDue($0, progress: progress[$0.id], currentBand: currentBand, now: now)
        }.count
    }

    func sessionCount(in entries: [VocabularyEntry], now: Date = Date()) -> Int {
        guard entries.count >= 4 else { return 0 }
        let due = dueCount(in: entries, now: now)
        guard let requested = snapshot.state.settings.sessionLength else { return due }
        // The numeric web session can fill from the current band, but it must
        // never introduce a new word outside the selected hundred.
        let eligible = entries.filter {
            QuizEngine.isEligible($0, progress: progress[$0.id], currentBand: currentBand, now: now)
        }.count
        return min(max(0, requested), eligible)
    }

    /// Registering the bundled vocabulary also repairs old lowercase identities.
    /// Unknown cloud words are kept in the canonical document for round trips.
    func registerVocabulary(_ entries: [VocabularyEntry]) {
        canonicalWords = Dictionary(entries.map { ($0.id, $0.english) }, uniquingKeysWith: { first, _ in first })
        highestRank = entries.map(\.rank).max() ?? 10_000
        var normalized: [String: WebWordProgress] = [:]
        for (word, value) in snapshot.state.progress {
            let canonical = canonicalWords[word.lowercased()] ?? word
            normalized[canonical] = normalized[canonical].map {
                WebWordProgress.merging(local: $0, remote: value)
            } ?? value
        }
        if normalized != snapshot.state.progress {
            snapshot.state.progress = normalized
            changed()
        } else { projectProgress() }
    }

    /// Each UID gets independent durable state. Guest progress is claimed once,
    /// by the first signed-in UID, never by later accounts on this installation.
    func activateAccount(uid: String?) {
        guard uid != currentUID else { return }
        persist()
        let guest = loadSaved(uid: nil)?.document ?? WebSyncDocument()
        loadAccount(uid: uid)
        if let uid, defaults.string(forKey: prefix + "guestClaimedBy") == nil {
            defaults.set(uid, forKey: prefix + "guestClaimedBy")
            let merged = WebSyncDocument.merging(local: snapshot, remote: guest)
            if merged != snapshot {
                snapshot = merged
                hasPendingChanges = true
            }
        }
        // The revision is also an observation signal for transport/UI. UID
        // generation checking remains the coordinator's responsibility.
        revision += 1
        normalizeCurrentAccount()
        persist()
    }

    func value(for entry: VocabularyEntry) -> WordProgress {
        progress[entry.id] ?? WordProgress()
    }

    func record(_ result: AnswerResult, for entry: VocabularyEntry, now: Date = Date()) {
        let key = canonicalWords[entry.id] ?? entry.english
        var value = snapshot.state.progress[key] ?? WebWordProgress()
        let correct = result == .correct
        let milliseconds = max(0, (now.timeIntervalSince1970 * 1_000).rounded(.down))
        if correct {
            value.r += 1; value.s += 1
            let intervals = [1, 3, 7, 14, 30]
            value.next = milliseconds + Double(intervals[min(value.s - 1, 4)]) * 86_400_000
        } else {
            value.w += 1; value.s = 0
            value.next = milliseconds
        }
        snapshot.state.progress[key] = value
        snapshot.state.stats.attempts += 1
        if correct { snapshot.state.stats.correct += 1 }
        let dayKey = Self.dayKey(now)
        var day = snapshot.state.stats.days[dayKey] ?? WebDayStats()
        day.a += 1
        if correct { day.c += 1 }
        snapshot.state.stats.days[dayKey] = day

        // Keep the web-compatible fw.bands value in the same durable snapshot
        // as word progress; changed() queues it for the existing cloud sync.
        snapshot.state.bands = LevelBandRules.recording(
            correct: correct, rank: entry.rank, in: snapshot.state.bands, maximumBand: maxBand
        )
        changed()
    }

    func setSessionLength(_ length: Int, now: Date = Date()) {
        guard length > 0, snapshot.state.settings.length != .count(length) else { return }
        snapshot.state.settings.length = .count(length)
        settingsChanged(now: now)
    }

    func setAllDueSession(now: Date = Date()) {
        guard snapshot.state.settings.length != .all else { return }
        snapshot.state.settings.length = .all
        settingsChanged(now: now)
    }

    func setGoal(_ goal: Int, now: Date = Date()) {
        guard goal > 0, snapshot.state.settings.goal != goal else { return }
        snapshot.state.settings.goal = goal
        settingsChanged(now: now)
    }

    func setMode(_ mode: String, now: Date = Date()) {
        guard snapshot.state.settings.mode != mode else { return }
        snapshot.state.settings.mode = mode
        settingsChanged(now: now)
    }

    func setBand(_ band: Int) {
        let band = min(max(1, band), maxBand)
        guard snapshot.state.bands.current != band else { return }
        if (snapshot.state.bands.current - 1) / 10 != (band - 1) / 10 { snapshot.state.bands.thousandRecent = [] }
        snapshot.state.bands.current = band
        snapshot.state.bands.recent = []
        changed()
    }

    /// A remote record only causes an upload when the union contains native
    /// data the remote document is missing. Identical snapshots never echo.
    func applyRemote(_ document: WebSyncDocument) {
        let merged = WebSyncDocument.merging(local: snapshot, remote: document)
        let prior = snapshot
        snapshot = merged
        hasPendingChanges = Self.hasUnwrittenContent(merged, comparedTo: document)
        if prior != snapshot { revision += 1 }
        projectProgress()
        persist()
    }

    /// Merge the transaction's actual result so concurrent web changes become
    /// visible. A later local answer cannot be cleared by an older write ack.
    func acknowledge(_ document: WebSyncDocument, capturedRevision: Int) {
        let unchanged = capturedRevision == revision
        let laterSettings = lastSettingsRevision > capturedRevision ? snapshot.state.settings : nil
        var merged = WebSyncDocument.merging(local: snapshot, remote: document)
        if let laterSettings, laterSettings != document.state.settings {
            merged.state.settings = laterSettings
            merged.updatedAt = max(merged.updatedAt.rounded(.up), (document.updatedAt + 1).rounded(.up))
        }
        snapshot = merged
        hasPendingChanges = !unchanged && Self.hasUnwrittenContent(merged, comparedTo: document)
        projectProgress()
        persist()
    }

    var learnedCount: Int { progress.values.filter(\.isLearned).count }
    var totalAttempts: Int { snapshot.state.stats.attempts }
    var accuracy: Int {
        guard totalAttempts > 0 else { return 0 }
        return Int((Double(snapshot.state.stats.correct) / Double(totalAttempts) * 100).rounded())
    }

    private func settingsChanged(now: Date) {
        snapshot.updatedAt = max((snapshot.updatedAt + 1).rounded(.up), (now.timeIntervalSince1970 * 1_000).rounded(.down))
        snapshot.settingsPresent = true
        lastSettingsRevision = revision + 1
        changed()
    }

    private func changed() {
        hasPendingChanges = true
        revision += 1
        projectProgress()
        persist()
    }

    private func normalizeCurrentAccount() {
        var normalized: [String: WebWordProgress] = [:]
        for (word, value) in snapshot.state.progress {
            let canonical = canonicalWords[word.lowercased()] ?? word
            normalized[canonical] = normalized[canonical].map {
                WebWordProgress.merging(local: $0, remote: value)
            } ?? value
        }
        if normalized != snapshot.state.progress {
            snapshot.state.progress = normalized
            hasPendingChanges = true
        }
        projectProgress()
    }

    private func projectProgress() {
        var result: [String: WordProgress] = [:]
        for (word, value) in snapshot.state.progress {
            let key = word.lowercased()
            let previous = result[key].map(WebWordProgress.init(local:))
            result[key] = previous.map { WebWordProgress.merging(local: $0, remote: value).local } ?? value.local
        }
        progress = result
    }

    private static func hasUnwrittenContent(_ local: WebSyncDocument, comparedTo remote: WebSyncDocument) -> Bool {
        local.state != remote.state || local.extra != remote.extra
    }

    private func key(uid: String?) -> String {
        guard let uid else { return prefix + "guest" }
        return prefix + "uid." + Data(uid.utf8).base64EncodedString()
    }

    private func loadSaved(uid: String?) -> SavedAccount? {
        guard let data = defaults.data(forKey: key(uid: uid)) else { return nil }
        return try? JSONDecoder().decode(SavedAccount.self, from: data)
    }

    private func loadAccount(uid: String?) {
        let saved = loadSaved(uid: uid)
        currentUID = uid
        snapshot = saved?.document ?? WebSyncDocument()
        hasPendingChanges = saved?.pending ?? false
        revision = max(revision, saved?.revision ?? 0)
        lastSettingsRevision = saved?.settingsRevision ?? 0
        projectProgress()
    }

    private func persist() {
        let saved = SavedAccount(document: snapshot, pending: hasPendingChanges, revision: revision, settingsRevision: lastSettingsRevision)
        guard let data = try? JSONEncoder().encode(saved) else { return }
        defaults.set(data, forKey: key(uid: currentUID))
    }

    private func migrateLegacyProgressOnce() {
        let marker = prefix + "legacyMigrated"
        guard !defaults.bool(forKey: marker) else { return }
        if loadSaved(uid: nil) == nil,
           let data = defaults.data(forKey: "wordProgress.v1"),
           let legacy = try? JSONDecoder().decode([String: WordProgress].self, from: data) {
            var document = WebSyncDocument()
            document.state.progress = legacy.mapValues(WebWordProgress.init(local:))
            document.state.stats.attempts = document.state.progress.values.reduce(0) { $0 + $1.attempts }
            document.state.stats.correct = document.state.progress.values.reduce(0) { $0 + $1.r }
            let saved = SavedAccount(document: document, pending: document.hasContent, revision: 1, settingsRevision: 0)
            if let encoded = try? JSONEncoder().encode(saved) { defaults.set(encoded, forKey: key(uid: nil)) }
        }
        defaults.set(true, forKey: marker)
    }

    private static func dayKey(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year ?? 1970, components.month ?? 1, components.day ?? 1)
    }
}

enum AnswerResult: Equatable, Sendable { case correct, incorrect, unknown }
