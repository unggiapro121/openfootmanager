import { onBackButtonPress } from "@tauri-apps/api/app";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { type EventCallback, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { appDataDir } from "@tauri-apps/api/path";
import { type CloseRequestedEvent, getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The desktop platform the app runs on, apart from game commands (those go
 * through `./transport`). This is the one module that touches the Tauri APIs
 * for windows, events and paths, so an online build replaces it in one place.
 */

/** Whether the app runs inside the desktop shell rather than a plain browser. */
export function isDesktopApp(): boolean {
  return isTauri();
}

/** The app data directory, where installed packages extract their assets. */
export async function appDataDirectory(): Promise<string> {
  return appDataDir();
}

/** A URL an `<img>` can load for a file on disk, through the asset protocol. */
export function localFileUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

/**
 * Run `handler` each time the backend emits the event `name`. Resolves to the
 * function that stops listening.
 */
export async function onBackendEvent<T>(
  name: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(name, handler);
}

/** Set the title of the app's window. */
export async function setWindowTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}

/**
 * Run `handler` when the player asks to close the window; the handler may
 * call `event.preventDefault()` to keep it open. Resolves to the function
 * that stops listening.
 */
export async function onWindowCloseRequested(
  handler: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<UnlistenFn> {
  return getCurrentWindow().onCloseRequested(handler);
}

/** Close the app's window at once, without a close-requested event. */
export async function destroyWindow(): Promise<void> {
  return getCurrentWindow().destroy();
}

/**
 * Run `handler` each time the phone's Back is pressed (the Android app, phase 5); while anyone
 * listens, Back no longer closes the app by itself. Resolves to the function that stops
 * listening, after which Back does the platform's default again.
 */
export async function onPhoneBackButton(handler: () => void): Promise<() => void> {
  const listener = await onBackButtonPress(() => handler());
  return () => {
    void listener.unregister();
  };
}
