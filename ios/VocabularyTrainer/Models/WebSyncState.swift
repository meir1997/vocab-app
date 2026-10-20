import Foundation
import CoreFoundation

/// JSON-compatible unknown fields survive a native read/modify/write cycle.
indirect enum SyncJSONValue: Codable, Equatable, Sendable {
    case object([String: SyncJSONValue]), array([SyncJSONValue]), string(String)
    case number(Double), bool(Bool), null

    init(any: Any) throws {
        if any is NSNull { self = .null }
        else if let number = any as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { self = .bool(number.boolValue) }
            else if number.doubleValue.isFinite { self = .number(number.doubleValue) }
            else { throw WebSyncError.invalidDocument }
        } else if let string = any as? String { self = .string(string) }
        else if let array = any as? [Any] { self = .array(try array.map(Self.init(any:))) }
        else if let object = any as? [String: Any] { self = .object(try object.mapValues(Self.init(any:))) }
        else { throw WebSyncError.invalidDocument }
    }

    var any: Any {
        switch self {
        case .object(let value): return value.mapValues(\.any)
        case .array(let value): return value.map(\.any)
        case .string(let value): return value
        case .number(let value):
            // Match the web SDK's isSafeInteger dispatch. Firestore's native
            // serializer distinguishes NSNumber integer and double encodings;
            // counters must not silently become doubles on a native write.
            let isNegativeZero = value == 0 && value.sign == .minus
            if value.isFinite, !isNegativeZero, value.rounded(.towardZero) == value,
               abs(value) <= 9_007_199_254_740_991 {
                return Int64(value)
            }
            return value
        case .bool(let value): return value
        case .null: return NSNull()
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self), value.isFinite { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: Self].self) { self = .object(value) }
        else { self = .array(try container.decode([Self].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

enum WebSyncError: Error { case invalidDocument }

private func object(_ value: SyncJSONValue?) throws -> [String: SyncJSONValue] {
    guard let value else { return [:] }
    guard case .object(let result) = value else { throw WebSyncError.invalidDocument }
    return result
}

private func number(_ value: SyncJSONValue?, default fallback: Double = 0) throws -> Double {
    guard let value else { return fallback }
    guard case .number(let result) = value, result.isFinite, result >= 0 else {
        throw WebSyncError.invalidDocument
    }
    return result
}

private func integer(_ value: SyncJSONValue?, default fallback: Int = 0) throws -> Int {
    let result = try number(value, default: Double(fallback))
    guard result.rounded(.towardZero) == result, result <= 1_000_000_000 else {
        throw WebSyncError.invalidDocument
    }
    return Int(result)
}

private func extras(_ value: [String: SyncJSONValue], excluding keys: [String]) -> [String: SyncJSONValue] {
    value.filter { !keys.contains($0.key) }
}

private func union(_ lhs: [String: SyncJSONValue], _ rhs: [String: SyncJSONValue]) -> [String: SyncJSONValue] {
    lhs.merging(rhs) { local, remote in
        if case .object(let lhsObject) = local, case .object(let rhsObject) = remote {
            return .object(union(lhsObject, rhsObject))
        }
        return remote
    }
}

struct WebWordProgress: Codable, Equatable, Sendable {
    var r = 0
    var w = 0
    var s = 0
    var next: Double = 0
    var extra: [String: SyncJSONValue] = [:]
    var attempts: Int { r + w }

    init(r: Int = 0, w: Int = 0, s: Int = 0, next: Double = 0, extra: [String: SyncJSONValue] = [:]) {
        self.r = r; self.w = w; self.s = s; self.next = next; self.extra = extra
    }

    init(local: WordProgress) {
        r = max(0, local.successes)
        w = max(0, local.attempts - r)
        s = max(0, local.consecutiveCorrect)
        next = max(0, (local.nextReview.timeIntervalSince1970 * 1_000).rounded(.down))
    }

    var local: WordProgress {
        var value = WordProgress()
        value.attempts = attempts; value.successes = r; value.consecutiveCorrect = s
        value.nextReview = Date(timeIntervalSince1970: next / 1_000)
        return value
    }

    fileprivate init(json: SyncJSONValue) throws {
        let value = try object(json)
        r = try integer(value["r"]); w = try integer(value["w"])
        s = try integer(value["s"]); next = try number(value["next"])
        extra = extras(value, excluding: ["r", "w", "s", "next"])
    }

    fileprivate var json: SyncJSONValue {
        .object(extra.merging(["r": .number(Double(r)), "w": .number(Double(w)),
                               "s": .number(Double(s)), "next": .number(next)]) { _, value in value })
    }

    static func merging(local: Self, remote: Self) -> Self {
        var winner = remote.attempts > local.attempts ||
            (remote.attempts == local.attempts && remote.next > local.next) ? remote : local
        winner.extra = union(local.extra, remote.extra)
        return winner
    }
}

enum WebSessionLength: Codable, Equatable, Sendable {
    case count(Int), all
}

struct WebSyncSettings: Codable, Equatable, Sendable {
    var length: WebSessionLength = .count(20)
    /// Retain web modes even when the native quiz does not implement them.
    var mode = "choice"
    var goal = 20
    var extra: [String: SyncJSONValue] = [:]
    var sessionLength: Int? { if case .count(let count) = length { return count }; return nil }

    init() {}

    fileprivate init(json: SyncJSONValue?) throws {
        let value = try object(json)
        if value["length"] == .string("all") { length = .all }
        else { length = .count(try integer(value["length"], default: 20)) }
        if let raw = value["mode"] {
            guard case .string(let mode) = raw else { throw WebSyncError.invalidDocument }
            self.mode = mode
        }
        goal = try integer(value["goal"], default: 20)
        extra = extras(value, excluding: ["length", "mode", "goal"])
    }

    fileprivate var json: SyncJSONValue {
        let count: SyncJSONValue
        switch length { case .count(let n): count = .number(Double(n)); case .all: count = .string("all") }
        return .object(extra.merging(["length": count, "mode": .string(mode), "goal": .number(Double(goal))]) { _, value in value })
    }
}

struct WebDayStats: Codable, Equatable, Sendable {
    var a = 0
    var c = 0
    var extra: [String: SyncJSONValue] = [:]
    init(a: Int = 0, c: Int = 0) { self.a = a; self.c = c }
    fileprivate init(json: SyncJSONValue) throws {
        let value = try object(json)
        a = try integer(value["a"]); c = try integer(value["c"])
        extra = extras(value, excluding: ["a", "c"])
    }
    fileprivate var json: SyncJSONValue {
        .object(extra.merging(["a": .number(Double(a)), "c": .number(Double(c))]) { _, value in value })
    }
}

struct WebSyncStats: Codable, Equatable, Sendable {
    var attempts = 0
    var correct = 0
    var days: [String: WebDayStats] = [:]
    var extra: [String: SyncJSONValue] = [:]
    init() {}
    fileprivate init(json: SyncJSONValue?) throws {
        let value = try object(json)
        attempts = try integer(value["attempts"]); correct = try integer(value["correct"])
        days = try object(value["days"]).mapValues(WebDayStats.init(json:))
        extra = extras(value, excluding: ["attempts", "correct", "days"])
    }
    fileprivate var json: SyncJSONValue {
        .object(extra.merging(["attempts": .number(Double(attempts)), "correct": .number(Double(correct)),
                               "days": .object(days.mapValues(\.json))]) { _, value in value })
    }
}

struct WebSyncBands: Codable, Equatable, Sendable {
    var current = 1
    var recent: [Int] = []
    var thousandRecent: [Int] = []
    var extra: [String: SyncJSONValue] = [:]
    init() {}
    private enum CodingKeys: String, CodingKey { case current, recent, thousandRecent, extra }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        current = try values.decodeIfPresent(Int.self, forKey: .current) ?? 1
        recent = try values.decodeIfPresent([Int].self, forKey: .recent) ?? []
        thousandRecent = Array((try values.decodeIfPresent([Int].self, forKey: .thousandRecent) ?? []).suffix(100))
        extra = try values.decodeIfPresent([String: SyncJSONValue].self, forKey: .extra) ?? [:]
    }
    fileprivate init(json: SyncJSONValue?) throws {
        let value = try object(json)
        current = max(1, try integer(value["current"], default: 1))
        if let raw = value["recent"] {
            guard case .array(let values) = raw else { throw WebSyncError.invalidDocument }
            recent = try values.map { raw in
                let n = try integer(raw)
                guard n == 0 || n == 1 else { throw WebSyncError.invalidDocument }
                return n
            }.suffix(50).map { $0 }
        }
        if let raw = value["thousandRecent"] {
            guard case .array(let values) = raw else { throw WebSyncError.invalidDocument }
            thousandRecent = try values.map { raw in
                let n = try integer(raw)
                guard n == 0 || n == 1 else { throw WebSyncError.invalidDocument }
                return n
            }.suffix(100).map { $0 }
        }
        extra = extras(value, excluding: ["current", "recent", "thousandRecent"])
    }
    fileprivate var json: SyncJSONValue {
        var value = extra.merging(["current": SyncJSONValue.number(Double(current)), "recent": .array(recent.map { .number(Double($0)) })]) { _, value in value }
        if !thousandRecent.isEmpty { value["thousandRecent"] = .array(thousandRecent.map { .number(Double($0)) }) }
        return .object(value)
    }
}

struct WebSyncState: Codable, Equatable, Sendable {
    var progress: [String: WebWordProgress] = [:]
    var settings = WebSyncSettings()
    var stats = WebSyncStats()
    var bands = WebSyncBands()
    var extra: [String: SyncJSONValue] = [:]
    init() {}
    fileprivate init(json: SyncJSONValue?) throws {
        let value = try object(json)
        progress = try object(value["progress"]).mapValues(WebWordProgress.init(json:))
        settings = try WebSyncSettings(json: value["settings"])
        stats = try WebSyncStats(json: value["stats"])
        bands = try WebSyncBands(json: value["bands"])
        extra = extras(value, excluding: ["progress", "settings", "stats", "bands"])
    }
    fileprivate var json: SyncJSONValue {
        .object(extra.merging(["progress": .object(progress.mapValues(\.json)), "settings": settings.json,
                               "stats": stats.json, "bands": bands.json]) { _, value in value })
    }
}

/// Mirrors app.js at 9d34630398. All dates in the cloud are numeric milliseconds.
struct WebSyncDocument: Codable, Equatable, Sendable {
    var state = WebSyncState()
    var updatedAt: Double = 0
    var email: String?
    var extra: [String: SyncJSONValue] = [:]
    var settingsPresent = true

    init(state: WebSyncState = .init(), updatedAt: Double = 0, email: String? = nil) {
        self.state = state; self.updatedAt = updatedAt; self.email = email
    }

    init(dictionary: [String: Any]) throws {
        let value = try dictionary.mapValues(SyncJSONValue.init(any:))
        state = try WebSyncState(json: value["fw"])
        updatedAt = try number(value["fwUpdatedAt"])
        if let raw = value["email"], case .string(let email) = raw { self.email = email }
        extra = extras(value, excluding: ["fw", "fwUpdatedAt", "email"])
        let fw = try object(value["fw"])
        let settings = try object(fw["settings"])
        settingsPresent = settings["length"] != nil
    }

    var dictionary: [String: Any] {
        extra.merging(["fw": state.json, "fwUpdatedAt": .number(updatedAt),
                       "email": email.map(SyncJSONValue.string) ?? .null]) { _, value in value }.mapValues(\.any)
    }

    var hasContent: Bool {
        !state.progress.isEmpty || state.stats.attempts > 0 || !state.stats.days.isEmpty ||
        state.bands.current > 1 || !state.bands.recent.isEmpty || state.settings != WebSyncSettings()
    }

    /// Counters choose the most complete record; adding would replay old answers.
    static func merging(local: Self, remote: Self) -> Self {
        var merged = local
        for (word, value) in remote.state.progress {
            merged.state.progress[word] = local.state.progress[word].map {
                WebWordProgress.merging(local: $0, remote: value)
            } ?? value
        }
        if remote.settingsPresent && remote.updatedAt > local.updatedAt {
            merged.state.settings = remote.state.settings
        }
        merged.state.settings.extra = union(local.state.settings.extra, remote.state.settings.extra)
        merged.updatedAt = max(local.updatedAt, remote.updatedAt)
        merged.settingsPresent = local.settingsPresent || remote.settingsPresent
        merged.email = remote.email ?? local.email
        merged.extra = union(local.extra, remote.extra)
        merged.state.extra = union(local.state.extra, remote.state.extra)

        if remote.state.stats.attempts > local.state.stats.attempts {
            merged.state.stats.attempts = remote.state.stats.attempts
            merged.state.stats.correct = remote.state.stats.correct
        }
        for (day, value) in remote.state.stats.days {
            let prior = merged.state.stats.days[day] ?? WebDayStats()
            var result = WebDayStats(a: max(prior.a, value.a), c: max(prior.c, value.c))
            result.extra = union(prior.extra, value.extra)
            merged.state.stats.days[day] = result
        }
        merged.state.stats.extra = union(local.state.stats.extra, remote.state.stats.extra)
        let localBand = local.state.bands, remoteBand = remote.state.bands
        if remoteBand.current > localBand.current ||
            (remoteBand.current == localBand.current && remoteBand.recent.count > localBand.recent.count) {
            merged.state.bands = remoteBand
        }
        if (localBand.current - 1) / 10 == (remoteBand.current - 1) / 10 {
            merged.state.bands.thousandRecent = localBand.thousandRecent.count >= remoteBand.thousandRecent.count ? localBand.thousandRecent : remoteBand.thousandRecent
        }
        merged.state.bands.recent = Array(merged.state.bands.recent.suffix(50))
        merged.state.bands.extra = union(localBand.extra, remoteBand.extra)
        return merged
    }
}
