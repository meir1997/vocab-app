import Combine
import FirebaseAuth
import FirebaseCore
import GoogleSignIn
import UIKit

struct SyncUser: Equatable {
    let uid: String
    let email: String?
    let displayName: String?
}

@MainActor
final class GoogleAuthManager: ObservableObject {
    @Published private(set) var user: SyncUser?
    @Published private(set) var isBusy = false
    @Published private(set) var errorMessage: String?
    let configurationIssue: String?

    private var auth: Auth?
    private var stateListener: AuthStateDidChangeListenerHandle?
    private var activeSignIn: UUID?
    private var acceptsAuthenticatedState = true

    init(configuration: Result<FirebaseConfiguration, FirebaseConfiguration.Issue> = FirebaseConfiguration.load()) {
        switch configuration {
        case let .failure(issue):
            configurationIssue = issue.localizedDescription
        case let .success(configuration):
            if let app = FirebaseApp.app() {
                guard app.options.projectID == configuration.projectID,
                      app.options.googleAppID == configuration.googleAppID,
                      app.options.gcmSenderID == configuration.senderID,
                      app.options.bundleID == configuration.bundleID,
                      app.options.clientID == configuration.clientID
                else {
                    configurationIssue = FirebaseConfiguration.Issue.existingFirebaseAppMismatch.localizedDescription
                    return
                }
            } else {
                let options = FirebaseOptions(googleAppID: configuration.googleAppID, gcmSenderID: configuration.senderID)
                options.projectID = configuration.projectID
                options.apiKey = configuration.apiKey
                options.bundleID = configuration.bundleID
                options.clientID = configuration.clientID
                FirebaseApp.configure(options: options)
            }
            configurationIssue = nil
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: configuration.clientID)
            let firebaseAuth = Auth.auth()
            auth = firebaseAuth
            // Firebase restores its persisted session. It does not need a fresh Google login.
            isBusy = true
            stateListener = firebaseAuth.addStateDidChangeListener { [weak self] auth, changedUser in
                let changedUID = changedUser?.uid
                Task { @MainActor [weak self] in
                    guard let self, self.activeSignIn == nil,
                          auth.currentUser?.uid == changedUID else { return }
                    self.publishCurrentUser()
                    self.isBusy = false
                }
            }
        }
    }

    deinit {
        if let auth, let stateListener {
            auth.removeStateDidChangeListener(stateListener)
        }
    }

    func signIn() async {
        guard let auth, !isBusy, activeSignIn == nil, user == nil else { return }
        guard let presentingController = Self.presentingViewController() else {
            errorMessage = "לא ניתן לפתוח כרגע את חלון ההתחברות. נסו שוב כשהאפליקציה פתוחה."
            return
        }

        let operation = UUID()
        activeSignIn = operation
        acceptsAuthenticatedState = true
        isBusy = true
        errorMessage = nil
        defer {
            activeSignIn = nil
            isBusy = false
            publishCurrentUser()
        }

        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presentingController)
            try Task.checkCancellation()
            guard activeSignIn == operation, acceptsAuthenticatedState else {
                GIDSignIn.sharedInstance.signOut()
                return
            }
            guard let idToken = result.user.idToken?.tokenString else {
                GIDSignIn.sharedInstance.signOut()
                errorMessage = "Google לא החזירה אישור התחברות. נסו שוב."
                return
            }
            let credential = GoogleAuthProvider.credential(
                withIDToken: idToken,
                accessToken: result.user.accessToken.tokenString
            )
            _ = try await auth.signIn(with: credential)
            try Task.checkCancellation()
            guard activeSignIn == operation, acceptsAuthenticatedState else {
                try auth.signOut()
                GIDSignIn.sharedInstance.signOut()
                return
            }
        } catch {
            // A canceled Google sheet is a normal outcome; do not show a failure banner.
            let nsError = error as NSError
            let canceledByGoogle = nsError.domain == kGIDSignInErrorDomain
                && nsError.code == GIDSignInErrorCode.canceled.rawValue
            if error is CancellationError || !acceptsAuthenticatedState {
                do { try auth.signOut() } catch {
                    errorMessage = "לא ניתן להשלים את ההתנתקות. נסו שוב."
                }
                GIDSignIn.sharedInstance.signOut()
            } else if !canceledByGoogle {
                GIDSignIn.sharedInstance.signOut()
                errorMessage = "ההתחברות לא הושלמה. בדקו את החיבור לרשת ונסו שוב."
            }
        }
    }

    func signOut() {
        errorMessage = nil
        acceptsAuthenticatedState = false
        do {
            try auth?.signOut()
            GIDSignIn.sharedInstance.signOut()
            user = nil
        } catch {
            GIDSignIn.sharedInstance.signOut()
            // Retain the Firebase identity if clearing its Keychain session failed.
            acceptsAuthenticatedState = activeSignIn == nil
            publishCurrentUser()
            errorMessage = "לא ניתן להשלים את ההתנתקות. נסו שוב."
        }
        // An in-flight login must finish before another account can begin signing in.
        if activeSignIn == nil { isBusy = false }
    }

    @discardableResult
    func handle(url: URL) -> Bool {
        guard configurationIssue == nil else { return false }
        return GIDSignIn.sharedInstance.handle(url)
    }

    private func publishCurrentUser() {
        guard acceptsAuthenticatedState, let firebaseUser = auth?.currentUser else {
            user = nil
            return
        }
        user = SyncUser(uid: firebaseUser.uid, email: firebaseUser.email, displayName: firebaseUser.displayName)
    }

    private static func presentingViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
        guard let root = scenes.flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController else { return nil }
        return topController(root)
    }

    private static func topController(_ controller: UIViewController) -> UIViewController {
        if let presented = controller.presentedViewController, !presented.isBeingDismissed {
            return topController(presented)
        }
        if let navigation = controller as? UINavigationController, let visible = navigation.visibleViewController {
            return topController(visible)
        }
        if let tab = controller as? UITabBarController, let selected = tab.selectedViewController {
            return topController(selected)
        }
        return controller
    }
}
