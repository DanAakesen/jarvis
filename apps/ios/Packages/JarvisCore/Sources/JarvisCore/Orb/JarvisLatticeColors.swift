/// The original artwork has independently art-directed glass, glows and nodes. Preserve each default role
/// when its colour is unchanged, and derive its highlights and shadows from a replacement colour.
struct JarvisLatticeColors {
    let warm, hot, edgeWarm, nodeWarm, haze, spark, signalWarm, rimWarm: PaletteRGB
    let cool, deep, edgeCool, nodeCool, signalCool, rimLight, rimShade, wave, sheen: PaletteRGB
    let glassCore, glassMiddle, glassEdge, edgeMiddle, nodeMiddle: PaletteRGB

    init(selection: JarvisPaletteSelection) {
        let useWarm = selection.primary == JarvisPaletteSelection.standard.primary
        let useCool = selection.secondary == JarvisPaletteSelection.standard.secondary

        func tint(_ base: PaletteRGB, _ amount: Double) -> PaletteRGB {
            let value = amount < 0 ? 0.0 : 1.0
            return PaletteTone.mix(base, (value, value, value), abs(amount))
        }
        func primary(_ original: PaletteRGB, tintBy: Double = 0) -> PaletteRGB {
            useWarm ? original : tint(selection.primary.dark, tintBy)
        }
        func secondary(_ original: PaletteRGB, tintBy: Double = 0) -> PaletteRGB {
            useCool ? original : tint(selection.secondary.dark, tintBy)
        }

        warm = primary(JarvisOrbAppearance.warm)
        hot = primary(JarvisOrbAppearance.hot, tintBy: 0.23)
        edgeWarm = primary((1.0, 0.5, 0.07), tintBy: -0.08)
        nodeWarm = primary((1.0, 0.64, 0.16), tintBy: 0.13)
        haze = primary((1.0, 0.42, 0.06), tintBy: -0.1)
        spark = primary((1.0, 0.93, 0.78), tintBy: 0.74)
        signalWarm = primary((1.0, 0.8, 0.4), tintBy: 0.28)
        rimWarm = primary((1.0, 0.44, 0.06))
        cool = secondary(JarvisOrbAppearance.cool)
        deep = secondary(JarvisOrbAppearance.deep, tintBy: -0.45)
        edgeCool = secondary((0.22, 0.70, 1.0), tintBy: -0.11)
        nodeCool = secondary((0.58, 0.92, 1.0), tintBy: 0.41)
        signalCool = secondary((0.45, 0.85, 1.0), tintBy: 0.24)
        rimLight = secondary((0.42, 0.88, 1.0), tintBy: 0.20)
        rimShade = secondary((0.16, 0.5, 0.95), tintBy: -0.39)
        wave = secondary((0.62, 0.9, 1), tintBy: 0.51)
        sheen = secondary((0.8, 0.95, 1.0), tintBy: 0.74)
        glassCore = secondary((0.012, 0.03, 0.075), tintBy: -0.95)
        glassMiddle = secondary((0.014, 0.05, 0.12), tintBy: -0.91)
        glassEdge = secondary((0.024, 0.102, 0.243), tintBy: -0.81)
        edgeMiddle = useWarm && useCool ? (0.45, 0.78, 0.62) : PaletteTone.mix(edgeCool, edgeWarm, 0.5)
        nodeMiddle = useWarm && useCool ? (0.72, 0.9, 0.55) : PaletteTone.mix(nodeCool, nodeWarm, 0.5)
    }
}
