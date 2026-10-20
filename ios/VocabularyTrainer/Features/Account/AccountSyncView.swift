import SwiftUI
import GoogleSignInSwift

struct AccountSyncView: View {
    @EnvironmentObject private var auth: GoogleAuthManager
    @EnvironmentObject private var sync: CloudSyncCoordinator
    @EnvironmentObject private var progressStore: ProgressStore

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("אותן מילים, בכל מקום", systemImage: "arrow.triangle.2.circlepath")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)

            if let user = auth.user {
                VStack(alignment: .leading, spacing: 5) {
                    Text(user.displayName ?? "החשבון שלכם")
                        .font(.subheadline.weight(.semibold))
                    if let email = user.email {
                        Text(email)
                            .font(.caption)
                            .foregroundStyle(WordTheme.muted)
                            .environment(\.layoutDirection, .leftToRight)
                    }
                }
                .accessibilityElement(children: .combine)

                Label(sync.statusText, systemImage: statusIcon)
                    .font(.footnote)
                    .foregroundStyle(sync.status == .failed ? WordTheme.coral : WordTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityElement(children: .combine)

                HStack(spacing: 16) {
                    Button {
                        Task { await sync.synchronizeNow() }
                    } label: {
                        Label("סנכרון עכשיו", systemImage: "arrow.clockwise")
                            .frame(minHeight: 44)
                    }
                    .disabled(sync.status == .uploading || auth.isBusy)
                    Spacer(minLength: 0)
                    Button("התנתקות") { auth.signOut() }
                        .frame(minHeight: 44)
                        .disabled(auth.isBusy)
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WordTheme.forest)

                if progressStore.hasPendingChanges {
                    Text("שינויים שטרם הסתנכרנו נשמרים במכשיר ויישלחו בחיבור הבא לאותו חשבון.")
                        .font(.caption)
                        .foregroundStyle(WordTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if auth.configurationIssue != nil {
                Text("הכניסה לחשבון אינה זמינה בגרסה הזו. אפשר להמשיך לתרגל במכשיר גם בלי להתחבר.")
                    .font(.footnote)
                    .foregroundStyle(WordTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("התחברו עם אותו חשבון Google שבאתר כדי לשמור יחד את ההתקדמות והמילים המוכרות.")
                    .font(.footnote)
                    .foregroundStyle(WordTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                GoogleSignInButton {
                    Task { await auth.signIn() }
                }
                .frame(minHeight: 48)
                .disabled(auth.isBusy)
                .accessibilityLabel("כניסה עם Google")
                if auth.isBusy {
                    ProgressView("מתחברים לחשבון…")
                        .font(.footnote)
                }
            }

            if let message = auth.errorMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(WordTheme.coral)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(WordTheme.paper, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(WordTheme.line, lineWidth: 1)
        }
    }

    private var statusIcon: String {
        switch sync.status {
        case .synced: return "checkmark.icloud"
        case .failed: return "exclamationmark.icloud"
        case .offline: return "wifi.slash"
        default: return "arrow.triangle.2.circlepath"
        }
    }
}
