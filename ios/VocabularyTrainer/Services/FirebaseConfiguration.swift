import Foundation

/// The native Firebase registration is separate from the web app registration.
/// Keep validation independent of Firebase so malformed/missing setup stays offline safely.
struct FirebaseConfiguration: Equatable {
    static let expectedProjectID = "vocab-app-meir"
    static let expectedSenderID = "71704465708"

    let projectID: String
    let googleAppID: String
    let senderID: String
    let bundleID: String
    let apiKey: String
    let clientID: String
    let reversedClientID: String

    enum Issue: Error, Equatable, LocalizedError {
        case missingFile
        case unreadableFile
        case missingField(String)
        case wrongProject
        case wrongSender
        case invalidNativeAppID
        case wrongBundleID
        case invalidAPIKey
        case invalidClientID
        case invalidReversedClientID
        case missingURLScheme
        case existingFirebaseAppMismatch

        var errorDescription: String? {
            switch self {
            case .missingFile:
                return "הסנכרון עדיין לא הוגדר במכשיר. אפשר להמשיך ללמוד ללא התחברות."
            case .unreadableFile, .missingField:
                return "קובץ ההגדרות של הסנכרון חסר או אינו תקין. אפשר להמשיך ללמוד במכשיר."
            case .wrongProject, .wrongSender, .invalidNativeAppID, .existingFirebaseAppMismatch:
                return "הגדרות הסנכרון אינן תואמות לפרויקט ארבע מילים. אפשר להמשיך ללמוד במכשיר."
            case .wrongBundleID:
                return "הגדרות הסנכרון אינן תואמות לגרסה המותקנת של האפליקציה."
            case .invalidAPIKey, .invalidClientID, .invalidReversedClientID, .missingURLScheme:
                return "ההגדרות להתחברות עם Google אינן מלאות. אפשר להמשיך ללמוד במכשיר."
            }
        }
    }

    static func load(bundle: Bundle = .main) -> Result<FirebaseConfiguration, Issue> {
        let fileURL = bundle.url(forResource: "GoogleService-Info", withExtension: "plist", subdirectory: "Firebase")
            ?? bundle.url(forResource: "GoogleService-Info", withExtension: "plist")
        guard let fileURL else { return .failure(.missingFile) }
        guard let data = try? Data(contentsOf: fileURL),
              let values = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        else { return .failure(.unreadableFile) }

        let urlTypes = bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
        let schemes = urlTypes.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        do {
            return .success(try validate(values: values, bundleID: bundle.bundleIdentifier, registeredURLSchemes: schemes))
        } catch let issue as Issue {
            return .failure(issue)
        } catch {
            return .failure(.unreadableFile)
        }
    }

    static func validate(
        values: [String: Any],
        bundleID actualBundleID: String?,
        registeredURLSchemes: [String]
    ) throws -> FirebaseConfiguration {
        func required(_ key: String) throws -> String {
            guard let value = values[key] as? String,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  value == value.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.contains("$("), !value.contains("YOUR_")
            else { throw Issue.missingField(key) }
            return value
        }

        let projectID = try required("PROJECT_ID")
        guard projectID == expectedProjectID else { throw Issue.wrongProject }
        let senderID = try required("GCM_SENDER_ID")
        guard senderID == expectedSenderID else { throw Issue.wrongSender }
        let googleAppID = try required("GOOGLE_APP_ID")
        let appIDParts = googleAppID.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        let hexDigits = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
        guard appIDParts.count == 4, appIDParts[0] == "1", appIDParts[1] == expectedSenderID,
              appIDParts[2] == "ios", !appIDParts[3].isEmpty,
              appIDParts[3].unicodeScalars.allSatisfy(hexDigits.contains)
        else { throw Issue.invalidNativeAppID }

        let bundleID = try required("BUNDLE_ID")
        guard let actualBundleID, !actualBundleID.isEmpty, bundleID == actualBundleID
        else { throw Issue.wrongBundleID }
        let apiKey = try required("API_KEY")
        let apiKeyCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
        guard apiKey.count == 39, apiKey.hasPrefix("AIza"),
              apiKey.unicodeScalars.allSatisfy(apiKeyCharacters.contains)
        else { throw Issue.invalidAPIKey }

        let clientID = try required("CLIENT_ID")
        let clientSuffix = ".apps.googleusercontent.com"
        let clientName = String(clientID.dropLast(clientSuffix.count))
        let clientCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")
        guard clientID.hasSuffix(clientSuffix), clientName.hasPrefix(expectedSenderID + "-"),
              clientName.count > expectedSenderID.count + 1,
              clientName.unicodeScalars.allSatisfy(clientCharacters.contains)
        else { throw Issue.invalidClientID }
        let reversedClientID = try required("REVERSED_CLIENT_ID")
        guard reversedClientID == clientID.split(separator: ".").reversed().joined(separator: ".")
        else { throw Issue.invalidReversedClientID }
        guard registeredURLSchemes.contains(reversedClientID) else { throw Issue.missingURLScheme }

        return FirebaseConfiguration(
            projectID: projectID, googleAppID: googleAppID, senderID: senderID,
            bundleID: bundleID, apiKey: apiKey, clientID: clientID, reversedClientID: reversedClientID
        )
    }
}
