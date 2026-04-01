import AppKit
import Foundation
import Observation
import os

@MainActor
@Observable
final class TransferViewModel {
    var watchLaterSummary = WatchLaterSummary(videoCount: 0, maxItems: 5_000)
    var availablePlaylists: [PlaylistSummary] = []
    var selectedPlaylistID: PlaylistSummary.ID?
    var isEditingDestination = false
    var isShowingNewPlaylistSheet = false
    var newPlaylistDraftName = "Old Watch"
    var isLoadingPlaylists = false
    var isCheckingAuthentication = false
    var isRunningTransfer = false
    var hasStartedTransfer = false
    var hasLoadedPlaylists = false
    var isProgressExpanded = false
    var errorMessage: String?
    var statusMessage = "Choose a destination, then start the migration."
    var lastRefreshDescription = "Not loaded yet"
    var currentPhase: MovePhase?
    var currentItem: MoveItemSnapshot?
    var completedItems: [MoveItemSnapshot] = []
    var inventoryProgress = PhaseProgressSnapshot(phase: .inventory)
    var copyProgress = PhaseProgressSnapshot(phase: .copy)
    var verifyProgress = PhaseProgressSnapshot(phase: .verify)
    var deleteProgress = PhaseProgressSnapshot(phase: .delete)
    var latestResult: MoveResultPayload?
    var currentToast: Toast?
    private(set) var resumableRunID: String?
    private var resumableDestination: TransferDestination?
    private var resumableSourceRunID: String?
    var resumeEnabled = true
    var authCheckResult = AuthCheckResult(
        isAuthenticated: true,
        title: "Signed in",
        detail: "Ready",
        accountLabel: nil
    )

    @ObservationIgnored private let log = Logger(subsystem: "com.malpern.watchlaterapp", category: "TransferViewModel")
    @ObservationIgnored private let playlistService: any PlaylistService
    @ObservationIgnored private let moveService: any MoveService
    @ObservationIgnored private let authService: any AuthService
    @ObservationIgnored private let preferences: AppPreferences
    @ObservationIgnored private var moveTask: Task<Void, Never>?
    @ObservationIgnored private var activeRunID: String?

    init(
        playlistService: any PlaylistService,
        moveService: any MoveService,
        authService: any AuthService,
        preferences: AppPreferences
    ) {
        self.playlistService = playlistService
        self.moveService = moveService
        self.authService = authService
        self.preferences = preferences
    }

    var hasResumableRun: Bool {
        (resumableRunID != nil || resumableSourceRunID != nil) && resumableDestination != nil
    }

    var resumableRunDescription: String? {
        guard let resumableDestination else { return nil }
        let startIndex = preferences.resumableStartIndex
        let startLabel = startIndex > 1 ? " Starting at video \(startIndex)." : ""
        if resumableRunID != nil {
            return "A previous transfer to \(resumableDestination.displayName) was interrupted.\(startLabel)"
        }
        if resumableSourceRunID != nil {
            return "A prior inventory of your Watch Later is available. Resume the transfer to \(resumableDestination.displayName).\(startLabel)"
        }
        return nil
    }

    var canRunTransfer: Bool {
        guard !isRunningTransfer else {
            return false
        }

        guard !requiresAuthenticationGate else {
            return false
        }

        return destination != nil
    }

    var requiresAuthenticationGate: Bool {
        preferences.backendMode == .real && !authCheckResult.isAuthenticated
    }

    var authGateTitle: String {
        authCheckResult.title
    }

    var authGateDetail: String {
        authCheckResult.detail
    }

    var selectedPlaylist: PlaylistSummary? {
        availablePlaylists.first(where: { $0.id == selectedPlaylistID })
    }

    var selectedPlaylistTitle: String {
        selectedPlaylist?.title ?? "Choose a playlist"
    }

    var isSelectedPlaylistDraft: Bool {
        selectedPlaylist?.isDraft == true
    }

    var destinationSummary: String {
        destination?.displayName ?? "Choose a destination"
    }

    var heroTitle: String {
        if latestResult?.ok == true {
            return "Transfer Complete"
        }

        return "Transferring to \(destinationSummary)"
    }

    var heroMessage: String {
        if errorMessage != nil {
            return "Migration failed"
        }

        if latestResult?.ok == true {
            return "Migration complete"
        }

        switch currentPhase {
        case .copy:
            if let currentItem {
                return currentItem.title
            }
            return "Copying videos into \(destinationSummary)"
        case .verify:
            return "Verifying migrated items"
        case .delete:
            if let currentItem {
                return "Removing from Watch Later: \(currentItem.title)"
            }
            return "Removing migrated videos from Watch Later"
        case .setup:
            return "Preparing the destination playlist"
        case .inventory:
            if inventoryProgress.completed > 0 {
                return "Scanning Watch Later: \(inventoryProgress.completed) videos found"
            }
            return "Scanning the Watch Later playlist…"
        case .none:
            return statusMessage
        }
    }

    var overallProgress: Double {
        if latestResult?.ok == true {
            return 1
        }

        let copy = copyProgress.fraction
        let delete = deleteProgress.fraction
        let weightedProgress = (copy + delete) / 2

        switch currentPhase {
        case .setup:
            return max(weightedProgress, 0.05)
        case .inventory:
            return max(weightedProgress, 0.12)
        default:
            return weightedProgress
        }
    }

    var overallProgressText: String {
        if latestResult?.ok == true {
            return "100%"
        }

        if let activeProgress {
            return activeProgress.countLabel
        }

        return "Ready"
    }

    var activeProgress: PhaseProgressSnapshot? {
        if let currentPhase, let snapshot = progressSnapshotIfVisible(for: currentPhase) {
            return snapshot
        }

        if deleteProgress.status == .running {
            return deleteProgress
        }

        if copyProgress.status == .running {
            return copyProgress
        }

        return nil
    }

    var completedVideoCount: Int {
        max(copyProgress.total, deleteProgress.total, copyProgress.completed, deleteProgress.completed)
    }

    var completedSummaryText: String {
        let count = completedVideoCount
        let noun = count == 1 ? "video" : "videos"
        return "Transfer of \(count) \(noun) complete"
    }

    var completedErrorText: String? {
        if let errorMessage, !errorMessage.isEmpty {
            return errorMessage
        }

        return nil
    }

    var overallPhaseMarkerPositions: [Double] {
        [0.5]
    }

    var completedMosaicItems: [MoveItemSnapshot] {
        let items = completedItems
        let targetCount = min(9, items.count)
        guard targetCount > 0 else {
            return []
        }

        if items.count <= targetCount {
            return items
        }

        let lastIndex = items.count - 1
        let denominator = max(targetCount - 1, 1)

        return (0..<targetCount).map { slot in
            let mappedIndex = Int(round(Double(slot) * Double(lastIndex) / Double(denominator)))
            return items[mappedIndex]
        }
    }

    var phaseProgressRows: [PhaseProgressSnapshot] {
        [copyProgress, deleteProgress]
    }

    var accessibilityProgressSummary: String {
        let phaseText = currentPhase?.title ?? "Waiting to start"
        let itemText = currentItem?.title ?? statusMessage
        return "\(phaseText). \(overallProgressText). \(itemText)"
    }

    var shouldShowProgressCard: Bool {
        hasStartedTransfer || latestResult != nil
    }

    var isShowingCompletedState: Bool {
        latestResult?.ok == true
    }

    var canAcknowledgeCompletion: Bool {
        latestResult != nil && !isRunningTransfer
    }

    var thumbnailAccessibilityLabel: String {
        if latestResult?.ok == true {
            return "Migration complete preview"
        }

        switch currentPhase {
        case .verify:
            return "Verification preview"
        case .setup:
            return "Setup preview"
        case .inventory:
            return "Inventory preview"
        case .delete:
            return "Delete preview"
        case .copy:
            return "Current video preview"
        case .none:
            return "Migration preview"
        }
    }

    var thumbnailAccessibilityValue: String {
        if let currentItem {
            return currentItem.title
        }

        return statusMessage
    }

    func loadPlaylistsIfNeeded() async {
        log.info("loadPlaylistsIfNeeded: hasLoaded=\(self.hasLoadedPlaylists), backend=\(self.preferences.backendMode.rawValue, privacy: .public)")

        if !hasLoadedPlaylists {
            restoreResumableRun()
        }

        await refreshAuthenticationStatus(announce: false)
        guard !requiresAuthenticationGate else {
            log.info("loadPlaylistsIfNeeded: blocked by auth gate")
            return
        }

        guard !hasLoadedPlaylists else {
            return
        }

        await refreshPlaylists(announce: true)
    }

    func reloadPlaylistsForBackendChange() async {
        guard !isRunningTransfer else {
            log.info("reloadPlaylistsForBackendChange: skipped, transfer running")
            return
        }

        log.info("Backend changed to \(self.preferences.backendMode.rawValue, privacy: .public), reloading playlists")
        hasLoadedPlaylists = false
        let customPlaylists = availablePlaylists.filter(\.isDraft)
        availablePlaylists = customPlaylists
        selectedPlaylistID = chooseSelectedPlaylistID(from: availablePlaylists)
        watchLaterSummary = WatchLaterSummary(videoCount: 0, maxItems: 5_000)
        lastRefreshDescription = "Refreshing…"
        errorMessage = nil
        await refreshAuthenticationStatus(announce: true)
        guard !requiresAuthenticationGate else {
            return
        }
        await refreshPlaylists(announce: true)
    }

    func runPlaylistPolling() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(30))

            guard !Task.isCancelled else {
                return
            }

            guard preferences.playlistPollingEnabled else {
                continue
            }

            guard !isRunningTransfer, !isShowingNewPlaylistSheet else {
                continue
            }

            guard !requiresAuthenticationGate else {
                continue
            }

            await refreshPlaylists(announce: false)
        }
    }

    func refreshAuthenticationStatus(announce: Bool) async {
        guard preferences.backendMode == .real else {
            authCheckResult = AuthCheckResult(
                isAuthenticated: true,
                title: "Mock backend ready",
                detail: "Mock mode does not require YouTube authentication.",
                accountLabel: nil
            )
            return
        }

        isCheckingAuthentication = true
        do {
            let result = try await authService.checkAuthentication()
            authCheckResult = result
            errorMessage = nil
            if announce {
                statusMessage = result.title
            }
        } catch {
            authCheckResult = AuthCheckResult(
                isAuthenticated: false,
                title: "Sign in to YouTube",
                detail: "Use the dedicated Chrome profile to sign in, then return here and check again.",
                accountLabel: nil
            )
            if announce {
                statusMessage = "Sign in to YouTube to continue."
                currentToast = .warning("Could not verify YouTube authentication.")
            }
        }
        isCheckingAuthentication = false
    }

    func openYouTubeLogin() {
        Task {
            do {
                try await authService.openLogin()
                authCheckResult = AuthCheckResult(
                    isAuthenticated: false,
                    title: "Connecting to Chrome…",
                    detail: "Waiting for Chrome to start up.",
                    accountLabel: nil
                )
                statusMessage = "Opening Chrome…"
                isCheckingAuthentication = true

                // Give Chrome time to start and open the debug port
                try? await Task.sleep(for: .seconds(3))

                await refreshAuthenticationStatus(announce: true)

                // If still not authenticated, load playlists won't have run yet
                if authCheckResult.isAuthenticated {
                    await loadPlaylistsIfNeeded()
                }
            } catch {
                errorMessage = error.localizedDescription
                statusMessage = "Could not open Google Chrome."
                currentToast = .error("Could not open Google Chrome.")
            }
        }
    }

    func restartBrowser() {
        Task {
            do {
                authCheckResult = AuthCheckResult(
                    isAuthenticated: false,
                    title: "Restarting Chrome…",
                    detail: "Shutting down the unresponsive browser and launching a fresh one.",
                    accountLabel: nil
                )
                isCheckingAuthentication = true
                statusMessage = "Restarting Chrome…"

                try await authService.restartBrowser()

                // Give Chrome time to start and open the debug port
                try? await Task.sleep(for: .seconds(3))

                await refreshAuthenticationStatus(announce: true)

                if authCheckResult.isAuthenticated {
                    await loadPlaylistsIfNeeded()
                }
            } catch {
                errorMessage = error.localizedDescription
                statusMessage = "Could not restart Chrome."
                currentToast = .error("Could not restart Chrome.")
                isCheckingAuthentication = false
            }
        }
    }

    func refreshPlaylists(announce: Bool) async {
        isLoadingPlaylists = true
        errorMessage = nil

        do {
            let snapshot = try await playlistService.fetchPlaylists()
            let playlists = snapshot.playlists
                .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }

            let customPlaylists = availablePlaylists.filter(\.isDraft)
            watchLaterSummary = snapshot.watchLater
            availablePlaylists = customPlaylists + playlists
            hasLoadedPlaylists = true
            isLoadingPlaylists = false
            selectedPlaylistID = chooseSelectedPlaylistID(from: availablePlaylists)
            lastRefreshDescription = Self.refreshTimestampFormatter.string(from: .now)
            if announce {
                statusMessage = "Loaded \(playlists.count) playlists."
            }
        } catch {
            isLoadingPlaylists = false
            let customPlaylists = availablePlaylists.filter(\.isDraft)
            availablePlaylists = customPlaylists
            selectedPlaylistID = chooseSelectedPlaylistID(from: availablePlaylists)
            watchLaterSummary = WatchLaterSummary(videoCount: 0, maxItems: 5_000)
            hasLoadedPlaylists = false
            errorMessage = error.localizedDescription
            if announce {
                statusMessage = "Playlist loading failed."
                currentToast = .error("Playlist loading failed.")
            }
        }
    }

    private func refreshPlaylistsAfterTransfer() async {
        // Clear draft playlists — the backend has created them by now
        availablePlaylists.removeAll(where: \.isDraft)
        hasLoadedPlaylists = false
        await refreshPlaylists(announce: false)
    }

    func presentNewPlaylistSheet() {
        newPlaylistDraftName = "Old Watch"
        isShowingNewPlaylistSheet = true
    }

    func toggleDestinationEditing() {
        isEditingDestination.toggle()
    }

    func selectPlaylist(id: PlaylistSummary.ID) {
        selectedPlaylistID = id
        isEditingDestination = false
    }

    func dismissNewPlaylistSheet() {
        isShowingNewPlaylistSheet = false
    }

    func confirmNewPlaylist() {
        let normalizedName = newPlaylistDraftName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedName.isEmpty else {
            return
        }

        let customPlaylist = PlaylistSummary(
            id: UUID().uuidString,
            title: normalizedName,
            visibility: "New Playlist",
            videoCount: 0,
            isDraft: true
        )

        availablePlaylists.removeAll { $0.isDraft && $0.title == normalizedName }
        availablePlaylists.insert(customPlaylist, at: 0)
        selectedPlaylistID = customPlaylist.id
        isEditingDestination = false
        statusMessage = "Added \(normalizedName)."
        isShowingNewPlaylistSheet = false
    }

    func beginTransfer() {
        guard let destination else {
            log.warning("beginTransfer: no destination selected")
            return
        }

        log.info("beginTransfer: destination=\(destination.displayName, privacy: .public)")

        let resumeRunID: String? = (hasResumableRun && resumeEnabled) ? resumableRunID : nil

        if resumeRunID == nil && hasResumableRun {
            log.info("User chose start fresh, discarding resumable run \(self.resumableRunID ?? "nil", privacy: .public)")
            clearResumableRun()
        }

        moveTask?.cancel()
        resetRunState()
        hasStartedTransfer = true
        isRunningTransfer = true
        isEditingDestination = false
        errorMessage = nil

        if resumeRunID != nil {
            statusMessage = "Resuming migration to \(destination.displayName)."
        } else {
            statusMessage = "Preparing migration to \(destination.displayName)."
        }

        moveTask = Task {
            await performMove(to: destination, resumeRunID: resumeRunID, sourceRunID: resumableSourceRunID)
        }
    }

    func clearResumableRun() {
        resumableRunID = nil
        resumableDestination = nil
        resumableSourceRunID = nil
        resumeEnabled = true
        preferences.clearResumableRun()
    }

    func restoreResumableRun() {
        guard let savedName = preferences.resumableDestinationName else {
            return
        }

        let hasRunID = preferences.resumableRunID != nil
        let hasSourceRunID = preferences.resumableSourceRunID != nil
        guard hasRunID || hasSourceRunID else {
            return
        }

        resumableRunID = preferences.resumableRunID
        resumableSourceRunID = preferences.resumableSourceRunID
        resumeEnabled = true

        if let savedID = preferences.resumableDestinationID {
            resumableDestination = .existingPlaylist(id: savedID, title: savedName)
        } else {
            resumableDestination = .newPlaylist(name: savedName)
        }

        log.info("Restored resumable state for \(savedName, privacy: .public), runID=\(self.resumableRunID ?? "nil", privacy: .public), sourceRunID=\(self.resumableSourceRunID ?? "nil", privacy: .public), startIndex=\(self.preferences.resumableStartIndex)")
    }

    func toggleProgressExpansion() {
        isProgressExpanded.toggle()
    }

    func acknowledgeCompletion() {
        resetRunState()
        clearResumableRun()
        hasStartedTransfer = false
        errorMessage = nil
        statusMessage = "Choose a destination, then start the migration."
    }

    func requestCancellation() {
        let copied = copyProgress.completed
        let total = copyProgress.total
        let phase = currentPhase?.title ?? "unknown"

        let alert = NSAlert()
        alert.messageText = "Cancel Migration?"
        alert.informativeText = """
            Current phase: \(phase)
            Copied: \(copied) of \(total > 0 ? "\(total)" : "?") videos

            • Continue — resume the migration
            • Stop — keep what's been copied, stop here
            """
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Stop")

        let response = alert.runModal()
        if response == .alertSecondButtonReturn {
            moveTask?.cancel()
            moveTask = nil
            isRunningTransfer = false
            statusMessage = "Migration stopped. \(copied) videos were copied."
            currentToast = .warning("Migration stopped.")
            log.info("requestCancellation: user chose Stop after \(copied)/\(total)")
        }
    }

    private var destination: TransferDestination? {
        guard let selectedPlaylist else {
            return nil
        }

        let normalizedName = selectedPlaylist.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedName.isEmpty else {
            return nil
        }

        if selectedPlaylist.isDraft {
            return .newPlaylist(name: normalizedName)
        }

        return .existingPlaylist(id: selectedPlaylist.id, title: selectedPlaylist.title)
    }

    private func resetRunState() {
        currentPhase = nil
        currentItem = nil
        completedItems = []
        latestResult = nil
        inventoryProgress = PhaseProgressSnapshot(phase: .inventory)
        copyProgress = PhaseProgressSnapshot(phase: .copy)
        verifyProgress = PhaseProgressSnapshot(phase: .verify)
        deleteProgress = PhaseProgressSnapshot(phase: .delete)
        isProgressExpanded = false
        isEditingDestination = false
    }

    private func performMove(to destination: TransferDestination, resumeRunID: String? = nil, sourceRunID: String? = nil) async {
        do {
            let effectiveSourceRunID = sourceRunID ?? resumableSourceRunID
            let options = MoveExecutionOptions(
                avoidDuplicateAdditions: preferences.avoidDuplicateAdditionsToPlaylists,
                resumeRunID: resumeRunID,
                sourceRunID: effectiveSourceRunID,
                confirmDelete: true,
                startIndex: preferences.resumableStartIndex > 1 ? preferences.resumableStartIndex : 1
            )

            for try await event in moveService.runMove(to: destination, options: options) {
                handle(event)
            }
        } catch is CancellationError {
            saveResumableRun(for: destination)
            isRunningTransfer = false
            statusMessage = "Migration cancelled."
            currentToast = .warning("Migration cancelled.")
            log.info("performMove: cancelled")
        } catch {
            saveResumableRun(for: destination)
            isRunningTransfer = false
            errorMessage = error.localizedDescription
            statusMessage = "Migration failed."
            Self.showErrorAlert(error.localizedDescription)
            log.error("performMove: failed — \(error.localizedDescription, privacy: .public)")
        }
    }

    private func saveResumableRun(for destination: TransferDestination, sourceRunID: String? = nil) {
        guard let activeRunID else {
            return
        }

        resumableRunID = activeRunID
        resumableDestination = destination
        resumableSourceRunID = sourceRunID ?? resumableSourceRunID
        resumeEnabled = true
        preferences.saveResumableRun(runID: activeRunID, destination: destination, sourceRunID: resumableSourceRunID)
        log.info("Saved resumable run \(activeRunID, privacy: .public) for \(destination.displayName, privacy: .public)")
    }

    private func handle(_ event: MoveEvent) {
        switch event {
        case .started(let runID, let targetPlaylist, _):
            activeRunID = runID
            log.info("Event: started, runID=\(runID, privacy: .public), target=\(targetPlaylist, privacy: .public)")
            statusMessage = "Preparing migration to \(targetPlaylist)."
        case .phase(let phase, let status, _):
            log.info("Event: phase=\(phase.rawValue, privacy: .public), status=\(String(describing: status), privacy: .public)")
            currentPhase = phase
            applyPhaseStatus(status, to: phase)
            updateStatusMessage(for: phase)
        case .progress(let phase, let completed, let total, let message):
            currentPhase = phase
            updateProgress(for: phase, completed: completed, total: total, status: completed >= total ? .completed : .running)
            statusMessage = message
        case .item(let phase, let completed, let total, let item, _):
            currentPhase = phase
            currentItem = item
            if phase == .copy {
                recordCompletedItemIfNeeded(item)
            }
            if let completed, let total {
                if completed == 1 || completed == total || completed % 10 == 0 {
                    log.info("Event: item phase=\(phase.rawValue, privacy: .public) \(completed)/\(total) title=\(item.title, privacy: .public)")
                }
                updateProgress(for: phase, completed: completed, total: total, status: completed >= total ? .completed : .running)
            }
            updateStatusMessage(for: phase)
        case .result(let payload):
            log.info("Event: result ok=\(payload.ok), error=\(payload.errorMessage ?? "none", privacy: .public)")
            latestResult = payload
            isRunningTransfer = false
            moveTask = nil

            if payload.ok {
                clearResumableRun()
                currentPhase = .delete
                copyProgress.markCompletedIfNeeded()
                deleteProgress.markCompletedIfNeeded()
                statusMessage = "Migration complete."
                NSSound(named: .init("Glass"))?.play()
            } else {
                errorMessage = payload.errorMessage
                statusMessage = "Migration failed."
                if let msg = payload.errorMessage {
                    Self.showErrorAlert(msg)
                }
            }

            Task {
                await refreshPlaylistsAfterTransfer()
            }
        }
    }

    private func applyPhaseStatus(_ status: MovePhaseStatus, to phase: MovePhase) {
        switch phase {
        case .inventory, .copy, .verify, .delete:
            updateProgress(for: phase, status: status)
        case .setup:
            break
        }
    }

    private func updateProgress(
        for phase: MovePhase,
        completed: Int? = nil,
        total: Int? = nil,
        status: MovePhaseStatus
    ) {
        updateProgress(for: phase) { snapshot in
            snapshot.status = status

            if let total {
                snapshot.total = total
            }

            if let completed {
                snapshot.completed = completed
            }

            if status == .completed {
                snapshot.markCompletedIfNeeded()
            }
        }
    }

    private func updateProgress(for phase: MovePhase, mutate: (inout PhaseProgressSnapshot) -> Void) {
        switch phase {
        case .inventory:
            mutate(&inventoryProgress)
        case .copy:
            mutate(&copyProgress)
        case .verify:
            mutate(&verifyProgress)
        case .delete:
            mutate(&deleteProgress)
        case .setup:
            break
        }
    }

    private func updateStatusMessage(for phase: MovePhase) {
        switch phase {
        case .setup:
            statusMessage = "Preparing the destination playlist."
        case .inventory:
            if inventoryProgress.completed > 0 {
                statusMessage = "Scanning: \(inventoryProgress.completed) videos found"
            } else {
                statusMessage = "Scanning the Watch Later playlist…"
            }
        case .copy:
            statusMessage = currentItem.map { "Now copying: \($0.title)" } ?? "Copying videos."
        case .verify:
            statusMessage = "Verifying migrated items."
        case .delete:
            statusMessage = currentItem.map { "Now removing from Watch Later: \($0.title)" } ?? "Removing migrated videos."
        }
    }

    private func progressSnapshotIfVisible(for phase: MovePhase) -> PhaseProgressSnapshot? {
        switch phase {
        case .inventory:
            return inventoryProgress.completed > 0 ? inventoryProgress : nil
        case .copy:
            return copyProgress
        case .verify:
            return verifyProgress
        case .delete:
            return deleteProgress
        case .setup:
            return nil
        }
    }

    private func recordCompletedItemIfNeeded(_ item: MoveItemSnapshot) {
        guard !completedItems.contains(where: { $0.id == item.id }) else {
            return
        }

        completedItems.append(item)
    }

    private func chooseSelectedPlaylistID(from playlists: [PlaylistSummary]) -> PlaylistSummary.ID? {
        if let selectedPlaylistID, playlists.contains(where: { $0.id == selectedPlaylistID }) {
            return selectedPlaylistID
        }

        if let oldWatch = playlists.first(where: { $0.title == "Old Watch" }) {
            return oldWatch.id
        }

        return playlists.first?.id
    }

    static func showErrorAlert(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Migration Failed"
        alert.alertStyle = .critical

        let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 460, height: 200))
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true

        let textView = NSTextView(frame: scrollView.bounds)
        textView.isEditable = false
        textView.isSelectable = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        textView.string = message
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true

        scrollView.documentView = textView

        alert.accessoryView = scrollView
        alert.addButton(withTitle: "Copy Error")
        alert.addButton(withTitle: "OK")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(message, forType: .string)
        }
    }

    private static let refreshTimestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}
