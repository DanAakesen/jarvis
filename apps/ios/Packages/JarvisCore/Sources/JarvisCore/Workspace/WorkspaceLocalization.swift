import Foundation

public enum JarvisWorkspaceLocalizationKey: String, CaseIterable, Sendable {
    case title = "workspace.title"
    case allKinds = "workspace.allKinds"
    case kindReports = "workspace.kindReports"
    case kindApps = "workspace.kindApps"
    case kindImages = "workspace.kindImages"
    case kindGraphs = "workspace.kindGraphs"
    case groupPinned = "workspace.groupPinned"
    case groupToday = "workspace.groupToday"
    case groupWeek = "workspace.groupWeek"
    case groupEarlier = "workspace.groupEarlier"
    case refresh = "workspace.refresh"
    case refreshAccessibility = "workspace.refreshAccessibility"
    case rename = "workspace.rename"
    case titleField = "workspace.titleField"
    case save = "workspace.save"
    case cancel = "workspace.cancel"
    case removeQuestion = "workspace.removeQuestion"
    case removeFallbackQuestion = "workspace.removeFallbackQuestion"
    case removeMessage = "workspace.removeMessage"
    case remove = "workspace.remove"
    case connectionLabel = "workspace.connectionLabel"
    case notConnected = "workspace.notConnected"
    case connecting = "workspace.connecting"
    case connected = "workspace.connected"
    case reconnecting = "workspace.reconnecting"
    case offline = "workspace.offline"
    case refreshConnection = "workspace.refreshConnection"
    case filterByKind = "workspace.filterByKind"
    case search = "workspace.search"
    case clearSearch = "workspace.clearSearch"
    case loading = "workspace.loading"
    case offlineSaved = "workspace.offlineSaved"
    case showOlder = "workspace.showOlder"
    case noMatching = "workspace.noMatching"
    case clearFilters = "workspace.clearFilters"
    case noSavedItems = "workspace.noSavedItems"
    case retry = "workspace.retry"
    case opened = "workspace.opened"
    case openItem = "workspace.openItem"
    case actionsFor = "workspace.actionsFor"
    case pin = "workspace.pin"
    case unpin = "workspace.unpin"
    case signInRequired = "workspace.signInRequired"
    case configurationRequired = "workspace.configurationRequired"
    case unavailable = "workspace.unavailable"
    case loadFailed = "workspace.loadFailed"
    case offlineNotice = "workspace.offlineNotice"
    case olderLoadFailed = "workspace.olderLoadFailed"
    case itemUnavailable = "workspace.itemUnavailable"
    case openFailed = "workspace.openFailed"
    case pinFailed = "workspace.pinFailed"
    case titleSaveFailed = "workspace.titleSaveFailed"
    case removed = "workspace.removed"
    case removeFailed = "workspace.removeFailed"
    case close = "workspace.close"
    case closeAccessibility = "workspace.closeAccessibility"
    case destinationUnavailable = "workspace.destinationUnavailable"
    case invalidLink = "workspace.invalidLink"
    case linkOpenFailed = "workspace.linkOpenFailed"
    case toolUnavailable = "workspace.toolUnavailable"
    case windowActionUnavailable = "workspace.windowActionUnavailable"
    case htmlApp = "workspace.htmlApp"
    case htmlAppLoading = "workspace.htmlAppLoading"
    case htmlAppLoadFailed = "workspace.htmlAppLoadFailed"
    case knowledgeGraph = "workspace.knowledgeGraph"
    case codeView = "workspace.codeView"
    case generatedView = "workspace.generatedView"
    case unsupportedVersion = "workspace.unsupportedVersion"
    case unsupportedView = "workspace.unsupportedView"
    case tableSize = "workspace.tableSize"
    case noChartData = "workspace.noChartData"
    case baseline = "workspace.baseline"
    case xAxis = "workspace.xAxis"
    case yAxis = "workspace.yAxis"
    case series = "workspace.series"
    case showValues = "workspace.showValues"
    case chartLine = "workspace.chartLine"
    case chartBar = "workspace.chartBar"
    case chartArea = "workspace.chartArea"
    case chartSummary = "workspace.chartSummary"
    case chartNoValues = "workspace.chartNoValues"
    case chartPoints = "workspace.chartPoints"
    case chartRange = "workspace.chartRange"
    case imageUnavailable = "workspace.imageUnavailable"
    case loadingImage = "workspace.loadingImage"
    case nativeUnavailable = "workspace.nativeUnavailable"
    case openWebApp = "workspace.openWebApp"
    case webAppNotConfigured = "workspace.webAppNotConfigured"
    case webAppUnavailable = "workspace.webAppUnavailable"
    case unsupportedOnPhone = "workspace.unsupportedOnPhone"
    case actionUnavailable = "workspace.actionUnavailable"
    case actionUnavailableOnPhone = "workspace.actionUnavailableOnPhone"
    case openUsage = "workspace.openUsage"
    case openSettings = "workspace.openSettings"
    case routeUnavailable = "workspace.routeUnavailable"
    case toolUnavailableLabel = "workspace.toolUnavailableLabel"
    case focusView = "workspace.focusView"
    case restoreView = "workspace.restoreView"
    case closeView = "workspace.closeView"
    case minimiseView = "workspace.minimiseView"
    case moveView = "workspace.moveView"
    case resizeView = "workspace.resizeView"
    case yes = "workspace.yes"
    case no = "workspace.no"
    case value = "workspace.value"
    case unsupportedDestination = "workspace.unsupportedDestination"
    case incompleteView = "workspace.incompleteView"
    case validationFailed = "workspace.validationFailed"
    case viewUnavailable = "workspace.viewUnavailable"
    case positioningUnsupported = "workspace.positioningUnsupported"
    case operationUnsupported = "workspace.operationUnsupported"
    case statusOK = "workspace.statusOK"
    case statusWarning = "workspace.statusWarning"
    case statusError = "workspace.statusError"
    case statusUnknown = "workspace.statusUnknown"
}

public enum JarvisWorkspaceLocalization {
    public static func string(
        _ key: JarvisWorkspaceLocalizationKey,
        language: JarvisAppLanguage
    ) -> String {
        guard let url = Bundle.module.url(forResource: language.rawValue, withExtension: "lproj"),
              let bundle = Bundle(url: url) else {
            return key.rawValue
        }
        return bundle.localizedString(
            forKey: key.rawValue,
            value: key.rawValue,
            table: "JarvisWorkspaces"
        )
    }

    public static func formatted(
        _ key: JarvisWorkspaceLocalizationKey,
        language: JarvisAppLanguage,
        arguments: [CVarArg]
    ) -> String {
        String(format: string(key, language: language), locale: language.locale, arguments: arguments)
    }
}
