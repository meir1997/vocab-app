import Foundation
import Combine

@MainActor
final class VocabularyRepository: ObservableObject {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    @Published private(set) var entries: [VocabularyEntry] = []
    @Published private(set) var state: State = .idle

    private let sourceURL = URL(string: "https://docs.google.com/spreadsheets/d/1YuNV-TcC_tITIe-SGTzTh-dKTlx4H84-4feTzAM2k4M/export?format=csv&gid=0")!
    private let session: URLSession
    private let fileManager: FileManager

    init(session: URLSession = .shared, fileManager: FileManager = .default) {
        self.session = session
        self.fileManager = fileManager
    }

    func load(forceRefresh: Bool = false) async {
        guard state != .loading else { return }
        state = .loading

        if !forceRefresh, let cached = loadCache(), cached.count >= 4 {
            entries = cached
            state = .loaded
            return
        }

        do {
            let (data, response) = try await session.data(from: sourceURL)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode) else {
                throw URLError(.badServerResponse)
            }
            guard let text = String(data: data, encoding: .utf8) else {
                throw CocoaError(.fileReadInapplicableStringEncoding)
            }

            let parsed = Self.entries(fromCSV: text)
            guard parsed.count >= 4 else {
                throw VocabularyError.notEnoughWords
            }

            entries = parsed
            saveCache(parsed)
            state = .loaded
        } catch {
            let fallback = Self.fallbackEntries
            entries = fallback
            state = fallback.count >= 4 ? .loaded : .failed("לא הצלחנו לטעון את אוצר המילים")
        }
    }

    nonisolated static func entries(fromCSV text: String) -> [VocabularyEntry] {
        var seen: Set<String> = []

        return CSVParser.rows(from: text).dropFirst().enumerated().compactMap { offset, row in
            // C = English word, I = Hebrew translation in the source sheet.
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

    private var cacheURL: URL? {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("VocabularyTrainer", isDirectory: true)
            .appendingPathComponent("vocabulary.json")
    }

    private func loadCache() -> [VocabularyEntry]? {
        guard let cacheURL,
              let data = try? Data(contentsOf: cacheURL) else { return nil }
        return try? JSONDecoder().decode([VocabularyEntry].self, from: data)
    }

    private func saveCache(_ entries: [VocabularyEntry]) {
        guard let cacheURL,
              let data = try? JSONEncoder().encode(entries) else { return }
        try? fileManager.createDirectory(
            at: cacheURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: cacheURL, options: .atomic)
    }

    private enum VocabularyError: Error {
        case notEnoughWords
    }

    private static let fallbackEntries: [VocabularyEntry] = [
        .init(rank: 1, english: "the", hebrew: "את / ה־"),
        .init(rank: 2, english: "of", hebrew: "של"),
        .init(rank: 3, english: "and", hebrew: "ו־"),
        .init(rank: 4, english: "to", hebrew: "אל / ל־"),
        .init(rank: 5, english: "in", hebrew: "ב־"),
        .init(rank: 6, english: "I", hebrew: "אני"),
        .init(rank: 7, english: "that", hebrew: "זה / ש־"),
        .init(rank: 8, english: "was", hebrew: "היה"),
        .init(rank: 9, english: "his", hebrew: "שלו"),
        .init(rank: 10, english: "he", hebrew: "הוא")
    ]
}
