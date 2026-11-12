// swift-tools-version:5.3
// Adapted from tauri-plugin-mobile-push 0.1.4 (ios/Package.swift;
// https://github.com/yanqianglu/tauri-plugin-mobile-push, commit
// fd23baefd2778f5828f4ca50d8fd7611d92cd081), MIT OR Apache-2.0. Changes for OpenFoot Manager
// (phase 5 M3c2) are GPLv3.

import PackageDescription

let package = Package(
  name: "tauri-plugin-ofm-push",
  platforms: [
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-ofm-push",
      type: .static,
      targets: ["tauri-plugin-ofm-push"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-ofm-push",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
