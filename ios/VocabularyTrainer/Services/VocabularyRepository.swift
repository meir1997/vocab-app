import Foundation
import Combine
import CryptoKit

@MainActor
final class VocabularyRepository: ObservableObject {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    enum Source: Equatable {
        case bundled
        case cache
        case live
    }

    @Published private(set) var entries: [VocabularyEntry] = []
    @Published private(set) var state: State = .idle
    @Published private(set) var source: Source?
    @Published private(set) var isRefreshing = false
    @Published private(set) var refreshMessage: String?
    @Published private(set) var lastUpdated: Date?

    private let sourceURL = URL(string: "https://docs.google.com/spreadsheets/d/1YuNV-TcC_tITIe-SGTzTh-dKTlx4H84-4feTzAM2k4M/export?format=csv&gid=0")!
    private static let minimumEntryCount = 9_998
    private let session: URLSession
    private let fileManager: FileManager
    private let bundle: Bundle
    private let cacheDirectory: URL?

    init(
        session: URLSession = .shared,
        fileManager: FileManager = .default,
        bundle: Bundle = .main,
        cacheDirectory: URL? = nil
    ) {
        self.session = session
        self.fileManager = fileManager
        self.bundle = bundle
        self.cacheDirectory = cacheDirectory
    }

    func load(forceRefresh: Bool = false) async {
        guard !isRefreshing, state != .loading else { return }

        if entries.isEmpty {
            state = .loading
            let bundled = loadBundle()
            let minimumCount = max(Self.minimumEntryCount, bundled?.count ?? 0)
            if let cached = loadCache(minimumCount: minimumCount) {
                entries = cached.entries
                source = .cache
                lastUpdated = cached.updatedAt
                state = .loaded
            } else if let bundled {
                entries = bundled
                source = .bundled
                state = .loaded
            }
        }

        // A complete library is ready on the first launch, including in airplane mode.
        // Explicit refresh avoids holding practice behind network access.
        guard forceRefresh || entries.isEmpty else { return }
        isRefreshing = true
        refreshMessage = nil
        defer { isRefreshing = false }

        do {
            var request = URLRequest(url: sourceURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            request.setValue("text/csv", forHTTPHeaderField: "Accept")
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse,
                  (200..<300).contains(response.statusCode) else {
                throw URLError(.badServerResponse)
            }
            guard let text = String(data: data, encoding: .utf8) else {
                throw CocoaError(.fileReadInapplicableStringEncoding)
            }

            let minimumCount = max(Self.minimumEntryCount, entries.count)
            let parsed = try await Task.detached(priority: .userInitiated) {
                try Self.validatedEntries(fromCSV: text, minimumCount: minimumCount)
            }.value
            try Task.checkCancellation()
            let updatedAt = Date()
            let saved = saveCache(parsed, updatedAt: updatedAt)
            entries = parsed
            source = .live
            lastUpdated = updatedAt
            state = .loaded
            if !saved {
                refreshMessage = "הספרייה עודכנה. לא הצלחנו לשמור את העדכון במכשיר; הספרייה המלאה המקורית תישאר זמינה."
            }
        } catch {
            if !entries.isEmpty {
                state = .loaded
                refreshMessage = "לא ניתן לעדכן כעת. כל המילים שבספרייה זמינות לתרגול."
            } else {
                state = .failed("לא הצלחנו לטעון את ספריית המילים. נסו שוב.")
            }
        }
    }

    nonisolated static func entries(fromCSV text: String) -> [VocabularyEntry] {
        guard let rows = try? CSVParser.parse(text) else { return [] }
        return entries(from: rows)
    }

    nonisolated static func validatedEntries(fromCSV text: String, minimumCount: Int = 9_998) throws -> [VocabularyEntry] {
        let rows = try CSVParser.parse(text)
        guard let header = rows.first, header.count > 8,
              header[0] == "Rank", header[2] == "Word",
              rows.dropFirst().allSatisfy({ row in
                  row.count > 8 &&
                  !row[2].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                  !row[8].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              }) else {
            throw VocabularyError.invalidSource
        }
        var translations: [String: String] = [:]
        for row in rows.dropFirst() {
            let key = row[2].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let translation = row[8].trimmingCharacters(in: .whitespacesAndNewlines)
            if let previous = translations[key], previous != translation {
                throw VocabularyError.invalidSource
            }
            translations[key] = translation
        }
        let parsed = entries(from: rows)
        guard isComplete(parsed, minimumCount: minimumCount) else {
            throw VocabularyError.incompleteLibrary
        }
        return parsed
    }

    nonisolated private static func entries(from rows: [[String]]) -> [VocabularyEntry] {
        var seen: Set<String> = []
        return rows.dropFirst().enumerated().compactMap { offset, row in
            // Preserve the existing C/I mapping, first occurrence and rank/ID behavior.
            guard row.count > 8 else { return nil }
            let english = row[2].trimmingCharacters(in: .whitespacesAndNewlines)
            let hebrew = row[8].trimmingCharacters(in: .whitespacesAndNewlines)
            let key = english.lowercased()
            guard !english.isEmpty, !hebrew.isEmpty, !seen.contains(key) else { return nil }
            seen.insert(key)
            let rank = Int(row.first ?? "") ?? offset + 1
            return VocabularyEntry(rank: rank, english: english, hebrew: hebrew)
        }
        .sorted { $0.rank < $1.rank }
    }

    nonisolated private static func isComplete(_ entries: [VocabularyEntry], minimumCount: Int) -> Bool {
        entries.count >= minimumCount &&
        Set(entries.map(\.id)).count == entries.count &&
        Set(entries.map { $0.english.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }).count == entries.count &&
        entries.allSatisfy {
            $0.rank > 0 &&
            !$0.english.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !$0.hebrew.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func loadBundle() -> [VocabularyEntry]? {
        guard let dataURL = bundle.url(forResource: "vocabulary", withExtension: "json"),
              let manifestURL = bundle.url(forResource: "vocabulary-manifest", withExtension: "json"),
              let data = try? Data(contentsOf: dataURL),
              let manifestData = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(BundleManifest.self, from: manifestData),
              manifest.schemaVersion == 1,
              manifest.entryCount >= Self.minimumEntryCount,
              SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == manifest.sha256,
              let decoded = try? JSONDecoder().decode([VocabularyEntry].self, from: data),
              decoded.count == manifest.entryCount,
              Self.isComplete(decoded, minimumCount: Self.minimumEntryCount) else { return nil }
        return decoded
    }

    private var cacheURL: URL? {
        let directory = cacheDirectory ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("VocabularyTrainer", isDirectory: true)
        return directory?.appendingPathComponent("vocabulary.json")
    }

    private func loadCache(minimumCount: Int) -> CachedLibrary? {
        guard let cacheURL, let data = try? Data(contentsOf: cacheURL) else { return nil }
        let decoder = JSONDecoder()
        if let cached = try? decoder.decode(CachedLibrary.self, from: data),
           cached.schemaVersion == 1,
           Self.isComplete(cached.entries, minimumCount: minimumCount) {
            return cached
        }
        // Adopt complete legacy caches; ignore the old ten-word/partial caches.
        if let legacy = try? decoder.decode([VocabularyEntry].self, from: data),
           Self.isComplete(legacy, minimumCount: minimumCount) {
            return CachedLibrary(schemaVersion: 1, entries: legacy, updatedAt: nil)
        }
        return nil
    }

    private func saveCache(_ entries: [VocabularyEntry], updatedAt: Date) -> Bool {
        guard let cacheURL,
              let data = try? JSONEncoder().encode(CachedLibrary(schemaVersion: 1, entries: entries, updatedAt: updatedAt)) else { return false }
        do {
            try fileManager.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: cacheURL, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private struct BundleManifest: Decodable {
        let schemaVersion: Int
        let entryCount: Int
        let sha256: String
    }

    private struct CachedLibrary: Codable {
        let schemaVersion: Int
        let entries: [VocabularyEntry]
        let updatedAt: Date?
    }

    private enum VocabularyError: Error {
        case invalidSource
        case incompleteLibrary
    }
}
