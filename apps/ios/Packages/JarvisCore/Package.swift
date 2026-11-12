// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "JarvisCore",
    defaultLocalization: "en",
    platforms: [.iOS(.v26), .watchOS(.v26)],
    products: [
        .library(name: "JarvisCore", targets: ["JarvisCore"]),
    ],
    targets: [
        .target(
            name: "JarvisCore",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "JarvisCoreTests",
            dependencies: ["JarvisCore"],
            resources: [.copy("Resources")]
        ),
    ]
)
