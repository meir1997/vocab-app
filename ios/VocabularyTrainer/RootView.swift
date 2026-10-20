import SwiftUI
import UIKit

struct RootView: View {
    @EnvironmentObject private var repository: VocabularyRepository
    @EnvironmentObject private var progressStore: ProgressStore

    @State private var isPracticing = false
    @State private var isPlacement = false

    var body: some View {
        NavigationStack {
            if isPracticing {
                QuizView(
                    entries: repository.entries,
                    sessionLength: progressStore.sessionCount(in: repository.entries),
                    progressStore: progressStore,
                    placement: isPlacement,
                    onClose: { isPracticing = false }
                )
            } else {
                HomeView(isPracticing: $isPracticing, sessionLength: sessionLength, isPlacement: $isPlacement)
            }
        }
        .tint(WordTheme.forest)
        .toolbar(.hidden, for: .navigationBar)
        .background(WordTheme.canvas)
        .onChange(of: progressStore.currentUID) { _, _ in isPracticing = false }
    }

    private var sessionLength: Binding<Int> {
        Binding(
            get: { progressStore.snapshot.state.settings.sessionLength ?? 0 },
            set: { length in
                if length == 0 { progressStore.setAllDueSession() }
                else { progressStore.setSessionLength(length) }
            }
        )
    }
}

/// A small shared palette, with deliberate contrast in both system appearances.
enum WordTheme {
    static let canvas = adaptive(light: 0xF6F3EB, dark: 0x121C18)
    static let paper = adaptive(light: 0xFFFEFA, dark: 0x1C2923)
    static let ink = adaptive(light: 0x163D30, dark: 0xF4F2E9)
    static let muted = adaptive(light: 0x52645A, dark: 0xB4C3B9)
    static let forest = adaptive(light: 0x1D5742, dark: 0xA9D9B9)
    static let forestFill = adaptive(light: 0x1D5742, dark: 0xB7DFC4)
    static let onForest = adaptive(light: 0xFFFEFA, dark: 0x133725)
    static let softGreen = adaptive(light: 0xE5EFE5, dark: 0x253C2E)
    static let coral = adaptive(light: 0xA74332, dark: 0xFFB3A4)
    static let softCoral = adaptive(light: 0xFBE9E2, dark: 0x432B26)
    static let line = adaptive(light: 0xD6DED2, dark: 0x405046)

    private static func adaptive(light: UInt, dark: UInt) -> Color {
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

struct WordPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(WordTheme.onForest)
            .padding(.horizontal, 20)
            .padding(.vertical, 17)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(WordTheme.forestFill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
