import Foundation
import XCTest
@testable import VocabularyTrainer

@MainActor
final class VocabularyDataTests: XCTestCase {
    func testCRLFRecordsAndQuotedCRLFAreDistinct() throws {
        let rows = try CSVParser.parse("\u{FEFF}Rank,Word,Translation\r\n1,\"say \"\"hello\"\"\",\"שלום,\r\nעולם\"\r\n2,word,\r\n")
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[1], ["1", "say \"hello\"", "שלום,\r\nעולם"])
        XCTAssertEqual(rows[2], ["2", "word", ""])
        XCTAssertEqual(try CSVParser.parse("a,b\r1,2\n3,4"), [["a", "b"], ["1", "2"], ["3", "4"]])
    }

    func testMalformedCSVDoesNotYieldPartialLibrary() {
        for text in ["a,\"unfinished", "a,b\"c", "a,\"b\"junk"] {
            XCTAssertThrowsError(try CSVParser.parse(text))
            XCTAssertTrue(CSVParser.rows(from: text).isEmpty)
        }
    }

    func testRefreshValidationRequiresExpectedColumnsAndAllRows() throws {
        let csv = "Rank,B,Word,D,E,F,G,H,I\r\n1,x,one,x,x,x,x,x,אחד\r\n2,x,two,x,x,x,x,x,שניים\r\n3,x,ONE,x,x,x,x,x,אחד\r\n"
        let parsed = try VocabularyRepository.validatedEntries(fromCSV: csv, minimumCount: 2)
        XCTAssertEqual(parsed.map(\.english), ["one", "two"])
        XCTAssertEqual(parsed.map(\.rank), [1, 2])
        XCTAssertThrowsError(try VocabularyRepository.validatedEntries(fromCSV: csv, minimumCount: 3))
        XCTAssertThrowsError(try VocabularyRepository.validatedEntries(fromCSV: csv.replacingOccurrences(of: "3,x,ONE,x,x,x,x,x,אחד", with: "3,x,ONE,x,x,x,x,x,אחת"), minimumCount: 2))
        XCTAssertThrowsError(try VocabularyRepository.validatedEntries(fromCSV: csv.replacingOccurrences(of: "שניים", with: ""), minimumCount: 1))
        XCTAssertThrowsError(try VocabularyRepository.validatedEntries(fromCSV: csv.replacingOccurrences(of: "Word", with: "Unexpected"), minimumCount: 1))
    }

    func testFirstLaunchUsesCompleteBundleWithoutNetwork() async {
        let directory = temporaryCacheDirectory()
        VocabularyURLProtocol.result = .failure(URLError(.notConnectedToInternet))
        VocabularyURLProtocol.requestCount = 0
        let repository = makeRepository(cacheDirectory: directory)

        await repository.load()

        XCTAssertEqual(repository.state, .loaded)
        XCTAssertEqual(repository.source, .bundled)
        XCTAssertEqual(repository.entries.count, 9_998)
        XCTAssertEqual(Set(repository.entries.map(\.id)).count, 9_998)
        XCTAssertEqual(repository.entries.first?.english, "the")
        XCTAssertEqual(repository.entries.last?.english, "calves")
        XCTAssertEqual(VocabularyURLProtocol.requestCount, 0)
        XCTAssertFalse(repository.isRefreshing)
    }

    func testIncompleteLegacyCacheFallsBackToCompleteBundle() async throws {
        let directory = temporaryCacheDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let oldFallback = Array(Self.completeEntries.prefix(10))
        try JSONEncoder().encode(oldFallback).write(to: directory.appendingPathComponent("vocabulary.json"))
        let repository = makeRepository(cacheDirectory: directory)

        await repository.load()

        XCTAssertEqual(repository.entries.count, 9_998)
        XCTAssertEqual(repository.source, .bundled)
    }

    func testOfflineRefreshPreservesCompleteLegacyCacheAndDiskContents() async throws {
        let directory = temporaryCacheDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let cacheURL = directory.appendingPathComponent("vocabulary.json")
        let originalData = try JSONEncoder().encode(Self.completeEntries)
        try originalData.write(to: cacheURL)
        VocabularyURLProtocol.result = .failure(URLError(.notConnectedToInternet))
        let repository = makeRepository(cacheDirectory: directory)
        await repository.load()
        let originalEntries = repository.entries

        await repository.load(forceRefresh: true)

        XCTAssertEqual(repository.entries, originalEntries)
        XCTAssertEqual(repository.source, .cache)
        XCTAssertEqual(repository.state, .loaded)
        XCTAssertNotNil(repository.refreshMessage)
        XCTAssertEqual(try Data(contentsOf: cacheURL), originalData)
    }

    func testPartialDownloadAndHTTPErrorKeepFullLibrary() async {
        let repository = makeRepository(cacheDirectory: temporaryCacheDirectory())
        await repository.load()
        let originalEntries = repository.entries
        let partialCSV = Self.csv(count: 4)
        VocabularyURLProtocol.result = .success((200, Data(partialCSV.utf8)))

        await repository.load(forceRefresh: true)

        XCTAssertEqual(repository.entries, originalEntries)
        XCTAssertEqual(repository.source, .bundled)
        XCTAssertNotNil(repository.refreshMessage)

        VocabularyURLProtocol.result = .success((503, Data(Self.csv(count: 9_998).utf8)))
        await repository.load(forceRefresh: true)
        XCTAssertEqual(repository.entries, originalEntries)
        XCTAssertEqual(repository.state, .loaded)
    }

    func testCompleteRefreshPersistsAndBootstrapsOffline() async {
        let directory = temporaryCacheDirectory()
        let repository = makeRepository(cacheDirectory: directory)
        await repository.load()
        VocabularyURLProtocol.result = .success((200, Data(Self.csv(count: 9_998).utf8)))

        await repository.load(forceRefresh: true)

        XCTAssertEqual(repository.entries.count, 9_998)
        XCTAssertEqual(repository.entries.first?.english, "word1")
        XCTAssertEqual(repository.source, .live)
        XCTAssertNil(repository.refreshMessage)
        XCTAssertNotNil(repository.lastUpdated)

        VocabularyURLProtocol.result = .failure(URLError(.notConnectedToInternet))
        let reopened = makeRepository(cacheDirectory: directory)
        await reopened.load()
        XCTAssertEqual(reopened.source, .cache)
        XCTAssertEqual(reopened.entries, repository.entries)
        XCTAssertNotNil(reopened.lastUpdated)
    }

    private func temporaryCacheDirectory() -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory
    }

    private func makeRepository(cacheDirectory: URL) -> VocabularyRepository {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VocabularyURLProtocol.self]
        return VocabularyRepository(session: URLSession(configuration: configuration), cacheDirectory: cacheDirectory)
    }

    private static var completeEntries: [VocabularyEntry] {
        (1...9_998).map { VocabularyEntry(rank: $0, english: "word\($0)", hebrew: "תרגום\($0)") }
    }

    private static func csv(count: Int) -> String {
        "Rank,B,Word,D,E,F,G,H,I\r\n" + (1...count).map { "\($0),x,word\($0),x,x,x,x,x,תרגום\($0)\r\n" }.joined()
    }
}

private final class VocabularyURLProtocol: URLProtocol {
    static var result: Result<(Int, Data), Error> = .failure(URLError(.notConnectedToInternet))
    static var requestCount = 0

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requestCount += 1
        switch Self.result {
        case let .success((statusCode, data)):
            let response = HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: ["Content-Type": "text/csv"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        case let .failure(error):
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
