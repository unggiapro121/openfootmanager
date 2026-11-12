// Adapted from tauri-plugin-mobile-push 0.1.4 (ios/Sources/MobilePushPlugin.swift;
// https://github.com/yanqianglu/tauri-plugin-mobile-push, commit
// fd23baefd2778f5828f4ca50d8fd7611d92cd081), MIT OR Apache-2.0, Copyright the
// tauri-plugin-mobile-push authors. Changes for OpenFoot Manager (phase 5 M3c2) are GPLv3:
// commands go through Tauri's plugin manager (no direct FFI), the token is answered by callback
// instead of a blocked thread, and the opened push is kept until the webview takes it.

import ObjectiveC
import Tauri
import UIKit
import UserNotifications
import WebKit

/// The fields of the server's push data the app reads (m3-tech-spec §4.6).
private let openedFields = ["kind", "outboxId", "route", "fixtureId", "auctionId"]

/// The getToken calls waiting for APNs; answered together by the app delegate's callback.
private var waitingForToken: [Invoke] = []
private let tokenLock = NSLock()

/// The push the app was opened from and the webview has not taken yet.
private var openedPush: [String: String]?

private func answerToken(_ token: String?, _ error: String?) {
  tokenLock.lock()
  let waiting = waitingForToken
  waitingForToken = []
  tokenLock.unlock()
  for invoke in waiting {
    if let token = token, !token.isEmpty {
      invoke.resolve(["token": token])
    } else {
      invoke.reject(error ?? "APNs gave no token")
    }
  }
}

private func dataOf(_ userInfo: [AnyHashable: Any]) -> [String: String]? {
  var data: [String: String] = [:]
  for field in openedFields {
    if let value = userInfo[field] as? String { data[field] = value }
  }
  return data["outboxId"] == nil ? nil : data
}

/// Shows a push that comes while the app is open, and keeps the one the coach taps.
private class PushCenterDelegate: NSObject, UNUserNotificationCenterDelegate {
  static let shared = PushCenterDelegate()

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if let data = dataOf(response.notification.request.content.userInfo) {
      openedPush = data
      PushPlugin.instance?.trigger("opened", data: [:])
    }
    completionHandler()
  }
}

/// Adds the two APNs callbacks to the app delegate Tao creates at run time; once.
private var delegateReady = false
private func prepareAppDelegate() {
  guard !delegateReady, let delegate = UIApplication.shared.delegate else { return }
  let cls: AnyClass = type(of: delegate)

  let registered: @convention(block) (AnyObject, UIApplication, NSData) -> Void = { _, _, data in
    let token = (data as Data).map { String(format: "%02.2hhx", $0) }.joined()
    answerToken(token, nil)
    PushPlugin.instance?.trigger("token", data: [:])
  }
  class_addMethod(
    cls, sel_registerName("application:didRegisterForRemoteNotificationsWithDeviceToken:"),
    imp_implementationWithBlock(registered as Any), "v@:@@")

  let failed: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { _, _, error in
    answerToken(nil, error.localizedDescription)
  }
  class_addMethod(
    cls, sel_registerName("application:didFailToRegisterForRemoteNotificationsWithError:"),
    imp_implementationWithBlock(failed as Any), "v@:@@")

  delegateReady = true
}

private func stateName(_ settings: UNNotificationSettings) -> String {
  switch settings.authorizationStatus {
  case .authorized, .provisional, .ephemeral: return "granted"
  case .denied: return "denied"
  default: return "prompt"
  }
}

@objc(PushPlugin)
public class PushPlugin: Plugin {
  public static var instance: PushPlugin?

  override public func load(webview: WKWebView) {
    PushPlugin.instance = self
    UNUserNotificationCenter.current().delegate = PushCenterDelegate.shared
  }

  @objc public func permissionState(_ invoke: Invoke) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      invoke.resolve(["state": stateName(settings)])
    }
  }

  @objc public func requestPermission(_ invoke: Invoke) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) {
      _, _ in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        invoke.resolve(["state": stateName(settings)])
      }
    }
  }

  @objc public func getToken(_ invoke: Invoke) {
    tokenLock.lock()
    waitingForToken.append(invoke)
    tokenLock.unlock()
    DispatchQueue.main.async {
      prepareAppDelegate()
      UIApplication.shared.registerForRemoteNotifications()
    }
  }

  /// The phone's settings for this app, where a refusal can be undone (§5.6).
  @objc public func openSettings(_ invoke: Invoke) {
    DispatchQueue.main.async {
      let name: String
      if #available(iOS 16.0, *) {
        name = UIApplication.openNotificationSettingsURLString
      } else {
        name = UIApplication.openSettingsURLString
      }
      guard let url = URL(string: name) else {
        invoke.reject("no settings page")
        return
      }
      UIApplication.shared.open(url)
      invoke.resolve([:])
    }
  }

  @objc public func takeOpened(_ invoke: Invoke) {
    let data = openedPush
    openedPush = nil
    invoke.resolve(["data": data.map { $0 as Any } ?? NSNull()])
  }
}

@_cdecl("init_plugin_ofm_push")
func initPlugin() -> Plugin {
  return PushPlugin()
}
