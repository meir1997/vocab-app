import Foundation
import XCTest
@testable import VocabularyTrainer

final class FirebaseConfigurationTests: XCTestCase {
    private let bundleID = "com.example.VocabularyTrainer"
    private let clientID = "71704465708-nativefixture.apps.googleusercontent.com"
    private let reversedClientID = "com.googleusercontent.apps.71704465708-nativefixture"

    func testNativeRegistrationAndGeneratedURLSchemeAreAccepted() throws {
        let configuration = try validate(values())
        XCTAssertEqual(configuration.projectID, "vocab-app-meir")
        XCTAssertEqual(configuration.senderID, "71704465708")
        XCTAssertEqual(configuration.googleAppID, "1:71704465708:ios:abcdef0123456789")
        XCTAssertEqual(configuration.clientID, clientID)
        XCTAssertEqual(configuration.reversedClientID, reversedClientID)
    }

    func testWebRegistrationCannotBeUsedForNativeAuthentication() {
        assertIssue(.invalidNativeAppID, changing: "GOOGLE_APP_ID", to: "1:71704465708:web:e5aed9325adf4979b89c89")
    }

    func testOtherProjectsAndSenderIDsAreRejected() {
        assertIssue(.wrongProject, changing: "PROJECT_ID", to: "another-project")
        assertIssue(.wrongSender, changing: "GCM_SENDER_ID", to: "123456789")
        assertIssue(.invalidNativeAppID, changing: "GOOGLE_APP_ID", to: "1:123456789:ios:abcdef0123456789")
    }

    func testAppIDMustBeCompleteNativeRegistration() {
        for value in ["1:71704465708:ios:", "1:71704465708:ios:not-hex", "1:71704465708:ios:abc:extra", "1:71704465708:android:abcdef"] {
            assertIssue(.invalidNativeAppID, changing: "GOOGLE_APP_ID", to: value)
        }
    }

    func testBundleIDMustMatchTheInstalledApp() {
        assertIssue(.wrongBundleID, changing: "BUNDLE_ID", to: "com.example.OtherApp")
        XCTAssertThrowsError(try FirebaseConfiguration.validate(values: values(), bundleID: nil, registeredURLSchemes: [reversedClientID])) {
            XCTAssertEqual($0 as? FirebaseConfiguration.Issue, .wrongBundleID)
        }
    }

    func testMissingAndPlaceholderValuesAreRejectedBeforeSDKConfiguration() {
        for field in ["PROJECT_ID", "GCM_SENDER_ID", "GOOGLE_APP_ID", "BUNDLE_ID", "API_KEY", "CLIENT_ID", "REVERSED_CLIENT_ID"] {
            for invalidValue in ["", " ", "$(UNSET_VALUE)", "YOUR_CLIENT_ID", 71704465708] as [Any] {
                assertIssue(.missingField(field), changing: field, to: invalidValue)
            }
            var missing = values()
            missing.removeValue(forKey: field)
            XCTAssertThrowsError(try validate(missing)) {
                XCTAssertEqual($0 as? FirebaseConfiguration.Issue, .missingField(field))
            }
        }
    }

    func testMalformedAPIKeysAreRejected() {
        for apiKey in ["invalid", String(repeating: "a", count: 39), "AIza" + String(repeating: "a", count: 34) + "!", "AIza" + String(repeating: "a", count: 36)] {
            assertIssue(.invalidAPIKey, changing: "API_KEY", to: apiKey)
        }
    }

    func testClientIDMustBelongToTheConfiguredProject() {
        for clientID in ["123456789-other.apps.googleusercontent.com", "71704465708-.apps.googleusercontent.com", "71704465708-client.evil.example", "71704465708-client.apps.googleusercontent.com.evil.example"] {
            assertIssue(.invalidClientID, changing: "CLIENT_ID", to: clientID)
        }
    }

    func testReversedClientIDMustCorrespondExactlyToClientID() {
        assertIssue(.invalidReversedClientID, changing: "REVERSED_CLIENT_ID", to: "com.googleusercontent.apps.another-client")
    }

    func testCallbackSchemeMustExistInBuiltInfoPlist() {
        XCTAssertThrowsError(try FirebaseConfiguration.validate(values: values(), bundleID: bundleID, registeredURLSchemes: [])) {
            XCTAssertEqual($0 as? FirebaseConfiguration.Issue, .missingURLScheme)
        }
        XCTAssertNoThrow(try FirebaseConfiguration.validate(
            values: values(), bundleID: bundleID,
            registeredURLSchemes: ["another-scheme", reversedClientID]
        ))
    }

    func testMissingBundledConfigRemainsAnExplicitOfflineState() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".bundle")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let info: [String: Any] = ["CFBundleIdentifier": "com.example.ConfigurationFixture", "CFBundleName": "ConfigurationFixture"]
        let data = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
        try data.write(to: directory.appendingPathComponent("Info.plist"))
        let bundle = try XCTUnwrap(Bundle(url: directory))
        XCTAssertEqual(FirebaseConfiguration.load(bundle: bundle), .failure(.missingFile))
    }

    @MainActor
    func testUnavailableConfigurationDoesNotStartAuthentication() async {
        let manager = GoogleAuthManager(configuration: .failure(.missingFile))
        XCTAssertNotNil(manager.configurationIssue)
        XCTAssertNil(manager.user)
        XCTAssertFalse(manager.isBusy)
        await manager.signIn()
        XCTAssertNil(manager.user)
        XCTAssertNil(manager.errorMessage)
        XCTAssertFalse(manager.handle(url: URL(string: "com.example.callback:/oauth")!))
    }

    private func values() -> [String: Any] {
        [
            "PROJECT_ID": "vocab-app-meir",
            "GCM_SENDER_ID": "71704465708",
            "GOOGLE_APP_ID": "1:71704465708:ios:abcdef0123456789",
            "BUNDLE_ID": bundleID,
            "API_KEY": "AIza" + String(repeating: "a", count: 35),
            "CLIENT_ID": clientID,
            "REVERSED_CLIENT_ID": reversedClientID
        ]
    }

    private func validate(_ values: [String: Any]) throws -> FirebaseConfiguration {
        try FirebaseConfiguration.validate(values: values, bundleID: bundleID, registeredURLSchemes: [reversedClientID])
    }

    private func assertIssue(
        _ expected: FirebaseConfiguration.Issue,
        changing key: String,
        to value: Any,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        var fixture = values()
        fixture[key] = value
        XCTAssertThrowsError(try validate(fixture), file: file, line: line) {
            XCTAssertEqual($0 as? FirebaseConfiguration.Issue, expected, file: file, line: line)
        }
    }
}
